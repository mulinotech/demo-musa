#!/usr/bin/env python3
"""
Semeia dados de demonstracao no Musa CRM.

POR QUE ISTO EXISTE
    O banco da demo tem 6 sessoes de tratamento, todas PENDENTE. Enquanto
    nenhuma estiver REALIZADA, nao existe faturamento: o relatorio de gestao
    soma zero e o financeiro abre vazio. Os dois modulos entregues hoje ficam
    sem historia para contar numa demonstracao.

O QUE ELE FAZ
    1. Marca as sessoes existentes como REALIZADA, com datas espalhadas pelos
       ultimos meses (nao todas hoje, que pareceria dado de teste).
    2. Cadastra os custos fixos da clinica  -> alimenta a CALCULADORA DE PRECO.
    3. Cadastra despesas recorrentes        -> alimenta o FINANCEIRO.
    4. Lanca algumas despesas avulsas, uma delas em aberto e vencida, para a
       faixa de contas a pagar ter o que mostrar.
    5. Importa as sessoes realizadas como receita no razao.

O QUE ELE NAO FAZ
    Nao apaga nada. Nao mexe em paciente, lead nem anamnese. Os valores sao de
    demonstracao - troque pelos reais da clinica quando quiser.

COMO RODAR
    read -rsp "Sua senha: " S; echo
    S="$S" python3 semear-demo.py            # so mostra o que faria
    S="$S" APLICAR=1 python3 semear-demo.py  # aplica
    unset S
"""
import json, os, sys, urllib.request

BASE = 'https://demo-musa.mulinotech.com'
EMAIL = os.environ.get('EMAIL', 'silvia@inpyx.com')
APLICAR = os.environ.get('APLICAR') == '1'

def chamar(caminho, corpo=None, metodo=None, token=None):
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
        corpo_erro = e.read().decode()[:200] if hasattr(e, 'read') else str(e)
        return {'ERRO': getattr(e, 'code', '?'), 'corpo': corpo_erro}

senha = os.environ.get('S')
if not senha:
    sys.exit('Defina S com a senha antes de rodar. Veja o cabecalho do arquivo.')

token = chamar('/api/auth/login', {'email': EMAIL, 'password': senha}).get('token')
if not token:
    sys.exit('Login falhou. Confira o e-mail e a senha.')

print('MODO:', 'APLICANDO' if APLICAR else 'SIMULACAO (nada sera alterado)')
print('=' * 66)

# ------------------------------------------------------------------ 1. sessoes
# Datas espalhadas: um protocolo de 5 sessoes com intervalo mensal, mais uma
# limpeza recente. Assim o grafico de fluxo tem forma em vez de um pico so.
DATAS = ['2026-04-15', '2026-05-13', '2026-06-10', '2026-07-08', '2026-08-05', '2026-08-20']

planos = chamar('/api/treatment-plans', None, 'GET', token)
sessoes = []
for p in planos if isinstance(planos, list) else []:
    for s in (p.get('sessions') or []):
        sessoes.append((p.get('title'), s))

print('\n1) SESSOES -> REALIZADA')
i = 0
for titulo, s in sessoes:
    if s.get('status') == 'REALIZADA':
        print('   ja realizada:', titulo, s.get('id'))
        continue
    data = DATAS[i] if i < len(DATAS) else DATAS[-1]
    i += 1
    print('   %-34s R$ %-8s -> REALIZADA em %s' % (titulo[:34], s.get('price'), data))
    if APLICAR:
        r = chamar('/api/treatment-sessions/' + s['id'],
                   {'status': 'REALIZADA', 'sessionDate': data,
                    'clinicalEvolution': 'Sessao concluida conforme protocolo. Paciente sem intercorrencias.'},
                   'PATCH', token)
        if 'ERRO' in r:
            print('      falhou:', r)

# -------------------------------------------------------------- 2. custos fixos
# Alimentam a CALCULADORA: e a divisao destes por horas produtivas que da o
# custo por hora, sem o qual todo preco sai barato demais.
CUSTOS_FIXOS = [
    ('Aluguel da clinica',        4500.00, 'Estrutura'),
    ('Energia, agua e internet',   780.00, 'Estrutura'),
    ('Pro-labore',                5000.00, 'Pessoal'),
    ('Recepcao',                  2200.00, 'Pessoal'),
    ('Contabilidade',              650.00, 'Outros'),
    ('Software e sistemas',        390.00, 'Software'),
]

