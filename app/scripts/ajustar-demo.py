#!/usr/bin/env python3
"""
Conserta e completa os dados de demonstracao do Musa CRM.

O QUE DEU ERRADO NA PRIMEIRA SEMEADURA
    O script anterior cadastrou as recorrencias com inicio em abril e mandou
    gerar. A rota gerou os cinco meses de uma vez, todos EM ABERTO - porque e
    isso que uma despesa recorrente e quando nasce: uma conta a pagar. Resultado:
    R$ 32.800 de divida vencida que nunca existiu, e agosto fechando em
    -R$ 9.940. A demo ficou parecendo uma clinica quebrada.

    A causa raiz ja foi corrigida no codigo: a rota agora gera so o mes
    corrente, e preencher o passado virou um ato deliberado. Este script
    conserta o que ja esta no banco.

O QUE ELE FAZ
    1. Cadastra as duas recorrencias que faltavam (pro-labore e recepcao), para
       o financeiro bater com os custos fixos da calculadora.
    2. Da baixa em tudo que e anterior a agosto - conta de meses passados esta
       paga, nao vencida.
    3. Lanca a receita de abril a agosto, com nome de procedimento e paciente,
       para os meses fecharem como uma clinica que funciona.
    4. Deixa DUAS contas de agosto em aberto de proposito: sem elas a faixa de
       contas a pagar nunca aparece numa demonstracao.

COMO RODAR
    read -rsp "Sua senha: " S; echo
    S="$S" python3 ajustar-demo.py            # so mostra o que faria
    S="$S" APLICAR=1 python3 ajustar-demo.py  # aplica
    unset S
"""
import json, os, sys, time, urllib.request

BASE = 'https://demo-musa.mulinotech.com'
EMAIL = os.environ.get('EMAIL', 'silvia@inpyx.com')
APLICAR = os.environ.get('APLICAR') == '1'

# A API limita 120 requisicoes por minuto. Este script faz mais de cem, e na
# primeira tentativa levou 429 no meio do caminho: metade dos lancamentos
# entrou, metade nao, e a conferencia final voltou zerada - dando a impressao
# de que os dados tinham sumido. Dai o freio: um intervalo minimo entre
# chamadas, e espera pela virada da janela quando mesmo assim estourar.
INTERVALO = 0.6
_ultima = [0.0]

def chamar(caminho, corpo=None, metodo=None, token=None, tentativa=0):
    espera = INTERVALO - (time.time() - _ultima[0])
    if espera > 0:
        time.sleep(espera)
    _ultima[0] = time.time()

    cab = {'Content-Type': 'application/json'}
    if token:
        cab['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(
        BASE + caminho,
        data=json.dumps(corpo).encode() if corpo is not None else None,
        headers=cab, method=metodo)
    try:
        return json.loads(urllib.request.urlopen(req).read() or b'{}')
    except Exception as e:
        codigo = getattr(e, 'code', '?')
        if codigo == 429 and tentativa < 3:
            print('      (limite de requisicoes; aguardando a janela virar...)')
            time.sleep(62)
            return chamar(caminho, corpo, metodo, token, tentativa + 1)
        return {'ERRO': codigo,
                'corpo': e.read().decode()[:200] if hasattr(e, 'read') else str(e)}

senha = os.environ.get('S')
if not senha:
    sys.exit('Defina S com a senha. Veja o cabecalho do arquivo.')

token = chamar('/api/auth/login', {'email': EMAIL, 'password': senha}).get('token')
if not token:
    sys.exit('Login falhou.')

print('MODO:', 'APLICANDO' if APLICAR else 'SIMULACAO (nada sera alterado)')
if APLICAR:
    print('Com o freio do limitador, isto leva alguns minutos. Nao interrompa.')
    print('E idempotente: se parar no meio, rode de novo que ele continua de onde parou.')
print('=' * 70)

# ------------------------------------- 1. recorrencias que faltavam
FALTANDO = [
    ('Pro-labore', 5000.00, 5, 'cat_pessoal'),
    ('Recepcao',   2200.00, 5, 'cat_pessoal'),
]
print('\n1) RECORRENCIAS QUE FALTAVAM (para bater com os custos fixos)')
ja = chamar('/api/recurring-expenses', None, 'GET', token)
existentes = {r['description'] for r in ja} if isinstance(ja, list) else set()
for desc, valor, dia_mes, cat in FALTANDO:
    if desc in existentes:
        print('   ja existe: %s' % desc)
        continue
    print('   + %-24s R$ %9.2f  todo dia %d' % (desc, valor, dia_mes))
    if APLICAR:
        r = chamar('/api/recurring-expenses',
                   {'description': desc, 'amount': valor, 'dayOfMonth': dia_mes,
                    'categoryId': cat, 'startDate': '2026-04-01'}, 'POST', token)
        if 'ERRO' in r: print('      falhou:', r)

