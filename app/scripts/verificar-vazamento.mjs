/** A 2ª barreira: o teste que finge ser outra clínica.
 *
 *  ===================================================== POR QUE UM SCRIPT
 *
 *  Não está em `npm test` de propósito. Teste de vazamento **precisa de banco
 *  de verdade**: um banco de mentira não avalia SQL, então não distingue
 *  `WHERE clinica_id = ?` de `WHERE 1=1`. E `npm test` tem de rodar sem banco,
 *  em qualquer máquina, em segundos.
 *
 *  Então isto é um script à parte, e faz parte da definição de pronto de cada
 *  tarefa da M1 — não do fim da fase.
 *
 *  ============================================================== COMO RODA
 *
 *      DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=musa DB_PASSWORD=... \
 *        node scripts/verificar-vazamento.mjs
 *
 *  Ele cria um banco descartável, aplica TODAS as migrations do repositório
 *  (o esquema nasce do zero, não é cópia de produção), semeia duas clínicas,
 *  sobe a aplicação apontada para ele, varre as rotas autenticado como a
 *  clínica A e falha se qualquer resposta contiver um único id da clínica B.
 *  No fim, apaga o banco.
 *
 *  ================================= POR QUE OS DADOS SÃO PARECIDOS DE PROPÓSITO
 *
 *  A clínica A tem "Maria Silva"; a B tem "Maria Souza". Mesmos serviços,
 *  mesmas datas, mesmos valores. Semear a A com "Maria" e a B com "Zebra Ltda"
 *  faria o teste passar por acidente — qualquer vazamento saltaria aos olhos de
 *  quem lê a saída, e ninguém confere saída de teste que passa.
 *
 *  Os **ids**, ao contrário, carregam marca (`_b_`): eles não são lidos por
 *  gente, e é sobre eles que a asserção corre. Parecido para o olho, distinto
 *  para a máquina.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const require = createRequire(path.join(RAIZ, 'package.json'));

/* O ensaio dispara centenas de requisicoes em segundos, e o teto de 120/min da
 * aplicacao passou a ser alcancado em 14/09, com o bloco [T]. Dali em diante
 * TODA conferencia recebia 429 -- inclusive as que esperavam 403, o que fez a
 * saida acusar o codigo novo por um limite de infraestrutura. Afrouxar aqui mede
 * o que se quer medir; ha teste fixando que o padrao da aplicacao continua 120. */
process.env.LIMITE_API_POR_MINUTO = process.env.LIMITE_API_POR_MINUTO || '100000';

const BANCO = 'musa_vazamento_' + Date.now().toString(36);
const HOST = process.env.DB_HOST || '127.0.0.1';
const PORTA = parseInt(process.env.DB_PORT || '3306');
const USUARIO = process.env.DB_USER || 'root';
const SENHA = process.env.DB_PASSWORD || process.env.DB_PASS || '';

const MARCA_B = '_b_';                     // os ids da clinica B carregam isto
const SENHA_TESTE = 'senha-de-ensaio-longa';
/** A chave de captacao da clinica B, escrita a mao na semente para o ensaio
 *  poder postar em nome dela. */
const CHAVE_B_DO_ENSAIO = 'cap_chave_da_clinica_b';

/** Data de hoje. As rotas de periodo tem padrao "do dia 1 ate hoje": semear no
 *  futuro faz a resposta vir VAZIA, e resposta vazia nao tem marca da clinica B
 *  -- a conferencia passaria sem exercitar nada. Foi o que aconteceu na
 *  primeira versao deste script. */
const HOJE = new Date().toISOString().slice(0, 10);
const EM_26H = (() => { const d = new Date(Date.now() + 26 * 3600e3);
  return d.toISOString().slice(0, 19).replace('T', ' '); })();
const EM_26H_FIM = (() => { const d = new Date(Date.now() + 27 * 3600e3);
  return d.toISOString().slice(0, 19).replace('T', ' '); })();
const HOJE_HORA = HOJE + ' 09:00:00';
const HOJE_FIM = HOJE + ' 10:00:00';
const PRIMEIRO = HOJE.slice(0, 8) + '01';

const mysql = require('mysql2/promise');

let falhas = 0;
let conferidas = 0;
let pendentes = 0;
function conferir(nome, ok, detalhe) {
  conferidas += 1;
  if (ok) console.log('  ok    ' + nome + (detalhe ? '  ->  ' + detalhe : ''));
  else { falhas += 1; console.log('  FALHA ' + nome + (detalhe ? '  ->  ' + detalhe : '')); }
}

/** Módulo ainda não convertido: o vazamento é ESPERADO e não conta como falha.
 *
 *  Sem esta distinção o script sairia com erro do primeiro dia da M1 até o
 *  último, e script que sempre falha ninguém lê -- vira o `dist.bak` da
 *  verificação. Assim ele é o critério de pronto de CADA tarefa: converteu um
 *  módulo, ele entra em `CONVERTIDOS`, e daí em diante um vazamento nele
 *  derruba o script. */
function pendente(nome, vazou, detalhe) {
  pendentes += 1;
  console.log('  pend  ' + nome + ' -- ' + (vazou ? 'vaza, como esperado' : 'nao vazou hoje') +
    (detalhe ? '  ->  ' + detalhe : ''));
}

/* ------------------------------------------------------------------ semente */