print('\n2) CUSTOS FIXOS (calculadora de preco)')
existentes = chamar('/api/fixed-costs', None, 'GET', token)
nomes = {c['name'] for c in (existentes.get('itens') or [])} if isinstance(existentes, dict) else set()
total = 0
for nome, valor, cat in CUSTOS_FIXOS:
    total += valor
    if nome in nomes:
        print('   ja existe: %s' % nome)
        continue
    print('   + %-28s R$ %9.2f  [%s]' % (nome, valor, cat))
    if APLICAR:
        r = chamar('/api/fixed-costs', {'name': nome, 'monthlyAmount': valor, 'category': cat}, 'POST', token)
        if 'ERRO' in r:
            print('      falhou:', r)
print('   total mensal: R$ %.2f  ->  a 120h produtivas = R$ %.2f por hora' % (total, total / 120))

# ---------------------------------------------------------- 3. recorrentes
# Alimentam o FINANCEIRO. Sao os mesmos gastos do bloco acima, mas com outro
# proposito: la eles entram no preco, aqui saem do caixa. Por enquanto se
# digita nos dois lugares.
RECORRENTES = [
    ('Aluguel da clinica',   4500.00, 10, 'cat_aluguel'),
    ('Energia e agua',        780.00, 15, 'cat_energia'),
    ('Contabilidade',         650.00, 20, 'cat_contabilidade'),
    ('Software e sistemas',   390.00,  5, 'cat_software'),
]

print('\n3) DESPESAS RECORRENTES (financeiro)')
ja = chamar('/api/recurring-expenses', None, 'GET', token)
desc_existentes = {r['description'] for r in ja} if isinstance(ja, list) else set()
for desc, valor, dia, cat in RECORRENTES:
    if desc in desc_existentes:
        print('   ja existe: %s' % desc)
        continue
    print('   + %-28s R$ %9.2f  todo dia %d' % (desc, valor, dia))
    if APLICAR:
        r = chamar('/api/recurring-expenses',
                   {'description': desc, 'amount': valor, 'dayOfMonth': dia,
                    'categoryId': cat, 'startDate': '2026-04-01'}, 'POST', token)
        if 'ERRO' in r:
            print('      falhou:', r)

# ------------------------------------------------------------ 4. avulsas
# A ultima esta em aberto e ja vencida, de proposito: e o que faz a faixa de
# contas a pagar aparecer na tela.
AVULSAS = [
    ('DESPESA', 'Compra de acido hialuronico',   1850.00, 'cat_insumos',   '2026-08-06', '2026-08-06'),
    ('DESPESA', 'Descartaveis e luvas',           420.00, 'cat_insumos',   '2026-08-12', '2026-08-12'),
    ('DESPESA', 'Trafego pago Instagram',         900.00, 'cat_marketing', '2026-08-01', '2026-08-01'),
    ('DESPESA', 'Manutencao do Ultraformer',     1200.00, 'cat_equipamentos', '2026-08-18', None),
]

print('\n4) DESPESAS AVULSAS')
for tipo, desc, valor, cat, competencia, pago in AVULSAS:
    print('   + %-30s R$ %8.2f  %s' % (desc, valor, 'pago em ' + pago if pago else 'EM ABERTO, vence 25/08'))
    if APLICAR:
        corpo = {'type': tipo, 'description': desc, 'amount': valor, 'categoryId': cat,
                 'entryDate': competencia, 'paidAt': pago}
        if not pago:
            corpo['dueDate'] = '2026-08-25'
        else:
            corpo['paymentMethod'] = 'PIX'
        r = chamar('/api/finance/entries', corpo, 'POST', token)
        if 'ERRO' in r:
            print('      falhou:', r)

# ---------------------------------------------------- 5. importar e conferir
print('\n5) IMPORTAR RECEITA E CONFERIR')
if APLICAR:
    print('   importacao:', chamar('/api/finance/sync-atendimentos', {}, 'POST', token))
    print('   recorrentes:', chamar('/api/finance/recurring/run', {}, 'POST', token))
    for base in ('competencia', 'caixa'):
        r = chamar('/api/finance/summary?from=2026-08-01&to=2026-08-31&basis=' + base, None, 'GET', token)
        print('   agosto por %-11s receita %9.2f  despesa %9.2f  resultado %9.2f'
              % (base, r.get('receitaTotal', 0), r.get('despesaTotal', 0), r.get('resultado', 0)))
    r = chamar('/api/finance/summary?from=2026-08-01&to=2026-08-31&basis=competencia', None, 'GET', token)
    print('   contas a pagar em aberto:', r.get('aPagar'))
else:
    print('   (pulado na simulacao)')

print('\n' + '=' * 66)
print('Rode de novo com APLICAR=1 para valer.' if not APLICAR else 'Pronto.')