if APLICAR:
    # Preenche o passado DE PROPOSITO, agora que a rota exige pedir.
    print('   gerando o passado das novas:',
          chamar('/api/finance/recurring/run', {'de': '2026-04-01'}, 'POST', token))

# ------------------------------------- 2. baixa no que e anterior a agosto
print('\n2) BAIXA NAS CONTAS DE MESES PASSADOS')
abertos = chamar('/api/finance/entries?from=2026-01-01&to=2026-07-31&status=aberto', None, 'GET', token)
itens = abertos.get('itens', []) if isinstance(abertos, dict) else []
print('   %d lancamento(s) em aberto antes de agosto' % len(itens))
for l in itens:
    print('      %s  %-28s R$ %8.2f  -> pago em %s' %
          (l['entryDate'], l['description'][:28], l['amount'], l['entryDate']))
    if APLICAR:
        r = chamar('/api/finance/entries/' + l['id'] + '/pay',
                   {'paidAt': l['entryDate'], 'paymentMethod': 'TRANSFERENCIA'}, 'PATCH', token)
        if 'ERRO' in r: print('         falhou:', r)

# ------------------------------------- 3. baixa em quase tudo de agosto
print('\n3) BAIXA EM AGOSTO, MENOS DUAS CONTAS')
DEIXAR_EM_ABERTO = ['Manutencao do Ultraformer', 'Aluguel da clinica']
abertos_ago = chamar('/api/finance/entries?from=2026-08-01&to=2026-08-31&status=aberto', None, 'GET', token)
itens_ago = abertos_ago.get('itens', []) if isinstance(abertos_ago, dict) else []
for l in itens_ago:
    if l['description'] in DEIXAR_EM_ABERTO:
        print('      MANTEM EM ABERTO: %-28s R$ %8.2f' % (l['description'][:28], l['amount']))
        continue
    print('      %s  %-28s R$ %8.2f  -> pago' % (l['entryDate'], l['description'][:28], l['amount']))
    if APLICAR:
        r = chamar('/api/finance/entries/' + l['id'] + '/pay',
                   {'paidAt': l['entryDate'], 'paymentMethod': 'TRANSFERENCIA'}, 'PATCH', token)
        if 'ERRO' in r: print('         falhou:', r)

# ------------------------------------- 4. receita dos meses
# Procedimentos do proprio catalogo da clinica, com nome de paciente, para a
# lista de lancamentos parecer o extrato de uma clinica de verdade.
#
# O VOLUME IMPORTA. Com R$ 13.520 de despesa recorrente por mes, uma agenda de
# sete procedimentos fecha no vermelho - foi o que a primeira versao deste
# script produziu. Uma clinica com esse custo fixo precisa faturar por volta de
# R$ 23 mil para ter margem sadia. Os meses abaixo crescem de abril a agosto,
# porque uma demo que mostra o negocio subindo conta uma historia melhor do que
# uma que mostra o negocio parado - e o comparativo com o periodo anterior, que
# fica no topo da tela, so tem graca se houver variacao.
PRECOS = {
    'Ultraformer MPT': 2400, 'Lavien BB Laser': 1800, 'Protocolo Bumbum Max': 3900,
    'Protocolo pos-Mounjaro': 3200, 'Skinbooster Premium': 1200, 'Harmonizacao facial': 2800,
    'Limpeza de Pele Premium': 350, 'Depilacao a laser': 450, 'Drenagem linfatica': 280,
}
PACIENTES = ['Carolina O.', 'Ana Beatriz R.', 'Renata V.', 'Juliana M.', 'Patricia L.',
             'Marcia S.', 'Fernanda R.', 'Luciana P.', 'Cristina A.', 'Vanessa T.',
             'Beatriz N.', 'Camila F.', 'Tatiana G.', 'Helena D.', 'Sofia B.']

# Agenda de cada mes, crescendo. 'U' = Ultraformer, e assim por diante.
CODIGOS = {'U': 'Ultraformer MPT', 'L': 'Lavien BB Laser', 'B': 'Protocolo Bumbum Max',
           'M': 'Protocolo pos-Mounjaro', 'S': 'Skinbooster Premium', 'H': 'Harmonizacao facial',
           'P': 'Limpeza de Pele Premium', 'D': 'Depilacao a laser', 'G': 'Drenagem linfatica'}
AGENDA = {
    '2026-04': 'U L B M S H U L P D G P',
    '2026-05': 'U L B M S H U L S P D G P H',
    '2026-06': 'U L B M S H U L S P D G P H B',
    '2026-07': 'U L B M S H U L S P D G P H B S',
    '2026-08': 'U L B M S H U L S P D G P H',
}
DIAS_DO_MES = {'2026-04': 30, '2026-05': 31, '2026-06': 30, '2026-07': 31, '2026-08': 27}