async function semear(conn) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(SENHA_TESTE, 4);   // 4 rounds: e ensaio, nao producao

  // A clinica 1 (`cl_1`) ja nasce das migrations. A B e nova.
  await conn.query(
    /* `chave_captacao` e obrigatoria desde a migration 029, e isto nao e
     * burocracia da semente: e o primeiro sinal de que **criar uma clinica
     * passou a ter um passo a mais**. Quando a M2.4/M3.1 fizer o cadastro pela
     * tela, ele tem de gerar a chave junto -- senao a clinica nova nasce sem
     * captacao e o site dela nao grava nada.
     *
     * A chave da clinica A vem da propria migration; esta e a da B, escrita a
     * mao para o ensaio poder postar em nome das duas. */
    "INSERT INTO clinicas (id, nome, evolution_instance, chave_captacao)" +
    " VALUES ('cl_b', 'Clinica Vizinha', ?, ?)",
    ['instancia-da-clinica-b', CHAVE_B_DO_ENSAIO]);

  const gente = [
    // [id, clinica, nome, papel, email]
    ['u_a_adm', 'cl_1', 'Silvia Admin A',  'admin',  'admin-a@ensaio.invalido'],
    ['u_a_pro', 'cl_1', 'Dra Ana A',       'profissional', 'pro-a@ensaio.invalido'],
    ['u' + MARCA_B + 'adm', 'cl_b', 'Silvia Admin B', 'admin', 'admin-b@ensaio.invalido']
  ];
  for (const [id, cl, nome, papel, email] of gente) {
    await conn.query(
      'INSERT INTO users (id, name, email, password_hash, role, status, clinica_id) VALUES (?,?,?,?,?,?,?)',
      [id, nome, email, hash, papel, 'active', cl]);
  }

  /* O OPERADOR DA PLATAFORMA (M3.1). Ele NAO tem clinica -- e o que o define --
   * e por isso mora em tabela propria, fora de `users`. A semente o cria aqui
   * para o bloco [T] poder medir, com um token de verdade, o que ele alcanca e o
   * que lhe e recusado. */
  await conn.query(
    "INSERT INTO operadores (id, nome, email, password_hash) VALUES (?,?,?,?)",
    ['op_ensaio', 'Operadora Mulino', 'operadora@ensaio.invalido', hash]);

  // Pacientes com nomes PARECIDOS de proposito.
  const pacientes = [
    ['c_a_1', 'cl_1', 'Maria Silva',  '5511900001111'],
    ['c_a_2', 'cl_1', 'Joana Alves',  '5511900002222'],
    ['c' + MARCA_B + '1', 'cl_b', 'Maria Souza', '5511900003333'],
    // Telefone REPETIDO entre clinicas: a mesma pessoa atendida nos dois lugares.
    // E o caso que expoe juncao por telefone sem filtro (o GET do vendedor).
    ['c' + MARCA_B + '2', 'cl_b', 'Joana Alvez', '5511900001111']
  ];
  for (const [id, cl, nome, tel] of pacientes) {
    await conn.query('INSERT INTO clients (id, name, phone, clinica_id) VALUES (?,?,?,?)',
      [id, nome, tel, cl]);
  }

  // Catalogo, agenda e financeiro -- mesmos nomes e valores nas duas.
  for (const [cl, suf] of [['cl_1', '_a_'], ['cl_b', MARCA_B]]) {
    await conn.query(
      'INSERT INTO treatment_catalog (id, name, price, duration, clinica_id) VALUES (?,?,?,?,?)',
      ['tc' + suf + '1', 'Toxina Botulinica', 450, '60', cl]);
    await conn.query(
      'INSERT INTO appointments (id, client_id, professional_id, catalog_id, title, status, kind, starts_at, ends_at, price, clinica_id)' +
      ' VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      // O `catalog_id` importa: sem ele a conclusao nao tem ficha tecnica para
      // consultar e NAO baixa insumo -- a conferencia do estoque passaria sem
      // exercitar a baixa, que e justamente o que interessa medir.
      ['ap' + suf + '1', 'c' + suf + '1', (cl === 'cl_1' ? 'u_a_pro' : 'u' + MARCA_B + 'adm'),
       'tc' + suf + '1', 'Toxina Botulinica', 'AGENDADO', 'ATENDIMENTO',
       HOJE_HORA, HOJE_FIM, 450, cl]);
    await conn.query(
      'INSERT INTO cash_entries (id, type, description, amount, entry_date, clinica_id)' +
      ' VALUES (?,?,?,?,?,?)',
      ['ce' + suf + '1', 'RECEITA', 'Toxina Botulinica', 450, HOJE, cl]);
    await conn.query(
      'INSERT INTO leads (id, name, whatsapp, treatment, status, clinica_id) VALUES (?,?,?,?,?,?)',
      ['ld' + suf + '1', 'Maria Interessada', '5511900001111', 'Toxina Botulinica', 'novo', cl]);

    // Equipe comercial (M1.6a). A conferencia dela era `esperado: 0` antes desta
    // tarefa -- ou seja, passava com a resposta vazia, que e o caso em que o
    // filtro nao mede nada. Agora cada clinica tem a sua, com o MESMO nome de
    // cargo, para a contagem ser a unica coisa que distingue.
    //
    // A senha em texto puro esta semeada de proposito: e ela que a conferencia
    // procura na resposta. A coluna e legada (nao autentica mais nada desde a
    // migration 004), mas `SELECT *` a devolvia ao navegador.
    await conn.query(
      'INSERT INTO salespeople (id, name, email, whatsapp, role, password, status, clinica_id)' +
      " VALUES (?,?,?,?,?,?,'active',?)",
      ['sp' + suf + '1', 'Vendedora ' + (cl === 'cl_1' ? 'A' : 'B'),
       'vend' + suf + '@ensaio.invalido', '5511900007777', 'vendedor',
       'senha-em-texto-puro-' + (cl === 'cl_1' ? 'a' : 'b'), cl]);

    // Um acumulo de pontos JA VENCIDO em cada clinica (M2.3). Sem ele, a
    // varredura de expiracao nao expira nada no ensaio -- e "expirados: 0"
    // satisfaz qualquer conferencia sem medir filtro nenhum. Foi exatamente o
    // que aconteceu na primeira rodada de sabotagem, em 10/09.
    //
    // Com um em cada lado, a passada da clinica A tem de expirar UM: o dela. Se
    // expirar dois, ela mexeu no extrato da paciente da vizinha -- e cada linha
    // dessas aparece no extrato como se a clinica tivesse feito.
    await conn.query(
      'INSERT INTO loyalty_transactions (id, client_id, type, points, description,' +
      " source, source_id, expires_at, created_at, clinica_id)" +
      " VALUES (?,?,'ACUMULO',?,?,'MANUAL',?,?,?,?)",
      ['lt' + suf + 'vencido', 'c' + suf + '1', 100, 'Acumulo vencido de ensaio',
       'vencido' + suf, '2026-01-31', '2025-11-01 10:00:00', cl]);

    // Compromisso EXCLUSIVO da previa de lembrete, a 26 h de distancia: longe o
    // bastante para nenhum outro bloco do ensaio concluir, cancelar ou mexer.
    // Sem ele a previa vinha vazia e a conferencia passava de graca.
    await conn.query(
      'INSERT INTO appointments (id, client_id, professional_id, title, status, kind,' +
      ' starts_at, ends_at, clinica_id) VALUES (?,?,?,?,?,?,?,?,?)',
      ['ap' + suf + 'lembrete', 'c' + suf + '1',
       (cl === 'cl_1' ? 'u_a_pro' : 'u' + MARCA_B + 'adm'),
       'Lembrete da clinica ' + (cl === 'cl_1' ? 'A' : 'B'), 'AGENDADO', 'ATENDIMENTO',
       EM_26H, EM_26H_FIM, cl]);

    // Configuracao de lembrete POR CLINICA (M2.1b), com textos DIFERENTES de
    // proposito: e o texto que denuncia se a configuracao atravessou. Contagem
    // nao serviria -- as duas tem uma linha cada.
    await conn.query(
      'INSERT INTO clinica_settings (clinica_id, chave, valor) VALUES (?,?,?), (?,?,?)' +
      ' ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [cl, 'lembretes_ativos', '1',
       cl, 'lembrete_template', 'Texto da clinica ' + (cl === 'cl_1' ? 'A' : 'B') + ': {paciente}']);

    // Trilha de auditoria (M1.6a). A descricao carrega nome de paciente de
    // proposito: e o que faz o vazamento de log ser o mais completo do sistema.
    await conn.query(
      'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id)' +
      ' VALUES (?,?,?,?,NOW(),?)',
      ['lg' + suf + '1', 'LEAD_DELETE',
       'Lead "Maria" (WhatsApp: 5511900001111) foi removido do sistema', 'Silvia Admin', cl]);
    // `products.unit_cost` e o custo MEDIO do produto, coluna diferente do
    // `unit_cost` do lote. Semear so o lote deixava o produto com custo 0.
    await conn.query(
      'INSERT INTO products (id, name, unit, unit_cost, min_stock, clinica_id) VALUES (?,?,?,?,?,?)',
      ['pr' + suf + '1', 'Toxina 100U', 'UN', 120, 3, cl]);

    // Financeiro e precificacao (M1.2). Valores IGUAIS nas duas de proposito:
    // se a soma atravessar, ela dobra -- e numero dobrado e o unico sintoma,
    // porque soma nao tem nome para alguem estranhar.
    await conn.query(
      'INSERT INTO fixed_costs (id, name, monthly_amount, clinica_id) VALUES (?,?,?,?)',
      ['fc' + suf + '1', 'Aluguel', 8000, cl]);
    await conn.query(
      'INSERT INTO recurring_expenses (id, description, amount, day_of_month, start_date, clinica_id)' +
      ' VALUES (?,?,?,?,?,?)',
      ['rc' + suf + '1', 'Contabilidade', 900, 5, PRIMEIRO, cl]);
    // Estoque (M1.3): lote com saldo, ficha tecnica do servico, e um movimento
    // de entrada. Quantidades IGUAIS nas duas -- saldo somado dobra.
    await conn.query(
      'INSERT INTO stock_batches (id, product_id, batch_number, expiry_date, quantity, unit_cost,' +
      ' received_at, clinica_id) VALUES (?,?,?,?,?,?,?,?)',
      ['lt' + suf + '1', 'pr' + suf + '1', 'LOTE-2026-A', '2027-12-31', 10, 120, HOJE, cl]);
    await conn.query(
      'INSERT INTO stock_movements (id, product_id, batch_id, type, quantity, unit_cost, reason,' +
      " source, clinica_id) VALUES (?,?,?,'ENTRADA',?,?,?,'MANUAL',?)",
      ['mv' + suf + '1', 'pr' + suf + '1', 'lt' + suf + '1', 10, 120, 'Compra inicial', cl]);
    await conn.query(
      'INSERT INTO service_supplies (id, catalog_id, product_id, quantity, clinica_id)' +
      ' VALUES (?,?,?,?,?)',
      ['ss' + suf + '1', 'tc' + suf + '1', 'pr' + suf + '1', 2, cl]);

    await conn.query(
      'INSERT INTO pricing_simulations (id, service_name, duration_min, fixed_cost_hour,' +
      ' fixed_cost_service, variable_cost, margin_pct, commission_pct, card_fee_pct, tax_pct,' +
      ' suggested_price, hourly_value, net_profit, clinica_id)' +
      ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['sm' + suf + '1', 'Toxina Botulinica', 60, 50, 50, 100, 30, 0, 3.5, 6, 450, 450, 200, cl]);

    // Documentos e anamnese (M1.5). Dado pessoal SENSIVEL: e o unico modulo
    // deste sistema em que o vazamento nao tem conserto possivel depois.
    //
    // O modelo precisa ter campo com `alert: true` de verdade. Com
    // `{sections: []}` -- como estava -- `documentos.alertas()` nao tem o que
    // avaliar e devolve lista vazia SEMPRE, e a conferencia de alerta clinico
    // passava sem exercitar nada. E `type: 'boolean'` so e afirmativo com
    // `true` booleano: 'sim' em texto nao acende alerta nenhum.
    await conn.query(
      'INSERT INTO document_templates (id, name, type, version, fields_json, clinica_id)' +
      ' VALUES (?,?,?,?,?,?)',
      ['tp' + suf + '1', 'Anamnese Facial', 'ANAMNESE', 1,
       JSON.stringify({ sections: [{ title: 'Historico', fields: [
         { key: 'alergias', label: 'Alergia a anestesico?', type: 'boolean', alert: true },
         { key: 'alergias_quais', label: 'Quais?', type: 'text' },
         { key: 'oncologico', label: 'Tratamento oncologico?', type: 'boolean', alert: true }
       ] }] }), cl]);
    await conn.query(
      'INSERT INTO client_documents (id, client_id, template_id, template_version, type, title,' +
      " answers_json, status, clinica_id, created_at)" +
      " VALUES (?,?,?,?,'ANAMNESE',?,?,'RASCUNHO',?,?)",
      ['dc' + suf + '1', 'c' + suf + '1', 'tp' + suf + '1', 1, 'Anamnese Facial',
       JSON.stringify({ alergias: true, alergias_quais: 'Lidocaina' }), cl,
       // Explicitamente ANTIGA: a cruzada abaixo e mais nova, e assim o
       // `ORDER BY created_at DESC` da rota de alertas escolhe a da vizinha
       // se o filtro cair. Com as duas no mesmo segundo o desempate ficava por
       // conta do banco, e a conferencia passava por sorte.
       '2026-09-01 08:00:00']);
    await conn.query(
      'INSERT INTO interactions (id, client_id, type, content, direction, clinica_id)' +
      ' VALUES (?,?,?,?,?,?)',
      ['in' + suf + '1', 'c' + suf + '1', 'WHATSAPP', 'Mensagem de ensaio', 'IN', cl]);

    // Atendimento registrado e plano de tratamento (M1.1b).
    await conn.query(
      'INSERT INTO treatments (id, client_id, procedure_name, session_date, price, clinica_id)' +
      ' VALUES (?,?,?,?,?,?)',
      ['tr' + suf + '1', 'c' + suf + '1', 'Toxina Botulinica', HOJE, 450, cl]);
    await conn.query(
      'INSERT INTO treatment_plans (id, client_id, title, total_sessions, clinica_id)' +
      ' VALUES (?,?,?,?,?)',
      ['pl' + suf + '1', 'c' + suf + '1', 'Protocolo de 3 sessoes', 3, cl]);
    // Duas sessoes com o MESMO numero nas duas clinicas: se a leitura de sessoes
    // nao filtrar clinica, a clinica A recebe as sessoes da B casadas ao plano
    // dela pelo `plan_id` -- ou, na colisao de id, ao plano certo com sessao
    // errada.
    for (let i = 1; i <= 3; i++) {
      await conn.query(
        'INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, clinica_id)' +
        ' VALUES (?,?,?,?,?)',
        ['ts' + suf + i, 'pl' + suf + '1', i, 'SESSAO_TRATAMENTO', cl]);
    }
  }

  /* ================================== A LINHA MALFORMADA, E POR QUE ELA EXISTE
   *
   * Descoberto em 09/09, sabotando o proprio ensaio: com a semente **bem
   * formada**, tirar o filtro de clinica das consultas de lote NAO produzia
   * vazamento nenhum. As duas sabotagens passaram verdes.
   *
   * O motivo: `products.id` e chave primaria global, entao o lote da clinica B
   * aponta para o produto `pr_b_1`, que nao esta na lista da clinica A -- a
   * juncao em memoria descarta o lote e o saldo sai certo por acidente. O
   * filtro estava sendo conferido contra um cenario que nao o exige.
   *
   * A linha abaixo e o cenario que exige: um lote **da clinica B** apontando
   * para o produto **da clinica A**. Ela e malformada de proposito, e nada no
   * banco impede que ela exista hoje -- e exatamente o que as chaves compostas
   * da M1.8 vao conter. Enquanto elas nao existem, um defeito de gravacao
   * produz essa linha, e e contra ela que o filtro de leitura precisa aguentar.
   *
   * A validade e ANTERIOR a do lote legitimo: assim, se o filtro faltar na
   * escolha de lote, o FEFO prefere este, e a baixa sai do lote da vizinha --
   * visivel, e nao por sorte.
   *
   * Licao, e ela vale para todo o projeto: **conferencia com dado bem formado
   * nao mede filtro.** O dado do ensaio tem de conter a linha que o defeito
   * criaria, senao o filtro passa por nao ser necessario.
   */

  /* ============ POR QUE `foreign_key_checks = 0` DAQUI ATE O FIM DAS CRUZADAS
   *
   * Desde a M1.8 o BANCO recusa linha cruzada -- e as sete linhas abaixo sao
   * linhas cruzadas, de proposito. Sem desligar a conferencia, a semente nao
   * entra, o ensaio nao sobe, e a 2a barreira (deteccao) para de existir
   * porque a 3a (contencao) impede o cenario de ser montado.
   *
   * Isso e a regra 13 na forma mais perigosa dela: **a contencao apagaria a
   * medicao da prevencao.** Se um dia alguem tirar o filtro de clinica de uma
   * consulta, quem grita e este ensaio -- e ele so grita se conseguir montar a
   * linha que o defeito criaria. Chave estrangeira se apaga com um ALTER; o
   * filtro do SELECT e o que segura a tela todo dia.
   *
   * Entao a ordem e: **desliga, semeia a linha cruzada, liga de novo.** E o
   * bloco [P] confere que, com a conferencia LIGADA, o banco recusa essas
   * mesmas linhas -- porque "desliguei para semear" nao pode virar "nunca mais
   * conferi se a contencao existe".
   *
   * Se voce esta aqui pensando em tirar o `SET` abaixo: o que acontece e o
   * ensaio inteiro parar de rodar, e a tentacao seguinte vai ser apagar as
   * linhas cruzadas da semente. Nao apague. Sem elas o ensaio passa verde sem
   * exercitar filtro nenhum, que e exatamente o defeito de 09/09. */
  await conn.query('SET foreign_key_checks = 0');

  await conn.query(
    'INSERT INTO stock_batches (id, product_id, batch_number, expiry_date, quantity,' +
    ' unit_cost, received_at, clinica_id) VALUES (?,?,?,?,?,?,?,?)',
    ['lt' + MARCA_B + '2', 'pr_a_1', 'LOTE-CRUZADO', '2027-01-31', 10, 120, HOJE, 'cl_b']);

  /* As outras tres linhas cruzadas, pelo mesmo motivo do lote acima.
   *
   * Acrescentadas depois de a licao do estoque valer para tras: todo filtro em
   * tabela alcancada por chave estrangeira a partir de um pai ja filtrado
   * corria o risco de estar sendo aprovado por nao ser necessario. Sao estas:
   *
   *  - SESSAO clinica da B apontando para o PLANO da A. Sem o filtro na leitura
   *    de sessoes, a paciente da clinica A abre o plano dela e ve uma sessao
   *    clinica de outra clinica -- prontuario, LGPD art. 5o II.
   *  - INSUMO da B na FICHA TECNICA do servico da A. E o pior dos tres: a
   *    conclusao do atendimento procuraria no estoque da A um produto que ela
   *    nao tem, recusaria com "estoque insuficiente", e a recepcao estaria
   *    olhando a prateleira cheia.
   *  - PONTO da B na paciente da A. Saldo de pontos e credito em dinheiro: um
   *    ponto da vizinha no saldo daqui vira desconto que a clinica paga sem ter
   *    vendido. */
  await conn.query(
    'INSERT INTO treatment_sessions (id, plan_id, session_number, session_type, clinica_id)' +
    ' VALUES (?,?,?,?,?)',
    ['ts' + MARCA_B + 'cruz', 'pl_a_1', 9, 'SESSAO_TRATAMENTO', 'cl_b']);
  await conn.query(
    'INSERT INTO service_supplies (id, catalog_id, product_id, quantity, clinica_id)' +
    ' VALUES (?,?,?,?,?)',
    ['ss' + MARCA_B + 'cruz', 'tc_a_1', 'pr' + MARCA_B + '1', 5, 'cl_b']);
  await conn.query(
    'INSERT INTO loyalty_transactions (id, client_id, type, points, description, source,' +
    " source_id, clinica_id) VALUES (?,?,'ACUMULO',?,?,'MANUAL',?,?)",
    ['lt' + MARCA_B + 'cruz', 'c_a_1', 5000, 'Pontos da vizinha', 'cruzado-1', 'cl_b']);

  /* E uma SEXTA linha cruzada, irmã da de cima e com um trabalho diferente
   * (M2.3): outro acúmulo da clínica B na paciente da clínica A, este com a
   * VALIDADE JÁ VENCIDA.
   *
   * Por que duas em vez de dar validade à primeira: a de cima mede o SALDO (o
   * passivo em circulação da clínica B tem de continuar mostrando os 5000), e
   * pontos vencidos saem do passivo. Dar validade a ela apagaria a conferência
   * que já existia -- o que se percebeu tentando, em 10/09.
   *
   * Esta mede a EXPIRAÇÃO, e é ela que revela o que a junção com `clients`
   * estava escondendo: sabotando o filtro de `t.clinica_id` no worker, a
   * varredura da clínica A passa a expirar um acúmulo da clínica B e grava a
   * baixa como se fosse dela. A junção não impede, porque esta linha aponta
   * para paciente DESTA clínica.
   *
   * Terceira vez em dois dias que a segunda camada aprovou a sabotagem da
   * primeira (regra 13). */
  await conn.query(
    'INSERT INTO loyalty_transactions (id, client_id, type, points, description, source,' +
    " source_id, expires_at, created_at, clinica_id) VALUES (?,?,'ACUMULO',?,?,'MANUAL',?,?,?,?)",
    ['lt' + MARCA_B + 'cruz2', 'c_a_1', 777, 'Pontos vencidos da vizinha', 'cruzado-2',
     '2026-02-28', '2025-12-01 10:00:00', 'cl_b']);

  /* E a quarta, a mais grave: um DOCUMENTO CLINICO da clinica B apontando para
   * a paciente da clinica A. Se a leitura de documentos nao filtrar, a anamnese
   * de outra clinica aparece na ficha desta paciente -- e a rota de alertas,
   * que a profissional abre segundos antes de aplicar o produto, passa a
   * responder com a contraindicacao da pessoa errada.
   *
   * Tres detalhes fazem esta linha medir o filtro em vez de passar de graca, e
   * os tres foram descobertos sabotando a rota e vendo a conferencia continuar
   * verde:
   *
   *  - ela aponta para o modelo da clinica A (`tp_a_1`). Sem `template_id` a
   *    rota de alertas pula o documento na primeira linha do laco, e sem filtro
   *    algum o alerta nunca apareceria. Com o modelo da vizinha, `lerModelo` --
   *    que e escopado -- devolveria null e salvaria a rota por acidente. E o
   *    modelo da propria A que torna a linha perigosa de verdade.
   *  - `created_at` mais NOVO que a anamnese da paciente, para o
   *    `ORDER BY created_at DESC` da rota escolher esta se o filtro cair.
   *  - a contraindicacao e OUTRA (`oncologico`, nao `alergias`), para a
   *    conferencia distinguir de qual documento o alerta veio pelo conteudo, e
   *    nao so pelo id. */
  await conn.query(
    'INSERT INTO client_documents (id, client_id, template_id, template_version, type, title,' +
    " answers_json, status, clinica_id, created_at)" +
    " VALUES (?,?,?,?,'ANAMNESE',?,?,'ASSINADO',?,?)",
    ['dc' + MARCA_B + 'cruz', 'c_a_1', 'tp_a_1', 1, 'Anamnese da vizinha',
     JSON.stringify({ oncologico: true }), 'cl_b', '2026-09-08 08:00:00']);

  /* E a quinta, da M1.6a: uma INTERACAO da clinica B na paciente da clinica A.
   *
   * Sem filtro na listagem, a conversa da vizinha aparece no historico desta
   * paciente. E o conteudo importa: `interactions.content` e texto livre escrito
   * por quem atende, entao ali cabe qualquer coisa -- valor negociado, motivo de
   * desistencia, observacao clinica.
   *
   * Ela mede tambem a rota de GRAVAR: era a busca de telefone por `client_id`,
   * sem filtro, que fazia a clinica A mandar WhatsApp para a paciente da B pelo
   * numero compartilhado -- e ali nao ha 404 a posteriori, porque a mensagem ja
   * saiu. */
  await conn.query(
    'INSERT INTO interactions (id, client_id, type, content, direction, clinica_id)' +
    ' VALUES (?,?,?,?,?,?)',
    ['in' + MARCA_B + 'cruz', 'c_a_1', 'WHATSAPP',
     'Combinado desconto de 40% com a vizinha', 'OUT', 'cl_b']);

  /* Fim das cruzadas. A conferencia volta a valer AQUI, e nao no fim da
   * semente: tudo que vier depois e dado bem formado, e se algo depois daqui
   * violar uma chave estrangeira eu quero saber pelo erro, e nao seis semanas
   * depois. */
  await conn.query('SET foreign_key_checks = 1');

  /* E um log DA INSTALACAO, sem clinica nenhuma -- como os que `daInstalacao`
   * grava (cron, migration) e como todos os registros antigos.
   *
   * Ele nao e linha cruzada: e o caso que a decisao de 09/09 mandou ESCONDER de
   * todas as clinicas. Sem ele, a conferencia de log passaria sem nunca ter
   * exercitado o `clinica_id IS NULL`. */
  await conn.query(
    'INSERT INTO system_logs (id, action_type, description, author, created_at, clinica_id)' +
    ' VALUES (?,?,?,?,NOW(),NULL)',
    ['lg_instalacao', 'MIGRATION', 'Registro da instalacao, de clinica nenhuma', 'Sistema']);
}

/* --------------------------------------------------------------- a varredura
 *
 * Só rotas de LEITURA: a varredura corre autenticada como a clínica A e
 * qualquer id com a marca `_b_` na resposta é vazamento. Gravação é exercitada
 * pelos testes de cada tarefa, não aqui — aqui o alvo é o filtro do SELECT.
 */
/** A catraca da M1, lida do próprio repositório. É ela que decide, aqui, o que
 *  é falha e o que é pendência — em vez de uma segunda lista à mão que
 *  divergiria da primeira na terceira semana. */
const naoConvertidos = require('./server/db/nao-convertidos.js');

/** As rotas de leitura varridas.
 *
 *  `esperado`  quantas linhas a clínica A deve ver. É o campo que impede a
 *              conferência de passar sem exercitar nada: resposta vazia não
 *              contém marca da clínica B, e passaria. Com a contagem, resposta
 *              vazia FALHA e o motivo aparece — parâmetro errado na URL,
 *              semente no dia errado, rota que mudou de nome.
 *              `null` = rota que não devolve lista (relatório, resumo): ali só
 *              a marca é conferida.
 *
 *  `campo`     nome do campo que carrega a lista, quando a resposta é objeto e
 *              não vetor. É ESCRITO, não adivinhado: um `contar` que procura
 *              "algum vetor aí dentro" acha o vetor errado quando a resposta
 *              tem dois, e passa a medir outra coisa sem avisar.
 *
 *  `arquivo`   quem responde por ela. Se estiver na catraca, o módulo ainda não
 *              foi convertido e o vazamento é pendência, não falha.
 */
const ROTAS = [
  { rota: '/api/clients', nome: 'pacientes', esperado: 2, arquivo: 'routes/clients.js' },
  { rota: '/api/treatments', nome: 'atendimentos', esperado: 1, arquivo: 'routes/treatments.js' },
  { rota: '/api/treatment-plans', nome: 'planos', esperado: 1, arquivo: 'routes/treatment-plans.js' },
  { rota: '/api/appointments?from=' + PRIMEIRO + '&to=' + HOJE, nome: 'agenda do mes', esperado: 1, arquivo: 'routes/appointments.js' },
  { rota: '/api/treatment-catalog', nome: 'catalogo', esperado: 1, arquivo: 'routes/catalog.js' },
  { rota: '/api/leads', nome: 'leads', esperado: 1, arquivo: 'routes/leads.js' },
  // As migrations semeiam um catalogo de produtos na clinica `cl_1`, entao a
  // contagem exata mudaria a cada migration nova. `minimo` guarda o que
  // importa: a resposta nao pode vir vazia.
  { rota: '/api/products', nome: 'produtos', minimo: 1, arquivo: 'routes/stock.js' },
  { rota: '/api/users', nome: 'usuarios', esperado: 2, arquivo: 'routes/users.js' },
  // Era `esperado: 0` -- e resposta vazia nao contem dado da vizinha, entao a
  // conferencia passava sem medir filtro nenhum. Agora cada clinica tem a sua
  // vendedora semeada, e o numero e 1.
  { rota: '/api/salespeople', nome: 'vendedores', esperado: 1, arquivo: 'routes/salespeople.js' },
  { rota: '/api/interactions', nome: 'interacoes', esperado: 1, arquivo: 'routes/interactions.js' },
  { rota: '/api/finance/entries?from=' + PRIMEIRO + '&to=' + HOJE, nome: 'razao', esperado: 1, campo: 'itens', arquivo: 'routes/finance.js' },
  { rota: '/api/recurring-expenses', nome: 'despesas recorrentes', esperado: 1, arquivo: 'routes/finance.js' },
  { rota: '/api/fixed-costs', nome: 'custos fixos', esperado: 1, campo: 'itens', arquivo: 'routes/pricing.js' },
  { rota: '/api/pricing/simulations', nome: 'simulacoes de preco', esperado: 1, arquivo: 'routes/pricing.js' },
  { rota: '/api/pricing/settings', nome: 'parametros de preco', esperado: null, arquivo: 'routes/pricing.js' },
  // A migration 014 semeia catalogo de produtos e movimentos na clinica `cl_1`,
  // entao a contagem exata mudaria a cada migration nova. `minimo` guarda o que
  // importa: a resposta nao pode vir vazia.
  { rota: '/api/stock/movements', nome: 'extrato de estoque', minimo: 1, arquivo: 'routes/stock.js' },
  { rota: '/api/stock/balance', nome: 'saldo de estoque', esperado: null, arquivo: 'routes/stock.js' },
  { rota: '/api/services/tc_a_1/supplies', nome: 'ficha tecnica', esperado: null, arquivo: 'routes/stock.js' },
  { rota: '/api/finance/categories', nome: 'categorias financeiras', esperado: null, arquivo: 'routes/finance.js' },
  { rota: '/api/finance/summary?from=' + PRIMEIRO + '&to=' + HOJE, nome: 'resultado', esperado: null, arquivo: 'routes/finance.js' },
  { rota: '/api/stock/alerts', nome: 'alertas de estoque', esperado: null, arquivo: 'routes/stock.js' },
  { rota: '/api/loyalty/report', nome: 'relatorio de pontos', esperado: null, arquivo: 'routes/loyalty.js' },
  { rota: '/api/loyalty/rewards', nome: 'recompensas', esperado: null, arquivo: 'routes/loyalty.js' },
  { rota: '/api/loyalty/settings', nome: 'programa de pontos', esperado: null, arquivo: 'routes/loyalty.js' },
  // A migration 016 semeia dois modelos (anamnese geral e termo) sem clinica, e
  // a 021 os carimba com a unica clinica que existe naquele instante -- que no
  // ensaio e a `cl_1`, ou seja a PROPRIA clinica A. Os tres modelos que a A ve
  // sao dela: dois da instalacao mais o `tp_a_1` da semente. A contagem exata
  // mudaria a cada modelo novo semeado, entao `minimo` guarda o que importa (a
  // resposta nao pode vir vazia) e a conferencia de marca acima e quem separa o
  // que e da A do que e da vizinha -- `tp_b_1` carrega `_b_` no id.
  { rota: '/api/document-templates', nome: 'modelos de documento', minimo: 1, arquivo: 'routes/documents.js' },
  { rota: '/api/clients/c_a_1/documents', nome: 'documentos da paciente', esperado: 1, arquivo: 'routes/documents.js' },
  { rota: '/api/logs', nome: 'logs', minimo: 1, arquivo: 'routes/logs.js' }
];

/** Falha se a lista de rotas citar arquivo que não existe na catraca nem no
 *  disco. Sem isto, um erro de digitação em `arquivo` marcaria o módulo como
 *  convertido e o vazamento dele viraria pendência silenciosa. */
function conferirListaDeRotas() {
  const fs = require('fs');
  const ruins = ROTAS.filter(function (r) {
    return !fs.existsSync(path.join(RAIZ, 'server', r.arquivo));
  });
  if (ruins.length) {
    console.error('\nlista de rotas com arquivo inexistente: ' +
      ruins.map((r) => r.nome + ' -> ' + r.arquivo).join(', '));
    process.exit(2);
  }
}

/** Quantas linhas a resposta traz. Devolve `{ n }` ou `{ erro }`.
 *
 *  Nunca devolve um numero quando nao conseguiu medir. Uma contagem impossivel
 *  virava `-1` na primeira versao, e `-1 !== esperado` falhava com a mensagem
 *  errada ("resposta vazia") para um problema que era outro: a rota devolve
 *  objeto, nao vetor. Mensagem errada custa mais tempo que falha nenhuma.
 */
function contar(texto, campo) {
  let d;
  try { d = JSON.parse(texto); } catch (e) { return { erro: 'a resposta nao e JSON' }; }

  if (campo === undefined) {
    if (Array.isArray(d)) return { n: d.length };
    return {
      erro: 'a resposta e ' + (d === null ? 'null' : typeof d) + ', nao um vetor. ' +
            'Se a rota passou a devolver objeto, escreva o nome do campo da lista ' +
            'no quarto lugar da linha em ROTAS.'
    };
  }

  if (!d || typeof d !== 'object' || !Array.isArray(d[campo])) {
    return {
      erro: 'a resposta nao tem o campo `' + campo + '` como vetor. Campos: ' +
            (d && typeof d === 'object' ? Object.keys(d).join(', ') : String(d)) +
            '. Corrija ROTAS -- nao ajuste o esperado.'
    };
  }
  return { n: d[campo].length };
}