def agenda_do_mes(mes):
    """Espalha os procedimentos pelos dias uteis do mes, sem repetir paciente
    no mesmo dia."""
    codigos = AGENDA[mes].split()
    ultimo = DIAS_DO_MES[mes]
    passo = max(1, (ultimo - 2) // len(codigos))
    saida = []
    for n, cod in enumerate(codigos):
        proc = CODIGOS[cod]
        dia_mes = min(ultimo, 2 + n * passo)
        paciente = PACIENTES[(n + ultimo) % len(PACIENTES)]
        saida.append(('%s - %s' % (proc, paciente), PRECOS[proc], '%02d' % dia_mes))
    return saida

print('\n4) RECEITA DOS MESES')
existente = chamar('/api/finance/entries?from=2026-04-01&to=2026-08-31&type=RECEITA', None, 'GET', token)
descricoes = {l['description'] for l in existente.get('itens', [])} if isinstance(existente, dict) else set()
for mes in sorted(AGENDA):
    linhas = agenda_do_mes(mes)
    total = sum(v for _, v, _ in linhas)
    novos = [l for l in linhas if l[0] not in descricoes]
    print('   %s  %2d procedimento(s)  R$ %9.2f  (%d novo[s])' % (mes, len(linhas), total, len(novos)))
    for desc, valor, dia_mes in novos:
        data = mes + '-' + dia_mes
        if APLICAR:
            r = chamar('/api/finance/entries',
                       {'type': 'RECEITA', 'description': desc, 'amount': valor,
                        'categoryId': 'cat_procedimentos', 'entryDate': data,
                        'paidAt': data, 'paymentMethod': 'CREDITO'}, 'POST', token)
            if 'ERRO' in r: print('      falhou %s: %s' % (desc, r))

# --------------------------- 4b. despesa variavel, que cresce com o movimento
# Sem isto a despesa fica congelada no valor das recorrentes, como se atender o
# dobro de pacientes nao consumisse um frasco a mais de insumo nem pagasse
# taxa de cartao. Fica plano no grafico e nao convence ninguem que conhece o
# negocio.
#
# Agosto ja recebeu insumos e marketing na primeira semeadura - aqui ele leva
# so a taxa de cartao, para nao contar a mesma despesa duas vezes.
def variaveis_do_mes(mes, receita):
    fim = DIAS_DO_MES[mes]
    if mes == '2026-08':
        return [('Taxas de cartao - %s' % mes, round(receita * 0.035, 2), 'cat_taxas_cartao', '%s-%02d' % (mes, fim))]
    return [
        ('Insumos e descartaveis - %s' % mes, round(receita * 0.10, 2), 'cat_insumos', '%s-%02d' % (mes, min(fim, 22))),
        ('Trafego pago e midias - %s' % mes, 900.00, 'cat_marketing', '%s-%02d' % (mes, 3)),
        ('Taxas de cartao - %s' % mes, round(receita * 0.035, 2), 'cat_taxas_cartao', '%s-%02d' % (mes, fim)),
    ]

print('\n4b) DESPESA VARIAVEL DO MES')
existente_d = chamar('/api/finance/entries?from=2026-04-01&to=2026-08-31&type=DESPESA', None, 'GET', token)
desc_d = {l['description'] for l in existente_d.get('itens', [])} if isinstance(existente_d, dict) else set()
for mes in sorted(AGENDA):
    receita_mes = sum(v for _, v, _ in agenda_do_mes(mes))
    for desc, valor, cat, data in variaveis_do_mes(mes, receita_mes):
        if desc in desc_d:
            print('   ja existe: %s' % desc)
            continue
        print('   + %-34s R$ %9.2f  em %s' % (desc, valor, data))
        if APLICAR:
            r = chamar('/api/finance/entries',
                       {'type': 'DESPESA', 'description': desc, 'amount': valor,
                        'categoryId': cat, 'entryDate': data, 'paidAt': data,
                        'paymentMethod': 'TRANSFERENCIA'}, 'POST', token)
            if 'ERRO' in r: print('      falhou:', r)

# ------------------------------------- 5. conferencia
print('\n5) COMO OS MESES FICARAM')
if APLICAR:
    print('   %-9s %12s %12s %12s %8s' % ('mes', 'receita', 'despesa', 'resultado', 'margem'))
    for mes, fim in [('2026-04', '30'), ('2026-05', '31'), ('2026-06', '30'), ('2026-07', '31'), ('2026-08', '31')]:
        r = chamar('/api/finance/summary?from=%s-01&to=%s-%s&basis=competencia' % (mes, mes, fim), None, 'GET', token)
        print('   %-9s %12.2f %12.2f %12.2f %7.1f%%' %
              (mes, r.get('receitaTotal', 0), r.get('despesaTotal', 0),
               r.get('resultado', 0), r.get('margemPct', 0)))
    r = chamar('/api/finance/summary?from=2026-08-01&to=2026-08-31&basis=competencia', None, 'GET', token)
    print('\n   contas a pagar em aberto:', r.get('aPagar'))
else:
    print('   (pulado na simulacao)')

print('\n' + '=' * 70)
print('Rode de novo com APLICAR=1 para valer.' if not APLICAR else 'Pronto.')