async function principal() {
  const raiz = await mysql.createConnection({
    host: HOST, port: PORTA, user: USUARIO, password: SENHA, multipleStatements: true });
  await raiz.query('CREATE DATABASE ' + BANCO);
  await raiz.end();

  // O ambiente TEM de ser posto antes de a aplicacao ser carregada: server/db.js
  // le as variaveis e cria o pool no `require`.
  process.env.DB_HOST = HOST;
  process.env.DB_PORT = String(PORTA);
  process.env.DB_USER = USUARIO;
  process.env.DB_PASSWORD = SENHA;
  process.env.DB_NAME = BANCO;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-ensaio-do-vazamento';
  // CHAVE FALSA, de proposito. A rota de sugestao da IA confere a chave ANTES de
  // qualquer outra coisa: sem chave ela devolve 400 e a conferencia de dono nem
  // roda -- ou seja, o ensaio passaria sem exercitar o filtro. Com a chave falsa,
  // a conferencia de dono acontece e devolve 404 ANTES de qualquer chamada
  // externa, que e exatamente a ordem que importa (o dado sai do sistema no
  // instante da chamada, e conferir depois nao o traz de volta).
  process.env.GEMINI_API_KEY = 'chave-falsa-do-ensaio';
  // A migration 024 carimba esta instancia na unica clinica que existir na hora
  // -- que aqui e a `cl_1`, a clinica A. Sem isto ela desligaria os lembretes
  // por falta de instancia, que e o comportamento certo mas nao o que este
  // ensaio quer medir.
  process.env.EVOLUTION_INSTANCE_NAME = 'instancia-da-clinica-a';

  let servidor = null;
  try {
    const conn = await mysql.createConnection({
      host: HOST, port: PORTA, user: USUARIO, password: SENHA, database: BANCO,
      multipleStatements: true });

    const rodar = require('./db/run-migrations.js');
    const r = await rodar(conn, {});
    console.log('\n[esquema] ' + r.total + ' migrations aplicadas no banco ' + BANCO);

    await semear(conn);
    const [cl] = await conn.query('SELECT id FROM clinicas ORDER BY id');
    console.log('[semente] clinicas: ' + cl.map((x) => x.id).join(', '));
    await conn.end();

    const app = require('./server/app.js');
    await new Promise((ok) => { servidor = app.listen(0, ok); });
    const base = 'http://127.0.0.1:' + servidor.address().port;

    const entrar = async (email) => {
      const r = await fetch(base + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: SENHA_TESTE }) });
      if (!r.ok) throw new Error('login de ' + email + ' falhou: ' + r.status);
      return (await r.json()).token;
    };

    console.log('\n[A] varredura como a clinica A (admin)');
    const tokenA = await entrar('admin-a@ensaio.invalido');
    for (const alvo of ROTAS) {
      const { rota, nome, esperado, minimo, campo, arquivo } = alvo;
      const convertido = naoConvertidos.indexOf(arquivo) === -1;

      const resp = await fetch(base + rota, { headers: { Authorization: 'Bearer ' + tokenA } });
      const texto = await resp.text();

      if (!resp.ok) {
        // Resposta de erro e falha sempre, convertido ou nao: rota que quebrou
        // nao esta protegida, esta muda -- e muda ninguem repara.
        conferir(nome + ' respondeu ' + resp.status, false, rota + ' :: ' + texto.slice(0, 120));
        continue;
      }

      const quantos = (texto.match(new RegExp(MARCA_B, 'g')) || []).length;

      if (!convertido) {
        pendente(nome, quantos > 0, arquivo + ' ainda esta na catraca');
        continue;
      }

      conferir(nome + ' -- sem dado da clinica B', quantos === 0,
        quantos ? quantos + ' id(s) da clinica B na resposta!' : rota);

      if (esperado === undefined || esperado === null) {
        if (minimo === undefined || minimo === null) continue;
        const m = contar(texto, campo);
        if (m.erro) conferir(nome + ' -- nao deu para contar as linhas', false, m.erro);
        else conferir(nome + ' -- devolveu ao menos ' + minimo + ' linha(s)', m.n >= minimo,
          m.n >= minimo ? '' : 'devolveu ' + m.n + '. Resposta vazia NAO e aprovacao.');
        continue;
      }

      const m = contar(texto, campo);
      if (m.erro) {
        conferir(nome + ' -- nao deu para contar as linhas', false, m.erro);
      } else {
        conferir(nome + ' -- devolveu ' + esperado + ' linha(s)', m.n === esperado,
          m.n === esperado ? '' : 'devolveu ' + m.n + '. Resposta vazia ou a mais NAO e ' +
          'aprovacao: confira o parametro da URL e a semente.');
      }
    }

    console.log('\n[B] a clinica B ve o proprio dado, e nao o da A');
    const tokenB = await entrar('admin-b@ensaio.invalido');

    /* O token do OPERADOR DA PLATAFORMA (M3.1, 14/09). Nasce aqui porque o bloco
     * [R] -- o nascimento de uma clinica -- passou a precisar dele: cadastrar
     * clinica deixou de ser operacao de `admin` e virou operacao de plataforma,
     * e a rota interina `POST /api/clinicas` foi apagada junto. O bloco [T] mede
     * a entrada de novo, de proposito, porque la ela e a conferencia. */
    const entrarNaPlataforma = async () => {
      const r = await fetch(base + '/api/plataforma/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'operadora@ensaio.invalido', senha: SENHA_TESTE }) });
      if (!r.ok) throw new Error('login da plataforma falhou: ' + r.status);
      return (await r.json()).token;
    };
    const tokenDaPlataforma = await entrarNaPlataforma();
    const rB = await fetch(base + '/api/clients', { headers: { Authorization: 'Bearer ' + tokenB } });
    const tB = await rB.text();
    conferir('B enxerga as pacientes dela', tB.indexOf(MARCA_B) !== -1,
      'sem isto o teste passaria por filtro que nao devolve NADA');
    conferir('B nao enxerga as da A', tB.indexOf('c_a_') === -1);

    console.log('\n[C] a rota do vendedor, que junta por telefone');
    // O telefone 5511900001111 existe nas DUAS clinicas de proposito.
    const tokenPro = await entrar('pro-a@ensaio.invalido');
    const rP = await fetch(base + '/api/clients', { headers: { Authorization: 'Bearer ' + tokenPro } });
    const tP = await rP.text();
    conferir('juncao por telefone nao atravessa clinica', tP.indexOf(MARCA_B) === -1);

    console.log('\n[E] a GRAVACAO: concluir um atendimento carimba a clinica');
    // A conferencia mais importante da M1.1c, e a que nenhuma leitura substitui.
    // Concluir um atendimento faz nascer receita, baixa de insumo e ponto de
    // fidelidade. Antes da conversao, TODAS essas linhas nasciam com a clinica
    // vazia -- sem erro, e invisiveis para a clinica que as criou.
    const rE = await fetch(base + '/api/appointments/ap_a_1/status', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'REALIZADO' })
    });
    const textoE = await rE.text();
    conferir('concluir o atendimento respondeu 200', rE.ok, rE.ok ? '' : rE.status + ' :: ' + textoE.slice(0, 200));

    if (rE.ok) {
      const olho = await mysql.createConnection({
        host: HOST, port: PORTA, user: USUARIO, password: SENHA, database: BANCO });

      // Toda linha nova tem de ter a clinica de quem a criou. Contar as linhas
      // COM clinica nao bastaria: zero linha tambem passaria. Por isso a
      // conferencia e "existe pelo menos uma, e nenhuma sem clinica".
      //
      // A conferencia olha SO as linhas que a conclusao criou
      // (`source = 'APPOINTMENT'`). Contar a tabela inteira contaria tambem as
      // linhas da semente -- e foi assim que a primeira versao desta
      // conferencia acusou falha onde nao havia: ela achava a receita que ela
      // mesma tinha semeado para a clinica B.
      const tabelas = [
        ['cash_entries', 'a receita do atendimento'],
        ['loyalty_transactions', 'o ponto da paciente']
      ];
      for (const [tabela, oque] of tabelas) {
        const [novas] = await olho.query(
          "SELECT clinica_id, COUNT(*) AS n FROM " + tabela +
          " WHERE source = 'APPOINTMENT' GROUP BY clinica_id");
        const total = novas.reduce((soma, l) => soma + Number(l.n), 0);
        const vazias = novas.filter((l) => l.clinica_id === null)
          .reduce((soma, l) => soma + Number(l.n), 0);
        const daB = novas.filter((l) => l.clinica_id === 'cl_b')
          .reduce((soma, l) => soma + Number(l.n), 0);
        const daA = novas.filter((l) => l.clinica_id === 'cl_1')
          .reduce((soma, l) => soma + Number(l.n), 0);

        conferir(oque + ' nasceu', total > 0,
          total ? tabela + ': ' + total + ' linha(s) de origem APPOINTMENT' :
          'nenhuma linha nova em ' + tabela + ' -- a conferencia nao exercitou nada');
        conferir(oque + ' carimbou a clinica', vazias === 0,
          vazias ? vazias + ' linha(s) de ' + tabela + ' com clinica VAZIA -- ' +
          'e exatamente o defeito que a M1.1c existe para fechar' : '');
        conferir(oque + ' e da clinica A, e so dela', daA > 0 && daB === 0,
          daB ? daB + ' linha(s) foram para a clinica B!' : '');
      }

      // O compromisso da clinica B, com id parecido, nao pode ter sido tocado.
      const [bAp] = await olho.query(
        "SELECT status, completed_at FROM appointments WHERE id = 'ap" + MARCA_B + "1'");
      conferir('o compromisso da clinica B segue AGENDADO',
        bAp.length === 1 && bAp[0].status === 'AGENDADO' && !bAp[0].completed_at,
        bAp.length ? 'status ' + bAp[0].status : 'nao encontrei o compromisso da B');

      await olho.end();

      // Concluir de novo nao pode duplicar nada -- a idempotencia continua de pe
      // depois da conversao.
      const rE2 = await fetch(base + '/api/appointments/ap_a_1/status', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REALIZADO' })
      });
      const j2 = rE2.ok ? JSON.parse(await rE2.text()) : {};
      conferir('concluir de novo diz "ja concluido"', j2.jaConcluido === true,
        j2.jaConcluido === true ? '' : 'resposta: ' + JSON.stringify(j2).slice(0, 160));
    }

    console.log('\n[G] os NUMEROS: soma que atravessa clinica dobra, e nao tem nome');
    // A conferencia central da M1.2. Vazamento de listagem alguem estranha pelo
    // nome; vazamento de SOMA aparece so como um numero maior. As duas clinicas
    // foram semeadas com valores IGUAIS de proposito -- entao a soma errada e
    // exatamente o dobro, e a certa e exatamente o valor semeado.
    const pegar = async (rota, token) => {
      const r = await fetch(base + rota, { headers: { Authorization: 'Bearer ' + (token || tokenA) } });
      return r.ok ? JSON.parse(await r.text()) : { __status: r.status };
    };

    const custos = await pegar('/api/fixed-costs');
    conferir('o custo fixo mensal e 8000, e nao 16000', custos.totalMensal === 8000,
      'veio ' + JSON.stringify(custos.totalMensal) + ' (semeei 8000 em cada clinica)');

    const resultado = await pegar('/api/finance/summary?from=' + PRIMEIRO + '&to=' + HOJE);
    // 450 da semente + 450 da receita que a conclusao do [E] lancou.
    //
    // O nome do campo e `receitaTypeTotal`? Nao: e `receitaTotal`, e eu errei o
    // chute na primeira versao desta conferencia -- ela acusou `undefined` e me
    // mandou LER o servico em vez de supor. Uma conferencia que compara com
    // `undefined` falha alto; uma que compara com `0` teria passado calada se o
    // valor certo fosse 0.
    const receita = resultado && resultado.receitaTotal;
    conferir('a receita do periodo e 900, e nao 1350', Number(receita) === 900,
      'veio ' + JSON.stringify(receita) + '. 1350 significa que a soma pegou os 450 da vizinha');
    conferir('a despesa do periodo e 0, e nao a da vizinha',
      Number(resultado && resultado.despesaTotal) === 0,
      'veio ' + JSON.stringify(resultado && resultado.despesaTotal));

    const painel = await fetch(base + '/api/reports/generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aba: 'DASHBOARD', periodo: { inicio: PRIMEIRO, fim: HOJE } })
    });
    const jp = painel.ok ? JSON.parse(await painel.text()) : {};
    const ativos = jp.data && jp.data.totalPacientesAtivos;
    conferir('o painel conta 1 paciente ativa, e nao 2', ativos === 1,
      'veio ' + JSON.stringify(ativos) + '. E um COUNT(DISTINCT) -- o tipo de conta ' +
      'que atravessa sem deixar rastro');

    // E o outro lado: a clinica B tem de ver os NUMEROS DELA, nao zero. Filtro
    // que nao devolve nada passaria em tudo acima.
    const custosB = await pegar('/api/fixed-costs', tokenB);
    conferir('a clinica B ve o custo fixo dela, 8000', custosB.totalMensal === 8000,
      'veio ' + JSON.stringify(custosB.totalMensal));

    console.log('\n[H] o ESTOQUE: saldo, custo medio e a baixa do atendimento');
    // O estoque tem tres numeros que doem de formas diferentes:
    //   saldo errado  -> a recepcao promete produto que nao tem;
    //   custo medio errado -> a precificacao calcula preco sobre compra que nao
    //                         aconteceu, e ninguem descobre olhando a tela;
    //   baixa no lote errado -> o inventario para de fechar, e o rastro de lote
    //                           (que existe por exigencia sanitaria) se perde.
    const saldo = await pegar('/api/stock/balance');
    const meuProduto = (saldo.itens || []).filter((i) => i.id === 'pr_a_1')[0];
    conferir('o produto da clinica A aparece no saldo', !!meuProduto,
      meuProduto ? '' : 'itens: ' + JSON.stringify((saldo.itens || []).map((i) => i.id)));
    if (meuProduto) {
      // 10 semeados, menos 2 da ficha tecnica que a conclusao do [E] baixou.
      conferir('o saldo e 8, e nao 18 nem 20', meuProduto.saldo === 8,
        'veio ' + JSON.stringify(meuProduto.saldo) +
        '. 18 ou 20 significa que o lote da vizinha entrou na soma');
      conferir('o custo unitario e 120, e nao mexeu', meuProduto.unitCost === 120,
        'veio ' + JSON.stringify(meuProduto.unitCost));
      // A clinica B tem um lote apontando para ESTE produto (ver a nota da
      // semente). Ele nao pode aparecer, e o id dele carrega a marca.
      const idsDeLote = (meuProduto.lotes || []).map((l) => l.id);
      conferir('a clinica A ve 1 lote, o dela', idsDeLote.length === 1,
        'veio ' + idsDeLote.length + ' lote(s): ' + idsDeLote.join(', '));
      conferir('o lote CRUZADO da clinica B nao aparece',
        idsDeLote.filter((id) => id.indexOf(MARCA_B) !== -1).length === 0,
        'lotes: ' + idsDeLote.join(', '));
    }
    // Contagem exata aqui seria refem da migration 014, que semeia 13 produtos
    // na clinica 1. O que importa e o produto da vizinha NAO estar na lista --
    // e isso e afirmacao sobre conteudo, nao sobre tamanho.
    const idsNoSaldo = (saldo.itens || []).map((i) => i.id);
    conferir('nenhum produto da clinica B no saldo',
      idsNoSaldo.filter((id) => id.indexOf(MARCA_B) !== -1).length === 0,
      'ids: ' + idsNoSaldo.join(', '));

    // A baixa da conclusao tem de ter saido do LOTE da clinica A.
    const olho2 = await mysql.createConnection({
      host: HOST, port: PORTA, user: USUARIO, password: SENHA, database: BANCO });
    const [mov] = await olho2.query(
      "SELECT batch_id, clinica_id, quantity FROM stock_movements " +
      "WHERE source = 'APPOINTMENT' AND type = 'SAIDA'");
    conferir('a baixa do atendimento saiu de UM lote', mov.length === 1,
      'veio ' + mov.length + ' movimento(s) de saida');
    if (mov.length === 1) {
      conferir('e o lote e o da clinica A', mov[0].batch_id === 'lt_a_1',
        'saiu do lote ' + mov[0].batch_id + ' (clinica ' + mov[0].clinica_id + ')');
      conferir('a baixa carimbou a clinica', mov[0].clinica_id === 'cl_1');
    }
    const [loteB] = await olho2.query(
      "SELECT id, quantity FROM stock_batches WHERE id LIKE 'lt" + MARCA_B + "%' ORDER BY id");
    conferir('os DOIS lotes da clinica B seguem com 10',
      loteB.length === 2 && loteB.every((l) => Number(l.quantity) === 10),
      loteB.map((l) => l.id + '=' + l.quantity).join(', ') +
      ' (o segundo e o cruzado: se ele baixou, o FEFO pegou o lote da vizinha)');
    await olho2.end();

    // E o ajuste num lote da vizinha tem de ser recusado.
    const rAj = await fetch(base + '/api/stock/adjust', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: 'lt' + MARCA_B + '1', quantity: 5, type: 'PERDA', reason: 'ensaio' })
    });
    conferir('ajustar lote da clinica B da 404', rAj.status === 404,
      rAj.status === 404 ? 'id conhecido e ainda assim nao encontrado -- e o certo' :
      'respondeu ' + rAj.status + '! Isso tiraria saldo do estoque dela');

    console.log('\n[J] o PRONTUARIO: documentos, alertas clinicos e a exportacao LGPD');
    /* O modulo em que o vazamento nao tem conserto. Tres conferencias:
     *
     *  - a lista de documentos da paciente nao pode trazer a anamnese cruzada;
     *  - os ALERTAS nao podem vir do documento da vizinha -- ali nao e
     *    vazamento de dado, e risco clinico: a profissional le contraindicacao
     *    da pessoa errada segundos antes de aplicar o produto;
     *  - a EXPORTACAO de uma paciente de outra clinica tem de dar 404 antes de
     *    ler qualquer coisa. E o mesmo pedido que a portabilidade legitima faz.
     */
    const docsPac = await pegar('/api/clients/c_a_1/documents');
    const idsDocs = (Array.isArray(docsPac) ? docsPac : []).map((d) => d.id);
    conferir('a anamnese CRUZADA nao aparece na ficha da paciente',
      idsDocs.filter((id) => String(id).indexOf(MARCA_B) !== -1).length === 0,
      'documentos: ' + idsDocs.join(', '));
    conferir('e a anamnese dela aparece', idsDocs.indexOf('dc_a_1') !== -1,
      'documentos: ' + idsDocs.join(', '));

    const alertas = await pegar('/api/clients/c_a_1/alerts');
    const campos = (alertas.alertas || []).map((a) => a.campo);
    // Primeiro: a rota tem de estar ACENDENDO alerta. Sem isto as duas
    // conferencias seguintes passariam com a lista vazia -- foi exatamente o
    // que acontecia enquanto o modelo semeado tinha `sections: []`.
    conferir('a rota de alertas realmente acende alerta',
      campos.length > 0,
      campos.length ? 'campos: ' + campos.join(', ') :
      'lista vazia. Conferencia de alerta com lista vazia nao mede filtro nenhum');
    conferir('os alertas clinicos vem do documento DESTA clinica',
      !!alertas.origem && String(alertas.origem.documentId).indexOf(MARCA_B) === -1,
      'origem: ' + JSON.stringify(alertas.origem) +
      '. Alerta vindo do documento da vizinha e risco clinico, nao vazamento');
    conferir('a contraindicacao e a DELA, nao a da vizinha',
      campos.indexOf('alergias') !== -1 && campos.indexOf('oncologico') === -1,
      'campos: ' + campos.join(', ') +
      '. `alergias` e da anamnese dela; `oncologico` so existe na cruzada da clinica B');

    /* `lerDocumento` protege CINCO rotas de uma vez (editar, finalizar,
     * assinar, ver e cancelar). Uma conferencia so, na de ver, cobre o leitor
     * que as cinco compartilham -- e e o leitor que precisa estar filtrado,
     * porque o `JOIN clients` dele nao basta: a cruzada aponta para paciente
     * DESTA clinica. */
    const rVer = await fetch(base + '/api/documents/dc' + MARCA_B + 'cruz/view', {
      headers: { Authorization: 'Bearer ' + tokenA } });
    conferir('abrir o documento da clinica B pelo id da 404', rVer.status === 404,
      rVer.status === 404 ? 'e o leitor que as cinco rotas de documento compartilham' :
      'respondeu ' + rVer.status + '! O prontuario da vizinha abre com id conhecido');

    const rExp = await fetch(base + '/api/clients/c' + MARCA_B + '1/export', {
      headers: { Authorization: 'Bearer ' + tokenA } });
    conferir('exportar paciente da clinica B da 404', rExp.status === 404,
      rExp.status === 404 ? 'e o mesmo pedido da portabilidade legitima -- por isso o 404 importa' :
      'respondeu ' + rExp.status + '! Isso entrega o prontuario dela inteiro');

    const rExpA = await fetch(base + '/api/clients/c_a_1/export', {
      headers: { Authorization: 'Bearer ' + tokenA } });
    const expA = rExpA.ok ? await rExpA.text() : '';
    conferir('exportar a propria paciente funciona', rExpA.ok, rExpA.ok ? '' : 'deu ' + rExpA.status);
    conferir('e a exportacao NAO carrega nada da clinica B',
      expA.indexOf(MARCA_B) === -1,
      (expA.match(new RegExp(MARCA_B, 'g')) || []).length + ' marca(s) da clinica B no arquivo ' +
      'exportado -- documento, compromisso, interacao ou ponto dela');

    console.log('\n[K] o funil, a equipe comercial e a trilha de auditoria');
    /* A M1.6a converteu seis arquivos, e o que eles tem em comum e que quase
     * tudo ali e GRAVACAO com id na URL. Ler a lista da vizinha e ruim; alterar
     * e excluir linha dela e outra categoria -- e como os ids sao unicos no
     * banco inteiro, bastava o id, que a propria listagem entrega.
     *
     * Cada rota de escrita e exercitada com um id da clinica B. Todas tem de
     * responder 404: nao 403. Dizer "sem permissao" confirmaria que aquele id
     * existe em algum lugar da plataforma. */
    const comoA = { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' };
    const escrever = async (metodo, rota, corpo) => {
      const r = await fetch(base + rota, {
        method: metodo, headers: comoA,
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
      });
      return r.status;
    };

    for (const [nome, metodo, rota, corpo] of [
      ['alterar tratamento do catalogo da clinica B', 'PATCH',
       '/api/treatment-catalog/tc' + MARCA_B + '1', { price: 1 }],
      ['excluir tratamento do catalogo da clinica B', 'DELETE',
       '/api/treatment-catalog/tc' + MARCA_B + '1', undefined],
      ['alterar lead da clinica B', 'PUT',
       '/api/leads/ld' + MARCA_B + '1', { status: 'perdido' }],
      ['excluir lead da clinica B', 'DELETE',
       '/api/leads/ld' + MARCA_B + '1', undefined],
      ['alterar vendedora da clinica B', 'PATCH',
       '/api/salespeople/sp' + MARCA_B + '1', { role: 'gerente' }],
      ['excluir vendedora da clinica B', 'DELETE',
       '/api/salespeople/sp' + MARCA_B + '1', undefined]
    ]) {
      const st = await escrever(metodo, rota, corpo);
      conferir(nome + ' da 404', st === 404,
        st === 404 ? 'id conhecido e ainda assim nao encontrado -- e o certo' :
        'respondeu ' + st + '! Com o id na mao, uma clinica mexe na linha da outra');
    }

    /* A INTERACAO e o unico caso em que o 404 tem de vir ANTES de um efeito
     * externo: a rota manda WhatsApp de verdade. Conferir depois de mandar nao
     * desfaz a mensagem -- a paciente da vizinha ja recebeu, pelo numero
     * compartilhado, em nome do consultorio errado. */
    const stInt = await escrever('POST', '/api/interactions',
      { clientId: 'c' + MARCA_B + '1', type: 'whatsapp', content: 'Oi', direction: 'out' });
    conferir('registrar interacao em contato da clinica B da 404', stInt === 404,
      stInt === 404 ? 'recusado ANTES de qualquer envio -- e o que importa aqui' :
      'respondeu ' + stInt + '! A mensagem pode ter saido para a paciente da vizinha');

    /* O historico da paciente da A nao pode trazer a interacao cruzada. A
     * conferencia e pelo CONTEUDO, e nao pela marca: `interactions.content` e
     * texto livre, e e ele que vaza -- o id da linha nem aparece na tela. */
    const inter = await pegar('/api/interactions');
    const textos = (Array.isArray(inter) ? inter : []).map((i) => String(i.content || ''));
    conferir('a interacao CRUZADA nao aparece no historico',
      textos.every((t) => t.indexOf('vizinha') === -1),
      'conteudos: ' + textos.join(' | '));
    conferir('e a interacao dela aparece',
      textos.some((t) => t.indexOf('Mensagem de ensaio') !== -1),
      'conteudos: ' + textos.join(' | ') +
      '. Lista vazia faria a conferencia de cima passar de graca.');

    /* A TRILHA. Tres coisas de uma vez, e a terceira e a que a decisao de 09/09
     * criou: registro sem clinica nao aparece para ninguem. */
    const trilha = await pegar('/api/logs');
    const descricoes = (Array.isArray(trilha) ? trilha : []).map((l) => String(l.description || ''));
    conferir('a trilha traz o registro DESTA clinica',
      descricoes.some((d) => d.indexOf('Maria') !== -1),
      descricoes.length + ' registro(s). Trilha vazia passaria as duas conferencias abaixo de graca.');
    conferir('a trilha nao traz o registro da instalacao (sem clinica)',
      descricoes.every((d) => d.indexOf('de clinica nenhuma') === -1),
      'registros: ' + descricoes.join(' | ') +
      '. Log sem clinica e da instalacao: cron, migration e os registros antigos. ' +
      'Mostrar a uma clinica seria mostrar atividade que pode nao ser dela.');
    const daB = (Array.isArray(trilha) ? trilha : []).filter((l) => String(l.id || '').indexOf(MARCA_B) !== -1);
    conferir('a trilha nao traz registro da clinica B', daB.length === 0,
      daB.length + ' registro(s) da vizinha. A descricao do log carrega nome e ' +
      'telefone de quem ela atende -- e o vazamento mais completo do sistema.');

    /* A SENHA EM TEXTO PURO. Nao e multi-inquilino: e a coluna legada
     * `salespeople.password`, que o `SELECT *` devolvia ao navegador -- e esta
     * rota nao tem regra de papel, entao um vendedor lia a senha dos colegas. */
    const rSp = await fetch(base + '/api/salespeople', { headers: { Authorization: 'Bearer ' + tokenA } });
    const textoSp = await rSp.text();
    conferir('a listagem de vendedores nao devolve senha',
      textoSp.indexOf('senha-em-texto-puro') === -1 && textoSp.indexOf('password') === -1,
      'a resposta carrega a coluna password em texto puro: ' + textoSp.slice(0, 160));

    console.log('\n[L] acessos e o WhatsApp compartilhado');
    /* A M1.6b tem dois alvos, e o primeiro e o pior furo que este sistema teve:
     * a gestao de acessos aceitava id de qualquer clinica. A proprietaria da
     * Clinica A podia inativar, rebaixar ou TROCAR A SENHA de um usuario da
     * Clinica B. A troca de senha nao vaza dado -- abre uma porta. */
    const stInativar = await escrever('PATCH', '/api/users/u' + MARCA_B + 'adm',
      { status: 'inactive' });
    conferir('inativar o administrador da clinica B da 404', stInativar === 404,
      stInativar === 404 ? 'id conhecido e ainda assim nao encontrado -- e o certo' :
      'respondeu ' + stInativar + '! Isso tranca a proprietaria da vizinha fora ' +
      'do sistema dela, e ninguem do lado dela consegue desfazer');

    const stSenha = await escrever('PATCH', '/api/users/u' + MARCA_B + 'adm',
      { password: 'senha-longa-de-ensaio-123' });
    conferir('trocar a senha do administrador da clinica B da 404', stSenha === 404,
      stSenha === 404 ? 'e o pior caso de todos: senha trocada e entrada na conta dela' :
      'respondeu ' + stSenha + '! Com a senha trocada, a clinica A ENTRA na conta ' +
      'da clinica B -- nao e vazamento, e uma porta');

    /* A trava do "ultimo administrador ativo" agora conta POR CLINICA. Nao ha
     * como exercita-la pela rota sem um segundo administrador em cada lado (a
     * guarda do "proprio acesso" dispara antes), entao a conferencia e sobre a
     * CONSULTA: sem o filtro, a contagem global nunca chega a 1 com 50 clinicas
     * e a clinica se tranca do lado de fora -- a trava deixa de travar. */
    const fonteUsers = await import('node:fs')
      .then((fs) => fs.readFileSync(new URL('../server/routes/users.js', import.meta.url), 'utf8'));
    // Esta e a UNICA conferencia deste ensaio que olha o codigo em vez do
    // comportamento, e a razao esta escrita para ninguem confundir com preguica:
    // o ramo do 409 ("ultimo administrador ativo") NAO E ALCANCAVEL pela API
    // hoje. Ele exige que o alvo seja o unico admin ativo da clinica e que nao
    // seja quem esta pedindo -- e quem pede tem de ser admin para chegar na
    // rota. Se o alvo e o unico admin ativo e nao e quem pede, quem pede nao e
    // admin ativo: so acontece com token de um admin inativado momentos antes.
    // Nao da para montar isso por login, porque login recusa conta inativa.
    //
    // Entao o que se pode medir e a consulta. E ela e medida de forma que
    // sabotagem por `OR` nao passe: a primeira versao desta linha procurava
    // apenas a presenca de `clinica_id = :clinica`, e passou verde com
    // `(clinica_id = :clinica OR 1 = 1)` -- pego na propria rodada de sabotagem
    // da M1.6b, em 09/09. Nona vez que uma conferencia passava sem exercitar.
    const trecho = (fonteUsers.match(/COUNT\(\*\)[\s\S]{0,300}?role = 'admin'/) || [''])[0];
    conferir('a contagem de administradores ativos filtra por clinica',
      trecho.indexOf('clinica_id = :clinica') !== -1 && !/\bOR\b/.test(trecho),
      'trecho encontrado: ' + JSON.stringify(trecho.replace(/\s+/g, ' ')) +
      '. A contagem precisa filtrar clinica SEM alternativa: global, ela nunca ' +
      'chega a 1 e a clinica consegue inativar a propria unica administradora.');

    /* O WHATSAPP. Na M2.1a estas tres rotas RECUSAVAM com 503 quando existia
     * mais de uma clinica: a instancia era uma so, a caixa de entrada era
     * compartilhada, e mostrar seria entregar a conversa de uma clinica para
     * outra -- sem que filtro nenhum pudesse ajudar, porque o dado nao esta no
     * nosso banco.
     *
     * A M2.1b deu instancia a cada clinica, e a recusa deixou de ser necessaria:
     * cada uma le a caixa de entrada DELA. As conferencias antigas foram
     * trocadas em vez de removidas -- o comportamento mudou de proposito, e o
     * que se mede agora e que ele mudou para o lado certo. */
    for (const rota of ['/api/evolution/chats', '/api/evolution/contacts']) {
      const r = await fetch(base + rota, { headers: { Authorization: 'Bearer ' + tokenA } });
      conferir('a caixa de entrada da propria clinica abre (' + rota + ')', r.status === 200,
        r.status === 200 ? 'com instancia por clinica, nao ha mais o que recusar' :
        'respondeu ' + r.status + '. Com instancia configurada, a tela dela tem de abrir.');
    }

    /* E a conferencia decisiva, que usa DE NOVO o telefone repetido: o historico
     * de uma conversa junta o que veio do WhatsApp com o que esta no nosso
     * banco, e a parte do banco tem de ser so desta clinica. */
    const rMsg = await fetch(base + '/api/evolution/messages?number=5511900001111', {
      headers: { Authorization: 'Bearer ' + tokenA } });
    const msgs = rMsg.ok ? await rMsg.json() : [];
    const textosMsg = (Array.isArray(msgs) ? msgs : []).map((m) => String(m.content || ''));
    conferir('o historico da conversa abre', rMsg.status === 200,
      'respondeu ' + rMsg.status);
    conferir('e traz so a conversa DESTA clinica, com o telefone repetido',
      textosMsg.every((t) => t.indexOf('instancia da B') === -1 && t.indexOf('vizinha') === -1),
      'conteudos: ' + textosMsg.join(' | ') +
      '. O telefone 5511900001111 e da Maria Silva (A) e da Joana Alvez (B).');

    /* A IA: o vazamento que volta REESCRITO. A rota lia o historico de conversa
     * por id, sem filtro, e mandava para a IA como contexto. A sugestao voltava
     * construida sobre a conversa da paciente da vizinha -- sem id, sem marca, so
     * um texto plausivel que alguem copia e manda no WhatsApp. */
    const stIA = await escrever('POST', '/api/gemini/suggest-reply',
      { clientId: 'c' + MARCA_B + '1' });
    conferir('sugerir resposta para contato da clinica B da 404', stIA === 404,
      stIA === 404 ? 'recusado ANTES da chamada externa -- o dado sai do sistema nela' :
      'respondeu ' + stIA + '! O historico da vizinha viraria contexto de prompt');

    console.log('\n[M] o webhook do WhatsApp: a clinica sai da INSTANCIA');
    /* O caso decisivo da M2.1, e ele so existe porque a semente tem um TELEFONE
     * REPETIDO: `5511900001111` e da Maria Silva (clinica A) e tambem da Joana
     * Alvez (clinica B). Nao e hipotese -- a mesma pessoa pode ser paciente de
     * dois consultorios, e ate aqui o webhook resolvia por telefone.
     *
     * Com o telefone repetido, resolver por telefone e um sorteio. A instancia
     * que recebeu a mensagem e a unica resposta que nao e chute. */
    const bater = async (instancia, texto) => {
      const r = await fetch(base + '/api/webhook/whatsapp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance: instancia,
          data: {
            key: { remoteJid: '5511900001111@s.whatsapp.net', fromMe: false },
            pushName: 'Paciente do ensaio',
            messageType: 'conversation',
            message: { conversation: texto }
          }
        })
      });
      return { status: r.status, corpo: await r.json() };
    };

    const chegouNaA = await bater('instancia-da-clinica-a', 'mensagem pela instancia da A');
    conferir('mensagem na instancia da A e atribuida a clinica A',
      chegouNaA.corpo && chegouNaA.corpo.clinica === 'cl_1',
      'respondeu ' + JSON.stringify(chegouNaA.corpo) +
      '. Com telefone repetido entre clinicas, resolver por telefone e sorteio.');

    const chegouNaB = await bater('instancia-da-clinica-b', 'mensagem pela instancia da B');
    conferir('mensagem na instancia da B e atribuida a clinica B',
      chegouNaB.corpo && chegouNaB.corpo.clinica === 'cl_b',
      'respondeu ' + JSON.stringify(chegouNaB.corpo) +
      '. Se as duas caem na mesma clinica, o telefone venceu a instancia.');

    const orfa = await bater('instancia-de-ninguem', 'mensagem de instancia solta');
    conferir('instancia sem clinica NAO escolhe uma, e nao perde a mensagem',
      orfa.corpo && orfa.corpo.status === 'sem-clinica',
      'respondeu ' + JSON.stringify(orfa.corpo) +
      '. Escolher uma clinica seria inventa-la; descartar seria a paciente ficar sem resposta.');

    /* E a conferencia que fecha: a conversa da A NAO pode conter a mensagem que
     * chegou pela instancia da B, mesmo sendo o mesmo telefone. */
    const conversaA = await pegar('/api/interactions');
    const textosA = (Array.isArray(conversaA) ? conversaA : []).map((i) => String(i.content || ''));
    conferir('a conversa da clinica A tem a mensagem DELA',
      textosA.some((t) => t.indexOf('mensagem pela instancia da A') !== -1),
      'conteudos: ' + textosA.join(' | '));
    conferir('e NAO tem a que chegou pela instancia da B',
      textosA.every((t) => t.indexOf('mensagem pela instancia da B') === -1),
      'conteudos: ' + textosA.join(' | ') +
      '. Mesmo telefone, instancias diferentes: a mensagem e de quem recebeu.');
    conferir('nem a da instancia solta',
      textosA.every((t) => t.indexOf('mensagem de instancia solta') === -1),
      'conteudos: ' + textosA.join(' | '));

    console.log('\n[N] o lembrete e a instancia: configuracao por clinica');
    /* SEM ISTO A CONFERENCIA DA LISTA PASSA DE GRACA -- e a mesma regra 11 de
     * 09/09, agora aplicada a um servico externo. A lista simulada da Evolution
     * traz uma instancia so, e nao a da vizinha: sem o filtro, nao havia o que
     * filtrar, e a conferencia aprovava por nao ser necessaria.
     *
     * A lista e injetada aqui, no modulo que a aplicacao ja carregou, para o
     * cenario ficar malformado de proposito: as duas instancias existem na
     * Evolution, e uma delas e de outra clinica. */
    const evo = await import('../server/services/evolution.js');
    evo.SIMULATED_INSTANCES.length = 0;
    evo.SIMULATED_INSTANCES.push(
      { name: 'instancia-da-clinica-a', status: 'open', number: '5511900000001' },
      { name: 'instancia-da-clinica-b', status: 'open', number: '5511900000002' },
      { name: 'instancia-livre', status: 'close', number: null });
    /* A M2.1b nao e sobre filtro de leitura -- e sobre ALCANCE. Tres coisas que
     * com uma clinica so nao tem como dar errado, e com duas dao:
     *
     *  - o texto do lembrete de uma nao pode ser o da outra;
     *  - "Enviar agora" na tela nao pode disparar o WhatsApp das outras 49;
     *  - o QR Code de uma clinica NAO pode ser servido a outra -- quem le o QR
     *    passa a receber e a enviar as mensagens daquele consultorio. */
    const cfgA = await pegar('/api/appointments/reminders/settings');
    conferir('a configuracao traz a instancia DESTA clinica',
      cfgA && cfgA.instancia === 'instancia-da-clinica-a',
      'devolveu ' + JSON.stringify(cfgA));
    conferir('e o texto de lembrete e o DELA',
      cfgA && String(cfgA.template).indexOf('clinica A') !== -1 &&
      String(cfgA.template).indexOf('clinica B') === -1,
      'template: ' + JSON.stringify(cfgA && cfgA.template) +
      '. Texto da vizinha aqui sai no WhatsApp da paciente desta clinica.');

    /* A PREVIA. Ela existe para alguem conferir nomes e horarios ANTES de
     * mandar -- entao nome de paciente da vizinha aqui vem acompanhado do texto
     * da mensagem pronto do lado. */
    const previa = await pegar('/api/appointments/reminders/preview');
    const idsPrevia = ((previa && previa.itens) || []).map((i) => String(i.id));
    // A CONFERENCIA DE NAO-VAZIO VEM PRIMEIRO, e ela nasceu de a sabotagem
    // passar: a previa vinha VAZIA (o compromisso semeado ja tinha sido
    // concluido pelo bloco [E]), e lista vazia satisfaz "nao contem a vizinha"
    // sem medir filtro nenhum. Por isso ha um compromisso proprio da previa,
    // semeado longe o bastante para nenhum outro bloco encostar nele.
    conferir('a previa de lembrete tem linha para conferir',
      idsPrevia.length > 0,
      'previa vazia. Vazio satisfaz a conferencia de baixo sem medir nada.');
    conferir('a previa de lembrete nao lista compromisso da clinica B',
      idsPrevia.every((id) => id.indexOf(MARCA_B) === -1),
      'compromissos na previa: ' + idsPrevia.join(', '));

    /* O QR CODE da vizinha. Nao e 403: 404, para nao confirmar que aquela
     * instancia existe. */
    const rQr = await fetch(base + '/api/evolution/instances/connect/instancia-da-clinica-b', {
      headers: { Authorization: 'Bearer ' + tokenA } });
    conferir('o QR Code da instancia da clinica B da 404', rQr.status === 404,
      rQr.status === 404 ? 'quem le o QR assume a sessao de WhatsApp daquela clinica' :
      'respondeu ' + rQr.status + '! A clinica A poderia assumir o WhatsApp da B');

    /* E a instancia da vizinha nao pode ser REIVINDICADA. A ultima linha de
     * defesa e a unicidade no banco, criada pela migration 024. */
    const rClaim = await fetch(base + '/api/evolution/instance', {
      method: 'PUT', headers: comoA,
      body: JSON.stringify({ instanceName: 'instancia-da-clinica-b' }) });
    conferir('vincular instancia existente e recusado para a clinica', rClaim.status === 403,
      rClaim.status === 403 ? 'escolher entre instancias existentes exige enxergar o servidor ' +
      'da Evolution, que hospeda outros negocios -- e isso e da plataforma (M3)' :
      'respondeu ' + rClaim.status + '! Bastaria adivinhar o nome para tomar a instancia ' +
      'de qualquer coisa hospedada ali');
    /* HONESTIDADE SOBRE O QUE ESTA CONFERENCIA MEDE, e ela e o exemplo mais
     * limpo da regra 13 neste projeto.
     *
     * Removendo a checagem da rota, ela continuou VERDE -- porque a unicidade
     * criada pela migration 024 recusa o UPDATE no banco e o `catch` de
     * ER_DUP_ENTRY devolve o mesmo 409. A segunda camada aprova a sabotagem da
     * primeira, e nao ha como distinguir as duas daqui.
     *
     * Entao o que esta conferido e o RESULTADO -- a instancia da vizinha nao e
     * reivindicavel --, garantido por duas camadas, e nao a checagem da rota. A
     * checagem existe para dar mensagem decente; o banco e quem impede. Isto
     * fica escrito para ninguem ler esta linha como prova do que ela nao prova. */
    const depoisDoClaim = await pegar('/api/evolution/status');
    conferir('e a instancia desta clinica continua sendo a dela',
      depoisDoClaim && depoisDoClaim.instance === 'instancia-da-clinica-a',
      'status: ' + JSON.stringify(depoisDoClaim));

    /* A lista de instancias: antes devolvia a lista inteira da Evolution, com o
     * nome e o numero das outras clinicas. Nao e vazamento do nosso banco -- e
     * pela porta de um servico externo, que filtro nenhum alcanca. */
    /* A lista de instancias. A semente tem TRES: a da clinica A, a da B, e uma
     * `instancia-livre` -- e a livre esta ali por causa de 10/09, quando a tela
     * de producao mostrou uma instancia de OUTRO NEGOCIO no mesmo servidor da
     * Evolution. "Livre" nao quer dizer "de ninguem": quer dizer "nao vinculada
     * a nenhuma clinica deste CRM". Entao a lista mostra so a dela. */
    const listaInst = await pegar('/api/evolution/instances');
    const nomesInst = (Array.isArray(listaInst) ? listaInst : []).map((i) => String(i.name || ''));
    conferir('a lista de instancias mostra a DELA', nomesInst.length === 1 &&
      nomesInst[0] === 'instancia-da-clinica-a',
      'instancias visiveis: ' + nomesInst.join(', '));
    conferir('e nao mostra a da clinica B nem a livre',
      nomesInst.indexOf('instancia-da-clinica-b') === -1 &&
      nomesInst.indexOf('instancia-livre') === -1,
      'instancias visiveis: ' + nomesInst.join(', ') +
      '. Instancia livre pode ser de outro negocio hospedado no mesmo servidor.');

    console.log('\n[O] a expiracao de pontos, por clinica');
    /* A ultima varredura a virar por clinica (M2.3), e a que fechou o portao da
     * M1.7. O defeito que a separacao evita e especifico: a fila de acumulos e
     * POR PACIENTE, e a funcao pura decide o que expirar olhando a fila inteira
     * que recebe. Misturando clinicas, o consumo de uma paciente apagaria o
     * ponto de outra -- e o extrato ficaria impossivel de explicar. */
    const rExp2 = await fetch(base + '/api/loyalty/expire', { method: 'POST', headers: comoA });
    const expOut = rExp2.ok ? await rExp2.json() : null;
    conferir('expirar pontos pela tela responde 200', rExp2.status === 200,
      'respondeu ' + rExp2.status);
    conferir('e a passada pela tela e de UMA clinica, nao de todas',
      expOut && expOut.porClinica === undefined && expOut.clinicas === undefined,
      'devolveu ' + JSON.stringify(expOut) +
      '. `porClinica` na resposta da tela significa que o botao da Clinica A mexeu ' +
      'no extrato de pontos das outras 49 -- e cada linha dessas aparece no extrato ' +
      'da paciente como se a clinica tivesse feito.');

    /* O NUMERO. Ha um acumulo vencido semeado em CADA clinica: a passada da A
     * tem de expirar exatamente UM. Zero significaria filtro que nao devolve
     * nada -- e ai a conferencia de cima passaria de graca, que foi o que
     * aconteceu na primeira rodada de sabotagem. Dois significa que ela expirou
     * o ponto da paciente da vizinha. */
    conferir('a passada expirou UM acumulo: o desta clinica',
      expOut && expOut.expirados === 1 && expOut.pontos === 100,
      'expirados: ' + JSON.stringify(expOut && expOut.expirados) +
      ', pontos: ' + JSON.stringify(expOut && expOut.pontos) +
      '. Zero = filtro que nao devolve nada; dois = mexeu no extrato da vizinha.');
    conferir('e o detalhe cita a paciente DESTA clinica',
      expOut && (expOut.detalhe || []).every((d) => String(d.paciente || '').indexOf('Souza') === -1),
      'detalhe: ' + JSON.stringify(expOut && expOut.detalhe) +
      '. "Maria Souza" e a paciente da clinica B.');

    /* E a prova do outro lado: o acumulo vencido da clinica B continua VIVO. Sem
     * isto, "expirou um" nao distingue "expirou o certo" de "expirou o errado". */
    const extratoB = await pegar('/api/clients/c' + MARCA_B + '1/loyalty', tokenB);
    const expiradoNaB = JSON.stringify(extratoB || {}).indexOf('EXPIRACAO') !== -1;
    conferir('o acumulo vencido da clinica B NAO foi expirado pela passada da A',
      !expiradoNaB,
      'extrato da paciente da B: ' + JSON.stringify(extratoB).slice(0, 200) +
      '. Uma linha de EXPIRACAO ali foi a clinica A quem criou.');

    /* E o saldo da paciente da A continua o dela: 450, e nao 5450. A linha
     * cruzada de 5000 pontos da vizinha esta semeada desde a M1.4. */
    const extratoDepois = await pegar('/api/clients/c_a_1/loyalty');
    const saldoDepois = extratoDepois && (extratoDepois.saldo !== undefined
      ? extratoDepois.saldo : (extratoDepois.balance));
    conferir('o saldo da paciente nao foi mexido pela expiracao da vizinha',
      Number(saldoDepois) === 450,
      'saldo: ' + JSON.stringify(saldoDepois) + ' (esperado 450)');

    console.log('\n[F] um atendimento da clinica B nao se conclui pela sessao da A');
    const rF = await fetch(base + '/api/appointments/ap' + MARCA_B + '1/status', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'REALIZADO' })
    });
    conferir('a clinica A recebe 404 no compromisso da B', rF.status === 404,
      rF.status === 404 ? 'id conhecido e ainda assim nao encontrado -- e o certo' :
      'respondeu ' + rF.status + ', e nao 404!');

    console.log('\n[D] as sessoes casadas ao plano em memoria');
    // As duas clinicas tem sessoes 1, 2 e 3. A resposta da A tem de trazer TRES
    // -- nao seis. Contar a marca `_b_` nao pegaria isto sozinho: se a leitura
    // de sessoes nao filtrasse clinica mas os planos filtrassem, as sessoes da
    // B nao encontrariam plano e a resposta sairia limpa. A contagem pega.
    const rD = await fetch(base + '/api/treatment-plans', { headers: { Authorization: 'Bearer ' + tokenA } });
    const planos = await rD.json();
    const sessoes = Array.isArray(planos) && planos[0] ? (planos[0].sessions || []) : [];
    conferir('o plano da clinica A tem 3 sessoes', sessoes.length === 3,
      sessoes.length === 3 ? '' : 'tem ' + sessoes.length + '. Quatro significa que a sessao ' +
      'CRUZADA da clinica B entrou no plano da A -- prontuario de outra clinica.');
    conferir('nenhuma sessao com marca da clinica B',
      sessoes.filter((x) => String(x.id).indexOf(MARCA_B) !== -1).length === 0,
      'ids: ' + sessoes.map((x) => x.id).join(', '));

    console.log('\n[I] as outras duas linhas cruzadas');
    const ficha = await pegar('/api/services/tc_a_1/supplies');
    const idsFicha = (ficha.itens || []).map((i) => i.productId);
    conferir('a ficha tecnica da clinica A nao traz insumo da B',
      idsFicha.filter((id) => String(id).indexOf(MARCA_B) !== -1).length === 0,
      'insumos: ' + idsFicha.join(', ') + '. Insumo da vizinha aqui faz a conclusao ' +
      'recusar com "estoque insuficiente" de produto que esta na prateleira');
    conferir('a ficha traz o insumo dela', idsFicha.indexOf('pr_a_1') !== -1,
      'insumos: ' + idsFicha.join(', '));

    /* ======================== OS PONTOS: AQUI A MARCA E CEGA, E O NUMERO NAO
     *
     * O relatorio de pontos devolve saldo AGREGADO -- nunca id de lancamento.
     * A conferencia por marca `_b_` nao ve nada aqui, vaze ou nao vaze. Foi
     * anotado na M1.3 e a M1.4 tinha de fechar medindo o valor.
     *
     * A linha cruzada da semente credita 5000 pontos da clinica B na paciente
     * `c_a_1` da clinica A. Saldo de pontos e credito em dinheiro: 5000 pontos
     * virariam desconto que esta clinica paga sem ter vendido nada. */
    const extrato = await pegar('/api/clients/c_a_1/loyalty');
    conferir('o extrato da paciente NAO tem os 5000 pontos da vizinha',
      Number(extrato.saldo) !== 5000 && Number(extrato.saldo) < 5000,
      'saldo veio ' + JSON.stringify(extrato.saldo) +
      '. Se vier 5000 ou mais, a linha cruzada entrou no saldo dela');
    const idsExtrato = (extrato.extrato || []).map((t) => t.id);
    conferir('nenhum lancamento da clinica B no extrato dela',
      idsExtrato.filter((id) => String(id).indexOf(MARCA_B) !== -1).length === 0,
      'lancamentos: ' + idsExtrato.join(', '));
    conferir('e ela tem o ponto DELA, do atendimento concluido',
      Number(extrato.saldo) > 0,
      'saldo ' + JSON.stringify(extrato.saldo) + ' -- zero significaria filtro ' +
      'que nao devolve nada, e ai a conferencia de cima passaria de graca');

    const pontos = await pegar('/api/loyalty/report');
    conferir('o passivo em circulacao nao carrega os 5000 da vizinha',
      Number(pontos.saldoEmCirculacao) > 0 && Number(pontos.saldoEmCirculacao) < 5000,
      'circulacao veio ' + JSON.stringify(pontos.saldoEmCirculacao));
    conferir('o relatorio conta 1 paciente com saldo, nao 2',
      pontos.pacientesComSaldo === 1,
      'veio ' + JSON.stringify(pontos.pacientesComSaldo));

    // A clinica B tem de ver os 5000 dela -- a linha cruzada e DELA, afinal.
    const pontosB = await pegar('/api/loyalty/report', tokenB);
    conferir('a clinica B ve o passivo dela, com os 5000',
      Number(pontosB.saldoEmCirculacao) >= 5000,
      'circulacao da B veio ' + JSON.stringify(pontosB.saldoEmCirculacao) +
      ' -- e a prova de que o filtro separa, e nao apenas esconde');

    // Ajustar pontos de paciente da vizinha tem de ser recusado.
    const rAjP = await fetch(base + '/api/clients/c' + MARCA_B + '1/loyalty/adjust', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: 100, description: 'ensaio' })
    });
    conferir('ajustar pontos de paciente da clinica B da 404', rAjP.status === 404,
      rAjP.status === 404 ? 'id conhecido e ainda assim nao encontrado -- e o certo' :
      'respondeu ' + rAjP.status + '! Isso creditaria desconto na paciente dela');

    /* ================================ [R] O NASCIMENTO DE UMA CLINICA (M2.4)
     *
     * Este bloco existe para responder uma pergunta que nenhum outro responde:
     * **uma clinica criada pela rota consegue trabalhar?**
     *
     * A clinica 1 e a do ensaio nasceram de migrations e de semente, que e um
     * caminho diferente e mais generoso. Uma clinica de verdade nasce por aqui,
     * e "a rota respondeu 201" nao prova nada: em 04/09 uma conferencia chamou
     * cinco rotas de LEITURA e declarou a tarefa pronta com o sistema incapaz de
     * inserir uma linha.
     *
     * Entao a ordem e: cria, ENTRA nela, e confere as duas metades --
     *
     *  - o que ela tem de ter para trabalhar (administrador, 16 categorias,
     *    preco, pontos, modelos). Faltando qualquer um, ha uma tela que recusa
     *    e ninguem sabe por que;
     *  - o que ela NAO pode ver: nenhum paciente, nenhum lead, nenhum produto
     *    das outras duas. Clinica nova que nasce enxergando a vizinha e o pior
     *    defeito possivel neste projeto, e seria o primeiro que um cliente novo
     *    encontraria. */
    console.log('\n[R] o nascimento de uma clinica: ela nasce inteira e nasce VAZIA?');
    {
      const SENHA_NOVA = 'senha-da-clinica-nova-123';
      const rCria = await fetch(base + '/api/plataforma/clinicas', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tokenDaPlataforma, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: 'Clinica Recem-Nascida',
          adminNome: 'Dona da Nova',
          adminEmail: 'dona@nova.invalido',
          adminSenha: SENHA_NOVA
        })
      });
      const nova = await rCria.json().catch(() => ({}));
      conferir('a rota cria a clinica', rCria.status === 201,
        'respondeu ' + rCria.status + ' ' + JSON.stringify(nova).slice(0, 120));

      conferir('e ela nasce COMPLETA', nova.conferencia && nova.conferencia.ok === true,
        nova.conferencia
          ? 'faltas: ' + JSON.stringify(nova.conferencia.faltas)
          : 'a resposta nem trouxe conferencia -- "criou sem erro" nao e "funciona"');
      conferir('com as 16 categorias financeiras',
        nova.conferencia && nova.conferencia.categoriasFinanceiras === 16,
        'veio ' + (nova.conferencia && nova.conferencia.categoriasFinanceiras) +
        '. Sem elas, a clinica nao lanca a primeira despesa');
      conferir('com configuracao de preco e programa de pontos',
        nova.conferencia && nova.conferencia.configuracaoDePreco === 1 &&
        nova.conferencia.programaDePontos === 1,
        'preco: ' + (nova.conferencia && nova.conferencia.configuracaoDePreco) +
        ', pontos: ' + (nova.conferencia && nova.conferencia.programaDePontos) +
        '. Era a chave primaria de linha unica que impedia isso ate a migration 030');
      conferir('com os dois modelos de documento',
        nova.conferencia && nova.conferencia.modelosDeDocumento === 2,
        'veio ' + (nova.conferencia && nova.conferencia.modelosDeDocumento) +
        '. Sem modelo, nao ha anamnese');
      conferir('e com chave de captacao propria',
        !!nova.chaveCaptacao && nova.chaveCaptacao !== CHAVE_B_DO_ENSAIO,
        'chave: ' + nova.chaveCaptacao);

      // ---- e agora a metade que importa: ela ENXERGA alguma coisa?
      const rEntrar = await fetch(base + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dona@nova.invalido', password: SENHA_NOVA })
      });
      conferir('da para ENTRAR na clinica nova', rEntrar.status === 200,
        'respondeu ' + rEntrar.status + ' -- clinica que ninguem consegue acessar nao nasceu');
      const tokenN = rEntrar.ok ? (await rEntrar.json()).token : null;

      if (tokenN) {
        const comoNova = (rota) => fetch(base + rota, {
          headers: { Authorization: 'Bearer ' + tokenN } }).then((r) => r.json());

        const pacientes = await comoNova('/api/clients');
        const leads = await comoNova('/api/leads');
        const catalogo = await comoNova('/api/treatment-catalog');
        conferir('a clinica nova nao ve paciente nenhum', Array.isArray(pacientes) && pacientes.length === 0,
          'veio ' + (Array.isArray(pacientes) ? pacientes.length : JSON.stringify(pacientes).slice(0, 60)) +
          ' -- clinica nova enxergando paciente da vizinha e o pior defeito possivel aqui');
        conferir('nem lead nenhum', Array.isArray(leads) && leads.length === 0,
          'veio ' + (Array.isArray(leads) ? leads.length : '?'));
        conferir('nem servico do catalogo da vizinha', Array.isArray(catalogo) && catalogo.length === 0,
          'veio ' + (Array.isArray(catalogo) ? catalogo.length : '?'));

        // ---- mas TEM o que e dela
        const categorias = await comoNova('/api/finance/categories');
        const lista = Array.isArray(categorias) ? categorias : (categorias.itens || []);
        conferir('mas TEM as proprias 16 categorias financeiras', lista.length === 16,
          'veio ' + lista.length + '. Zero aqui significaria clinica que nao lanca despesa');
        conferir('e a categoria de receita do atendimento e a DELA',
          lista.some((c) => c.id === 'cat_procedimentos'),
          'sem `cat_procedimentos` proprio, a receita do atendimento cai na categoria da vizinha ' +
          'ou em nenhuma');

        // ---- e a captacao dela leva o lead para ela
        const rLead = await fetch(base + '/api/leads?captacao=' + nova.chaveCaptacao, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Lead Da Nova', whatsapp: '5511988887777', treatment: 'Ensaio' })
        });
        conferir('a chave de captacao dela funciona', rLead.status === 201,
          'respondeu ' + rLead.status);
        const leadsDepois = await comoNova('/api/leads');
        conferir('e o lead chega NELA', leadsDepois.some((l) => l.name === 'Lead Da Nova'),
          'leads da clinica nova: ' + leadsDepois.length);
        const leadsA = await fetch(base + '/api/leads',
          { headers: { Authorization: 'Bearer ' + tokenA } }).then((r) => r.json());
        conferir('e NAO na clinica A', !leadsA.some((l) => l.name === 'Lead Da Nova'),
          'o lead da clinica nova apareceu no funil da A');
      }

      /* ---- e-mail repetido: recusa, sem contar que o endereco existe -- E SEM
       *      deixar meia clinica gravada.
       *
       * Esta e a conferencia mais importante do bloco, e ela pega carona numa
       * recusa que ja acontece. A gravacao da clinica vem ANTES da do usuario,
       * entao um e-mail repetido falha **no meio**: se a transacao nao estiver
       * segurando, sobra uma clinica sem administrador nenhum -- existe, ninguem
       * entra, e ninguem descobre ate alguem tentar. */
      const contarClinicas = async () => {
        const c = await mysql.createConnection({
          host: HOST, port: PORTA, user: USUARIO, password: SENHA, database: BANCO });
        const [r] = await c.query('SELECT COUNT(*) AS n FROM clinicas');
        await c.end();
        return Number(r[0].n);
      };
      const clinicasAntes = await contarClinicas();

      const rRepetido = await fetch(base + '/api/plataforma/clinicas', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tokenDaPlataforma, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: 'Outra Qualquer', adminNome: 'Fulana',
          adminEmail: 'dona@nova.invalido', adminSenha: 'outra-senha-longa-1'
        })
      });
      const corpoRep = await rRepetido.json().catch(() => ({}));
      conferir('e-mail ja usado em outra clinica e RECUSADO', rRepetido.status === 409,
        'respondeu ' + rRepetido.status);
      conferir('e a recusa NAO conta que o endereco existe',
        !/ja existe|em uso|cadastrad/i.test(corpoRep.error || ''),
        'mensagem: "' + (corpoRep.error || '') + '". Dizer "ja existe" conta a quem esta ' +
        'cadastrando que aquele e-mail esta em uso em ALGUMA clinica da plataforma -- ' +
        'informacao de um cliente escapando para outro, de graca para quem quiser sondar');

      const clinicasDepois = await contarClinicas();
      conferir('e a recusa NAO deixou meia clinica gravada', clinicasDepois === clinicasAntes,
        'antes ' + clinicasAntes + ', depois ' + clinicasDepois + '. A clinica e gravada ANTES do ' +
        'usuario: sem transacao, sobra uma clinica sem administrador -- existe, ninguem entra, e ' +
        'ninguem descobre ate alguem tentar');
    }

    /* =========================================== [Q] A CAPTACAO PUBLICA, POR CLINICA
     *
     * Esta e a rota que decide **onde o dinheiro entra**: o formulario do site
     * posta aqui, sem sessao, e ate 11/09 nao havia como ela saber de qual
     * clinica era o contato. A saida escolhida foi a chave publica por clinica.
     *
     * As tres coisas que precisam ser verdade ao mesmo tempo, e nenhuma delas e
     * conferida por outro bloco:
     *
     *  - a chave leva o lead para a clinica CERTA (e nao so "para alguma");
     *  - chave errada e ausencia de chave sao RECUSA, e nao chute -- lead
     *    arquivado debaixo da clinica errada e dinheiro que some sem sintoma;
     *  - a chave que cada clinica LE e a dela, e nao a da vizinha. Se essa
     *    ultima falhar, uma clinica configura o site com a chave da outra e
     *    passa a alimentar o funil do concorrente sem ninguem perceber.
     *
     * Cada recusa e conferida com um irmao que TEM de passar, pelo mesmo motivo
     * do bloco [P]: recusa por erro de digitacao na minha requisicao pareceria
     * contencao. */
    console.log('\n[Q] a captacao publica: a chave leva o lead para a clinica certa?');
    {
      const CHAVE_B = CHAVE_B_DO_ENSAIO;
      const postarLead = (nome, qs) => fetch(base + '/api/leads' + qs, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nome, whatsapp: '5511999990000', treatment: 'Ensaio' })
      });

      // ---- a chave de cada clinica, lida por ela mesma
      const rCapA = await fetch(base + '/api/leads/captacao',
        { headers: { Authorization: 'Bearer ' + tokenA } });
      const capA = await rCapA.json().catch(() => ({}));
      const rCapB = await fetch(base + '/api/leads/captacao',
        { headers: { Authorization: 'Bearer ' + tokenB } });
      const capB = await rCapB.json().catch(() => ({}));

      conferir('cada clinica le a chave DELA', !!capA.chave && !!capB.chave,
        'A: ' + JSON.stringify(capA.chave) + ' / B: ' + JSON.stringify(capB.chave) +
        '. Chave nula aqui faria a conferencia de baixo passar sem medir nada');
      conferir('e as duas chaves sao DIFERENTES', capA.chave !== capB.chave,
        capA.chave === capB.chave
          ? 'MESMA CHAVE nas duas! Uma clinica configuraria o site e alimentaria o funil da outra'
          : 'cada uma tem a sua');
      conferir('a clinica A nao recebe a chave da B', capA.chave !== CHAVE_B,
        'a da B e conhecida (' + CHAVE_B + '); se a A a recebesse, o vazamento seria de configuracao');
      conferir('e a da clinica B e a que a semente gravou', capB.chave === CHAVE_B,
        'veio ' + JSON.stringify(capB.chave) + '. Se vier outra, a rota nao esta lendo a propria clinica');

      // ---- o lead com a chave da B tem de nascer na B
      const rB = await postarLead('Lead Da Vizinha', '?captacao=' + CHAVE_B);
      conferir('lead com a chave da clinica B e ACEITO', rB.status === 201,
        'respondeu ' + rB.status);

      const lidosA = await fetch(base + '/api/leads',
        { headers: { Authorization: 'Bearer ' + tokenA } }).then((r) => r.json());
      const lidosB = await fetch(base + '/api/leads',
        { headers: { Authorization: 'Bearer ' + tokenB } }).then((r) => r.json());
      const naA = lidosA.some((l) => l.name === 'Lead Da Vizinha');
      const naB = lidosB.some((l) => l.name === 'Lead Da Vizinha');
      conferir('e ele aparece no funil da B', naB,
        naB ? 'chegou em quem devia' : 'nao chegou em ninguem -- a chave nao carimbou');
      conferir('e NAO aparece no funil da A', !naA,
        naA ? 'VAZOU: o lead da vizinha esta no funil da clinica A' : 'como esperado');

      // ---- chave que nao existe: recusa, e nada gravado
      const antes = lidosA.length + lidosB.length;
      const rFalsa = await postarLead('Lead De Chave Falsa', '?captacao=cap_nao_existe');
      conferir('chave inexistente e RECUSADA', rFalsa.status === 503,
        'respondeu ' + rFalsa.status + ' (esperado 503)');

      // ---- sem chave, com DUAS clinicas: recusa. E o compromisso central.
      const rSem = await postarLead('Lead Sem Chave', '');
      conferir('sem chave, havendo duas clinicas, e RECUSADO', rSem.status === 503,
        rSem.status === 503
          ? 'recusa alta e visivel, em vez de arquivar debaixo de uma clinica no chute'
          : 'respondeu ' + rSem.status + '! Este lead foi para a clinica de alguem no chute');

      const depoisA = await fetch(base + '/api/leads',
        { headers: { Authorization: 'Bearer ' + tokenA } }).then((r) => r.json());
      const depoisB = await fetch(base + '/api/leads',
        { headers: { Authorization: 'Bearer ' + tokenB } }).then((r) => r.json());
      conferir('e as duas recusas nao gravaram nada', depoisA.length + depoisB.length === antes,
        'antes ' + antes + ', depois ' + (depoisA.length + depoisB.length) +
        '. Recusar e responder 503 E nao gravar; so o 503 seria mentira');

      // ---- o registro do lead tem de ser visivel para quem o recebeu
      //
      // Ate 11/09 o log da captacao ia para a instalacao, e linha sem clinica e
      // invisivel em toda tela desde a M1.6a: a clinica que recebia o lead
      // nunca via o registro de que ele chegou.
      const logsB = await fetch(base + '/api/logs',
        { headers: { Authorization: 'Bearer ' + tokenB } }).then((r) => r.json());
      const listaB = Array.isArray(logsB) ? logsB : (logsB.itens || logsB.logs || []);
      conferir('a trilha da clinica B registra o lead que ela recebeu',
        listaB.some((l) => (l.description || '').indexOf('Lead Da Vizinha'.split(' ')[0]) !== -1),
        listaB.length + ' registro(s) na trilha da B. Zero aqui significaria trilha vazia, e a ' +
        'conferencia passaria de graca');

      const logsA = await fetch(base + '/api/logs',
        { headers: { Authorization: 'Bearer ' + tokenA } }).then((r) => r.json());
      const listaA = Array.isArray(logsA) ? logsA : (logsA.itens || logsA.logs || []);
      conferir('e a trilha da A NAO conta que a vizinha recebeu um lead',
        !listaA.some((l) => (l.description || '').indexOf('Lead Da Vizinha') !== -1),
        'nome e whatsapp de lead sao dado de pessoa: a trilha da vizinha nao e lugar para eles');
    }

    /* ============================= [S] A PORTA DE DENTRO: CRIAR LEAD COM SESSAO
     *
     * O bloco [Q] acima mede a porta da RUA, e o compromisso central dela e
     * recusar quem nao diz de qual clinica e o lead. Este mede a porta de
     * DENTRO, e o compromisso dela e o oposto: quem tem sessao nunca precisa
     * dizer nada, porque a sessao ja diz.
     *
     * Ele existe por causa de um defeito de 11/09 que nenhuma conferencia pegou
     * e que a segunda clinica revelou em producao: **duas telas do CRM criavam
     * lead pela porta publica** -- o "iniciar nova conversa" do Atendimento e o
     * "adicionar lead" do Kanban. Enquanto havia uma clinica so, a porta publica
     * respondia "a unica que existe" e tudo funcionava. No dia da segunda, as
     * duas telas passaram a receber 503.
     *
     * A licao que este bloco fixa: **rota publica que funciona por falta de
     * ambiguidade nao esta funcionando -- esta adiando.** O ensaio sempre teve
     * duas clinicas e mesmo assim nao viu, porque media a rota, e nao QUEM a
     * chamava.
     *
     * E a recusa de cada conferencia vem com um irmao que tem de passar, pela
     * mesma razao dos blocos [P] e [Q]. */
    console.log('\n[S] a porta de dentro: quem tem sessao cria lead sem chave nenhuma?');
    {
      const criarManual = (token, corpo) => fetch(base + '/api/leads/manual', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' },
          token ? { Authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify(corpo)
      });

      // ---- o caso que quebrou em producao: sessao, sem chave, duas clinicas
      const rA = await criarManual(tokenA, {
        name: 'Contato Do Atendimento', whatsapp: '5511900000001', treatment: 'Ensaio interno'
      });
      conferir('com sessao e SEM chave de captacao, o lead e ACEITO', rA.status === 201,
        rA.status === 201
          ? 'a clinica saiu do token, que e o unico lugar de onde ela pode sair'
          : 'respondeu ' + rA.status + '. Este e o 503 que quebrou o Atendimento e o Kanban ' +
            'no dia em que a segunda clinica nasceu');

      const corpoA = await rA.json().catch(() => ({}));
      conferir('e a resposta devolve o id do lead criado', !!corpoA.id,
        'sem id o Atendimento nao consegue selecionar a conversa recem-criada');

      // ---- e ele nasce na clinica de quem chamou, nao em "alguma"
      const funilA = await fetch(base + '/api/leads',
        { headers: { Authorization: 'Bearer ' + tokenA } }).then((r) => r.json());
      const funilB = await fetch(base + '/api/leads',
        { headers: { Authorization: 'Bearer ' + tokenB } }).then((r) => r.json());
      conferir('ele aparece no funil de quem o criou', 
        funilA.some((l) => l.name === 'Contato Do Atendimento'),
        'se nao aparecer, a gravacao carimbou outra clinica -- ou nenhuma');
      conferir('e NAO aparece no funil da clinica B',
        !funilB.some((l) => l.name === 'Contato Do Atendimento'),
        'VAZOU: contato cadastrado na A apareceu no funil da B');

      // ---- a clinica NAO pode ser escolhida pelo pedido
      //
      // A camada ja garante isso (`:clinica` sai de req.usuario), mas quem le a
      // rota nao ve a camada. Aqui fica medido: mandar a chave da vizinha, o id
      // dela e a coluna crua no corpo nao muda nada.
      const rTruque = await criarManual(tokenA, {
        name: 'Contato Com Truque', whatsapp: '5511900000002', treatment: 'Ensaio interno',
        captacao: CHAVE_B_DO_ENSAIO, clinica_id: 'cl_b', clinicaId: 'cl_b'
      });
      conferir('mandar a chave e o id da clinica B no corpo nao e recusado', rTruque.status === 201,
        'respondeu ' + rTruque.status + '; o pedido e legitimo, o que nao pode e ele escolher a clinica');
      const funilB2 = await fetch(base + '/api/leads',
        { headers: { Authorization: 'Bearer ' + tokenB } }).then((r) => r.json());
      const funilA2 = await fetch(base + '/api/leads',
        { headers: { Authorization: 'Bearer ' + tokenA } }).then((r) => r.json());
      conferir('e o lead foi para a clinica da SESSAO, nao para a do corpo',
        funilA2.some((l) => l.name === 'Contato Com Truque') &&
        !funilB2.some((l) => l.name === 'Contato Com Truque'),
        'se ele estiver na B, o corpo da requisicao escolheu o inquilino -- a falha mais grave ' +
        'possivel nesta rota');

      // ---- a porta de dentro NAO e publica
      const rSemToken = await criarManual('', {
        name: 'Contato Sem Sessao', whatsapp: '5511900000003', treatment: 'Ensaio interno'
      });
      conferir('sem sessao, a rota responde 401', rSemToken.status === 401,
        'respondeu ' + rSemToken.status + '. Se ela aceitasse sem token, seria uma segunda porta ' +
        'publica -- e essa sem chave de captacao nenhuma');

      // ---- e ela continua recusando pedido incompleto (o irmao que passa)
      const rVazio = await criarManual(tokenA, { name: 'So O Nome' });
      conferir('pedido sem whatsapp e sem interesse e recusado com 400', rVazio.status === 400,
        'respondeu ' + rVazio.status + '; sem esta, o 401 acima poderia ser "recusa tudo"');

      // ---- a trilha registra QUEM cadastrou, e nao "Sistema (Site/Formulario)"
      const trilhaA = await fetch(base + '/api/logs',
        { headers: { Authorization: 'Bearer ' + tokenA } }).then((r) => r.json());
      const listaTrilhaA = Array.isArray(trilhaA) ? trilhaA : (trilhaA.itens || trilhaA.logs || []);
      const registro = listaTrilhaA.filter(
        (l) => (l.description || '').indexOf('Contato Do Atendimento'.split(' ')[0]) !== -1)[0];
      conferir('a trilha da A registra o cadastro feito no CRM', !!registro,
        listaTrilhaA.length + ' registro(s) na trilha. Zero faria a conferencia de baixo passar de graca');
      conferir('e o autor e a pessoa que cadastrou, nao "Sistema (Site/Formulario)"',
        !!registro && (registro.author || '').indexOf('Sistema (Site') === -1,
        'autor registrado: ' + JSON.stringify(registro && registro.author) + '. Quem audita seis ' +
        'meses depois precisa saber que foi gente, e qual');
    }

    /* ============================ [T] O OPERADOR DA PLATAFORMA (M3.1, 14/09)
     *
     * O papel mais perigoso do sistema, e a razao esta escrita desde 03/09: um
     * operador da Mulino com acesso irrestrito abre a anamnese de qualquer
     * paciente de qualquer uma das 50 clinicas -- e esse e o desenho PADRAO de
     * quem constroi administracao de plataforma sem pensar, porque "o admin ve
     * tudo" e o caminho de menor esforco.
     *
     * Entao este bloco nao mede o que ele CONSEGUE fazer; mede o que lhe e
     * RECUSADO, rota por rota, com um token legitimo na mao. E cada recusa vem
     * com o irmao que passa -- a listagem de clinicas -- porque um token que
     * nao funciona em nada tambem produziria todos os 403 abaixo. */
    console.log('\n[T] o operador da plataforma: administra as clinicas sem ler nenhuma?');
    {
      const entrarNaPlataforma = await fetch(base + '/api/plataforma/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'operadora@ensaio.invalido', senha: SENHA_TESTE })
      });
      const dadosDaEntrada = await entrarNaPlataforma.json().catch(() => ({}));
      const tokenP = dadosDaEntrada.token || '';

      conferir('o operador entra pela porta dele', entrarNaPlataforma.status === 200 && !!tokenP,
        'respondeu ' + entrarNaPlataforma.status + '. Sem token, todas as recusas abaixo seriam ' +
        'de graca');

      const comoPlataforma = (rota, init) => fetch(base + rota, Object.assign({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenP }
      }, init || {}));

      // ---- o irmao que TEM de passar
      const rLista = await comoPlataforma('/api/plataforma/clinicas');
      const lista = await rLista.json().catch(() => ({}));
      conferir('e enxerga as clinicas da instalacao', rLista.status === 200 &&
        (lista.clinicas || []).length >= 2,
        'respondeu ' + rLista.status + ' com ' + ((lista.clinicas || []).length) + ' clinica(s)');

      // ---- e o que ele enxerga sao NUMEROS, nao gente
      const cru = JSON.stringify(lista);
      conferir('a listagem NAO contem nome de paciente nenhum',
        cru.indexOf('Maria') === -1 && cru.indexOf('Joana') === -1,
        'a semente tem "Maria Silva" na clinica A e "Maria Souza" na B: se qualquer uma aparecer ' +
        'aqui, a tela da plataforma virou uma janela para o prontuario');

      const clinicaB = (lista.clinicas || []).filter((c) => c.id === 'cl_b')[0] || {};
      conferir('mas conta as pacientes da clinica B corretamente', Number(clinicaB.pacientes) > 0,
        'contou ' + clinicaB.pacientes + '. Zero aqui faria a conferencia de cima passar por ' +
        'a resposta estar vazia, e nao por estar certa');

      // ---- AS RECUSAS, uma por familia de dado
      const proibidas = [
        ['GET', '/api/clients',                     'a ficha das pacientes'],
        ['GET', '/api/clients/c_a_1/documents',     'os documentos de uma paciente'],
        ['GET', '/api/clients/c_a_1/alerts',        'os alertas clinicos de uma paciente'],
        ['GET', '/api/documents',                   'os documentos clinicos'],
        ['GET', '/api/appointments',                'a agenda'],
        ['GET', '/api/leads',                       'o funil'],
        ['GET', '/api/finance/entries',             'o financeiro'],
        ['GET', '/api/users',                       'os acessos de uma clinica'],
        ['GET', '/api/logs',                        'a trilha de auditoria de uma clinica'],
        ['GET', '/api/loyalty/clients',             'o programa de pontos'],
        ['GET', '/api/stock/movements',             'o estoque'],
        ['POST', '/api/leads/manual',               'criar lead dentro de uma clinica']
      ];
      for (const [metodo, rota, oQueE] of proibidas) {
        const r = await comoPlataforma(rota, {
          method: metodo,
          body: metodo === 'POST' ? JSON.stringify({ name: 'x', whatsapp: '1', treatment: 'x' }) : undefined
        });
        conferir('RECUSA ' + oQueE + '  (' + metodo + ' ' + rota + ')', r.status === 403,
          'respondeu ' + r.status + ' (esperado 403). Qualquer 200 aqui e a plataforma lendo ' +
          'dado de clinica; um 500 seria a rota tentando rodar e quebrando na camada, o que ' +
          'tambem nao serve -- a recusa tem de ser no porteiro, antes de tocar no banco');
      }

      // ---- e a porta contraria: clinica nao alcanca a plataforma
      const rInvasao = await fetch(base + '/api/plataforma/clinicas',
        { headers: { Authorization: 'Bearer ' + tokenA } });
      conferir('a administradora da clinica A NAO alcanca a plataforma', rInvasao.status === 403,
        'respondeu ' + rInvasao.status + '. Se passasse, quem administra uma clinica veria as ' +
        'contagens de todas as outras -- e poderia criar clinica');

      const rInvasao2 = await fetch(base + '/api/plataforma/clinicas', {
        method: 'POST', headers: { 'Content-Type': 'application/json',
                                   Authorization: 'Bearer ' + tokenA },
        body: JSON.stringify({ nome: 'Clinica Do Invasor', adminNome: 'x',
                               adminEmail: 'invasor@ensaio.invalido', adminSenha: 'senha-longa-10' })
      });
      conferir('e nao consegue cadastrar clinica', rInvasao2.status === 403,
        'respondeu ' + rInvasao2.status);

      // ---- sem token nenhum
      const rAnonimo = await fetch(base + '/api/plataforma/clinicas');
      conferir('e sem credencial a plataforma responde 401', rAnonimo.status === 401,
        'respondeu ' + rAnonimo.status);

      /* ---- A ROTA DO PRIMEIRO OPERADOR JA SE FECHOU
       *
       * Ela existe porque a tabela nasce vazia e alguem tem de criar o primeiro
       * de fora. O que a torna aceitavel e fechar sozinha: com um operador
       * cadastrado -- e a semente cadastrou -- ela recusa para sempre.
       *
       * Sem esta conferencia, um `if` invertido ali deixaria QUALQUER
       * administrador de clinica criar um operador da plataforma a qualquer
       * momento, e isso nao produziria erro nenhum em tela. */
      const rPrimeiro = await fetch(base + '/api/primeiro-operador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenA },
        body: JSON.stringify({ nome: 'Invasora', email: 'invasora@ensaio.invalido',
                               senha: 'senha-bem-longa-12' })
      });
      conferir('a rota do PRIMEIRO operador ja se fechou', rPrimeiro.status === 409,
        'respondeu ' + rPrimeiro.status + ' (esperado 409). Se aceitasse, qualquer admin de ' +
        'clinica criaria acesso de plataforma quando quisesse');

      const rPrimeiroPro = await fetch(base + '/api/primeiro-operador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenPro },
        body: JSON.stringify({ nome: 'Profissional', email: 'pro-quer@ensaio.invalido',
                               senha: 'senha-bem-longa-12' })
      });
      conferir('e ela nunca foi de quem nao e admin', rPrimeiroPro.status === 403,
        'respondeu ' + rPrimeiroPro.status + '. O 409 de cima sozinho nao prova papel nenhum: ' +
        'ele recusaria ate um anonimo');

      // ---- o operador CADASTRA, e a clinica nasce inteira
      const rNova = await comoPlataforma('/api/plataforma/clinicas', {
        method: 'POST',
        body: JSON.stringify({ nome: 'Clinica Da Plataforma', adminNome: 'Nova Admin',
                               adminEmail: 'nova-plat@ensaio.invalido',
                               adminSenha: 'senha-de-ensaio-longa' })
      });
      const nova = await rNova.json().catch(() => ({}));
      conferir('o operador cadastra clinica pela rota dele', rNova.status === 201,
        'respondeu ' + rNova.status + ': ' + (nova.error || ''));
      conferir('e ela nasce COMPLETA', !!(nova.conferencia && nova.conferencia.ok),
        nova.conferencia ? JSON.stringify(nova.conferencia.faltas) : 'sem conferencia na resposta');
      conferir('e a resposta NAO devolve a senha do primeiro acesso',
        JSON.stringify(nova).indexOf('senha-de-ensaio-longa') === -1,
        'a senha entrou por uma requisicao e tem de sair so como hash');
    }

    /* ================== [U] O ACESSO DE SUPORTE: CONCEDIDO, COM PRAZO, REVOGAVEL
     *
     * A unica coisa capaz de alargar a lista do bloco [T] -- e ela e do dono do
     * dado, nao da Mulino. Tres coisas precisam ser verdade, e a terceira e a que
     * costuma faltar em sistema de suporte:
     *
     *   1. sem concessao, o operador NAO entra;
     *   2. com concessao, ele entra e le -- mas NAO le prontuario, nem escreve;
     *   3. revogar tem efeito NA REQUISICAO SEGUINTE, e nao quando o token vencer.
     */
    console.log('\n[U] o acesso de suporte: a clinica concede, com prazo, e revoga na hora?');
    {
      const comoOperador = (rota, init) => fetch(base + rota, Object.assign({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenDaPlataforma }
      }, init || {}));

      // ---- 1. sem concessao, nao entra
      const rSem = await comoOperador('/api/plataforma/clinicas/cl_1/entrar', { method: 'POST' });
      conferir('sem autorizacao da clinica, o operador NAO entra', rSem.status === 403,
        'respondeu ' + rSem.status + '. Qualquer 200 aqui significa acesso permanente disfarcado ' +
        'de suporte');

      // ---- a clinica A libera
      const rLibera = await fetch(base + '/api/suporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenA },
        body: JSON.stringify({ horas: 4, motivo: 'ensaio' })
      });
      conferir('a administradora da clinica consegue liberar', rLibera.status === 201,
        'respondeu ' + rLibera.status);

      const rLiberaPro = await fetch(base + '/api/suporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenPro },
        body: JSON.stringify({ horas: 4 })
      });
      conferir('e quem nao e admin NAO consegue', rLiberaPro.status === 403,
        'respondeu ' + rLiberaPro.status + '. Abrir a porta da clinica e do dono dela');

      const rSemPrazo = await fetch(base + '/api/suporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenA },
        body: JSON.stringify({ horas: 0 })
      });
      conferir('concessao sem prazo e RECUSADA', rSemPrazo.status === 400,
        'respondeu ' + rSemPrazo.status + '. Acesso sem prazo nao e acesso concedido, e permanente');

      // ---- 2. agora entra
      const rEntra = await comoOperador('/api/plataforma/clinicas/cl_1/entrar', { method: 'POST' });
      const sessao = await rEntra.json().catch(() => ({}));
      conferir('com a autorizacao, o operador entra', rEntra.status === 200 && !!sessao.token,
        'respondeu ' + rEntra.status + ': ' + (sessao.error || ''));

      const comoSuporte = (rota, init) => fetch(base + rota, Object.assign({
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessao.token }
      }, init || {}));

      const rAgenda = await comoSuporte('/api/appointments');
      conferir('e LE o que precisa para investigar (a agenda)', rAgenda.status === 200,
        'respondeu ' + rAgenda.status + '. Sem isto, as recusas abaixo seriam de um token quebrado');

      const daAgenda = await rAgenda.json().catch(() => []);
      const cruAgenda = JSON.stringify(daAgenda);
      conferir('e o que ele le e da clinica CERTA', cruAgenda.indexOf(MARCA_B) === -1,
        'a sessao de suporte tem clinica no token, entao a camada filtra como sempre; um id com ' +
        MARCA_B + ' aqui seria a sessao de suporte enxergando a vizinha');

      // ---- prontuario: nao, nem com autorizacao
      for (const rota of ['/api/clients', '/api/clients/c_a_1/documents',
                          '/api/clients/c_a_1/alerts', '/api/documents']) {
        const r = await comoSuporte(rota);
        conferir('RECUSA prontuario mesmo autorizado  (' + rota + ')', r.status === 403,
          'respondeu ' + r.status + '. A clinica autorizou SUPORTE, nao autorizou a Mulino a ler ' +
          'o historico de saude das pacientes dela');
      }

      // ---- escrita: nenhuma
      const rEscreve = await comoSuporte('/api/leads/manual', {
        method: 'POST',
        body: JSON.stringify({ name: 'Do Suporte', whatsapp: '5511000000000', treatment: 'x' })
      });
      conferir('e NAO escreve nada', rEscreve.status === 403,
        'respondeu ' + rEscreve.status + '. Suporte investiga; mexer e da clinica');

      // ---- a entrada fica registrada na trilha DA CLINICA
      const trilha = await fetch(base + '/api/logs',
        { headers: { Authorization: 'Bearer ' + tokenA } }).then((r) => r.json());
      const lista = Array.isArray(trilha) ? trilha : (trilha.itens || trilha.logs || []);
      conferir('a entrada do suporte aparece na trilha da clinica',
        lista.some((l) => (l.description || '').indexOf('entrou para dar suporte') !== -1),
        lista.length + ' registro(s). Quem precisa saber que a Mulino entrou e o dono do dado');

      // ---- 3. revogar vale NA REQUISICAO SEGUINTE
      const rRevoga = await fetch(base + '/api/suporte', {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + tokenA } });
      conferir('a clinica revoga', rRevoga.status === 200, 'respondeu ' + rRevoga.status);

      const rDepois = await comoSuporte('/api/appointments');
      conferir('e o MESMO token de suporte para de valer na hora', rDepois.status === 403,
        'respondeu ' + rDepois.status + '. Se ainda respondesse 200, a concessao estaria sendo ' +
        'conferida so na emissao -- e "revogar" que so vale daqui a 30 minutos nao e revogar');

      const rEntraDeNovo = await comoOperador('/api/plataforma/clinicas/cl_1/entrar', { method: 'POST' });
      conferir('e nao da para entrar de novo', rEntraDeNovo.status === 403,
        'respondeu ' + rEntraDeNovo.status);
    }

    /* ================================================== [P] A TERCEIRA BARREIRA
     *
     * Os blocos [A]-[O] medem a 1a barreira (o filtro do SELECT) usando linhas
     * cruzadas que a semente só consegue criar com `foreign_key_checks = 0`.
     * Este bloco mede a 3a: com a conferência LIGADA, o banco recusa essas
     * mesmas linhas?
     *
     * Ele existe porque a semente desliga a conferência, e "desliguei para
     * semear" não pode virar "nunca mais conferi se a contenção existe". Sem
     * este bloco, apagar as oito chaves compostas por acidente não faria
     * nenhuma conferência ficar vermelha.
     *
     * ============================================== O CONTROLE, E POR QUE ELE
     *
     * Cada tentativa cruzada vem com uma **irmã bem formada**. Se eu errar o
     * nome de uma coluna, a cruzada falha por erro de sintaxe e a conferência
     * leria "recusou" -- que é a mesma armadilha de 09/09 em outra roupa:
     * conferência que passa sem exercitar nada. A irmã bem formada tem de
     * PASSAR; só aí "a cruzada foi recusada" significa alguma coisa.
     *
     * E o motivo da recusa é conferido pelo texto (`foreign key`): recusa por
     * chave duplicada ou por coluna obrigatória também daria erro, e também
     * pareceria contenção. */
    console.log('\n[P] a terceira barreira: o banco recusa a linha cruzada?');
    const bd = await mysql.createConnection({
      host: HOST, port: PORTA, user: USUARIO, password: SENHA, database: BANCO });
    try {
      // O controle vive aqui: paciente e produto novos da clinica B, bem
      // formados. Se estas duas gravacoes falharem, nada abaixo mede nada.
      let controleOk = true;
      try {
        await bd.query("INSERT INTO clients (id, name, phone, clinica_id)" +
          " VALUES ('c_b_ctrl','Controle B','5511900002222','cl_b')");
        await bd.query("INSERT INTO products (id, name, unit, unit_cost, min_stock, clinica_id)" +
          " VALUES ('pr_b_ctrl','Produto Controle','UN',10,1,'cl_b')");
      } catch (e) { controleOk = false; console.log('       ' + e.message); }
      conferir('controle: gravacao bem formada da clinica B passa', controleOk,
        controleOk ? 'e o que torna as recusas abaixo significativas'
                   : 'CONTROLE FALHOU -- nada abaixo mede contencao');

      /* As oito relacoes que a M1.8 converteu. Para cada uma, a mesma gravacao
       * duas vezes: apontando para o pai da clinica A (tem de ser RECUSADA) e
       * para o pai da propria clinica B (tem de PASSAR). */
      const RELACOES = [
        { nome: 'stock_batches.product_id -> products',
          sql: 'INSERT INTO stock_batches (id, product_id, batch_number, expiry_date,' +
               ' quantity, unit_cost, received_at, clinica_id) VALUES (?,?,?,?,1,1,?,?)',
          cruz: ['sb_p_cruz', 'pr_a_1', 'P-CRUZ', '2027-12-31', HOJE, 'cl_b'],
          bom:  ['sb_p_bom', 'pr_b_ctrl', 'P-BOM', '2027-12-31', HOJE, 'cl_b'] },
        { nome: 'stock_movements.product_id -> products',
          sql: 'INSERT INTO stock_movements (id, product_id, type, quantity, unit_cost,' +
               " reason, source, clinica_id) VALUES (?,?,'ENTRADA',1,1,'ensaio','MANUAL',?)",
          cruz: ['mv_p_cruz', 'pr_a_1', 'cl_b'],
          bom:  ['mv_p_bom', 'pr_b_ctrl', 'cl_b'] },
        { nome: 'service_supplies.product_id -> products',
          sql: 'INSERT INTO service_supplies (id, catalog_id, product_id, quantity, clinica_id)' +
               ' VALUES (?,?,?,1,?)',
          // `catalog_id` e o da PROPRIA clinica B: assim a unica coisa cruzada
          // e o produto, e a recusa nao pode vir de outra chave.
          cruz: ['ss_p_cruz', 'tc' + MARCA_B + '1', 'pr_a_1', 'cl_b'],
          bom:  ['ss_p_bom', 'tc' + MARCA_B + '1', 'pr_b_ctrl', 'cl_b'] },
        { nome: 'loyalty_transactions.client_id -> clients',
          sql: 'INSERT INTO loyalty_transactions (id, client_id, type, points, description,' +
               " source, source_id, clinica_id) VALUES (?,?,'ACUMULO',1,'ensaio','MANUAL',?,?)",
          cruz: ['lt_p_cruz', 'c_a_1', 'p-cruz', 'cl_b'],
          bom:  ['lt_p_bom', 'c_b_ctrl', 'p-bom', 'cl_b'] },
        { nome: 'client_documents.client_id -> clients',
          sql: 'INSERT INTO client_documents (id, client_id, type, title, answers_json,' +
               " status, clinica_id) VALUES (?,?,'ANAMNESE','Ensaio','{}','RASCUNHO',?)",
          cruz: ['dc_p_cruz', 'c_a_1', 'cl_b'],
          bom:  ['dc_p_bom', 'c_b_ctrl', 'cl_b'] },
        { nome: 'treatments.client_id -> clients',
          sql: 'INSERT INTO treatments (id, client_id, procedure_name, session_date, price,' +
               ' clinica_id) VALUES (?,?,?,?,1,?)',
          cruz: ['tr_p_cruz', 'c_a_1', 'Ensaio', HOJE, 'cl_b'],
          bom:  ['tr_p_bom', 'c_b_ctrl', 'Ensaio', HOJE, 'cl_b'] },
        { nome: 'treatment_plans.client_id -> clients',
          sql: 'INSERT INTO treatment_plans (id, client_id, title, total_sessions, clinica_id)' +
               ' VALUES (?,?,?,1,?)',
          cruz: ['pl_p_cruz', 'c_a_1', 'Ensaio', 'cl_b'],
          bom:  ['pl_p_bom', 'c_b_ctrl', 'Ensaio', 'cl_b'] },
        { nome: 'treatment_sessions.plan_id -> treatment_plans',
          sql: 'INSERT INTO treatment_sessions (id, plan_id, session_number, session_type,' +
               ' clinica_id) VALUES (?,?,99,?,?)',
          cruz: ['ts_p_cruz', 'pl_a_1', 'SESSAO_TRATAMENTO', 'cl_b'],
          // A irma bem formada aponta para o plano de CONTROLE (`pl_p_bom`,
          // criado na linha de cima desta lista), e nao para `pl_b_1`. Assim,
          // quando o controle for apagado no fim do bloco, a cascata percorre
          // paciente -> plano -> sessao, e a conferencia do CASCADE cobre
          // tambem esta relacao.
          bom:  ['ts_p_bom', 'pl_p_bom', 'SESSAO_TRATAMENTO', 'cl_b'] }
      ];

      for (const rel of RELACOES) {
        let erro = null;
        try { await bd.query(rel.sql, rel.cruz); } catch (e) { erro = e.message; }
        conferir('RECUSA a cruzada em ' + rel.nome, !!erro && /foreign key/i.test(erro),
          erro ? (/foreign key/i.test(erro) ? 'recusada pela chave estrangeira'
                                            : 'recusada, mas por OUTRO motivo: ' + erro)
               : 'ACEITOU a linha cruzada! A terceira barreira nao esta no lugar aqui');
        let bom = null;
        try { await bd.query(rel.sql, rel.bom); } catch (e) { bom = e.message; }
        conferir('   e ACEITA a irma bem formada', !bom,
          bom ? 'CONTROLE FALHOU: ' + bom + ' -- a recusa acima nao prova nada'
              : 'a gravacao legitima passa, entao a recusa acima e do filtro e nao do SQL');
      }

      // Metade A: carimbar com clinica que nao existe.
      let erroFantasma = null;
      try {
        await bd.query("INSERT INTO clients (id, name, phone, clinica_id)" +
          " VALUES ('c_fantasma','Fantasma','5511900003333','cl_nao_existe')");
      } catch (e) { erroFantasma = e.message; }
      conferir('RECUSA carimbo com clinica que nao existe',
        !!erroFantasma && /foreign key/i.test(erroFantasma),
        erroFantasma ? 'recusado' : 'ACEITOU! A linha nasceria invisivel para todas as clinicas');

      // E apagar clinica com dado: RESTRICT de proposito.
      let erroApagar = null;
      try { await bd.query("DELETE FROM clinicas WHERE id = 'cl_b'"); }
      catch (e) { erroApagar = e.message; }
      conferir('RECUSA apagar clinica que ainda tem dado',
        !!erroApagar && /foreign key/i.test(erroApagar),
        erroApagar ? 'recusado -- encerrar clinica e operacao com nome, nao um DELETE'
                   : 'APAGOU! Um DELETE errado levaria o prontuario de um consultorio inteiro');

      /* E a honestidade sobre o alcance disto: a contencao cobre as OITO
       * relacoes que já tinham chave estrangeira. As outras 22 (a lista está em
       * `PONTEIROS`, na migration 027) seguem contidas só pelo código -- e a
       * mais visível delas é `interactions.client_id`, que é justamente a linha
       * cruzada `in_b_cruz` da semente. Ela entra sem o banco reclamar, com ou
       * sem `foreign_key_checks`. */
      let entrou = true;
      try {
        await bd.query('INSERT INTO interactions (id, client_id, type, content, direction,' +
          " clinica_id) VALUES ('in_p_sem_fk','c_a_1','WHATSAPP','ensaio','OUT','cl_b')");
      } catch (e) { entrou = false; }
      conferir('e o banco AINDA aceita cruzada onde nao ha chave estrangeira ' +
        '(interactions.client_id)', entrou,
        entrou ? 'esperado: 22 relacoes seguem so com o filtro do codigo -- e por isso os ' +
                 'blocos [A]-[O] continuam sendo a barreira que importa'
               : 'ganhou chave estrangeira? Atualize PONTEIROS e este texto');

      /* ============================ E O `ON DELETE CASCADE` SOBREVIVEU?
       *
       * A M1.8 mudou o ALCANCE das oito chaves (de uma coluna para duas). Não
       * era para mudar o que acontece num DELETE -- e é fácil mudar sem querer,
       * porque a regra é reescrita na criação da chave nova.
       *
       * Isto está aqui por sabotagem: trocando `regra(f.del)` por `RESTRICT`
       * na migration, o ensaio inteiro passou verde -- 156 conferências, zero
       * falhas. O que teria chegado na tela é "erro ao excluir paciente", com
       * as fichas dela impedindo a exclusão em vez de irem com ela.
       *
       * A limpeza do controle virou a medição: apagar o paciente e o produto de
       * controle é o que este bloco tinha de fazer de qualquer jeito, e a
       * cascata é conferida de graça. **Antes** de apagar, conta-se quantas
       * filhas existem -- senão zero-antes e zero-depois passaria sem medir
       * nada, que é o defeito de 09/09 outra vez. */
      const CONTA_FILHAS =
        "SELECT (SELECT COUNT(*) FROM client_documents WHERE client_id='c_b_ctrl')" +
        " + (SELECT COUNT(*) FROM loyalty_transactions WHERE client_id='c_b_ctrl')" +
        " + (SELECT COUNT(*) FROM treatments WHERE client_id='c_b_ctrl')" +
        " + (SELECT COUNT(*) FROM treatment_plans WHERE client_id='c_b_ctrl')" +
        " + (SELECT COUNT(*) FROM treatment_sessions WHERE plan_id='pl_p_bom')" +
        " + (SELECT COUNT(*) FROM stock_batches WHERE product_id='pr_b_ctrl')" +
        " + (SELECT COUNT(*) FROM stock_movements WHERE product_id='pr_b_ctrl')" +
        " + (SELECT COUNT(*) FROM service_supplies WHERE product_id='pr_b_ctrl') AS n";
      const [fAntes] = await bd.query(CONTA_FILHAS);
      conferir('as 8 filhas bem formadas existem antes de apagar o controle',
        Number(fAntes[0].n) === 8,
        'filhas: ' + fAntes[0].n + ' (esperado 8). Zero aqui faria a conferencia de baixo ' +
        'passar sem medir cascata nenhuma');

      await bd.query("DELETE FROM interactions WHERE id = 'in_p_sem_fk'");
      // Sem CASCADE, estes dois DELETEs sao RECUSADOS -- e um erro nao tratado
      // aqui derrubaria o ensaio com "erro no ensaio", que e a mensagem que nao
      // diz nada. Melhor deixar a conferencia de baixo dar o diagnostico.
      let recusouApagar = null;
      try {
        await bd.query("DELETE FROM clients WHERE id = 'c_b_ctrl'");
        await bd.query("DELETE FROM products WHERE id = 'pr_b_ctrl'");
      } catch (e) { recusouApagar = e.message; }

      const [fDepois] = await bd.query(CONTA_FILHAS);
      if (recusouApagar) console.log('       o DELETE do controle foi recusado: ' + recusouApagar);
      conferir('ON DELETE CASCADE sobreviveu a conversao para chave composta',
        Number(fDepois[0].n) === 0,
        Number(fDepois[0].n) === 0
          ? 'as 8 filhas foram com o pai, nas 8 relacoes convertidas'
          : 'sobraram ' + fDepois[0].n + ' filha(s)! A chave nova nao apaga como a antiga ' +
            'apagava, e isso vira "erro ao excluir paciente" na tela');
    } finally { await bd.end(); }

  } finally {
    if (servidor) await new Promise((ok) => servidor.close(ok));
    try {
      const { pool } = require('./server/db.js');
      await pool.end();
    } catch (e) { /* nunca abriu */ }
    const limpar = await mysql.createConnection({
      host: HOST, port: PORTA, user: USUARIO, password: SENHA });
    await limpar.query('DROP DATABASE IF EXISTS ' + BANCO);
    await limpar.end();
  }

  console.log('\n' + conferidas + ' conferencia(s), ' + falhas + ' falha(s), ' +
    pendentes + ' modulo(s) ainda na catraca');

  if (falhas) {
    console.log('\n>>> VAZOU em modulo JA CONVERTIDO. Isto e regressao.');
    process.exit(1);
  }
  if (pendentes) {
    console.log('\n>>> Os modulos convertidos nao vazam. Faltam ' + pendentes +
      ' modulo(s) -- e esperado, e a M1 nao terminou.');
    process.exit(0);
  }
  console.log('\n>>> NADA VAZOU, e nao ha modulo pendente <<<');
}

// A conferencia da lista roda ANTES de subir banco e aplicacao: erro de
// digitacao em `arquivo` nao merece 20 migrations de espera para aparecer.
conferirListaDeRotas();
principal().catch((e) => { console.error('\nerro no ensaio:', e); process.exit(2); });
