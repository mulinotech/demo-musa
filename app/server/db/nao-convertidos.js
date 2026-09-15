'use strict';
/** A catraca da fase M1: quem ainda pode falar com o banco direto.
 *
 *  ======================================================= COMO ELA FUNCIONA
 *
 *  Todo arquivo de `server/routes/`, `server/services/`, `server/workers/` e
 *  `server/middleware/` que use `.query(` ou `.getConnection(` precisa estar
 *  nesta lista. O teste `tests/camada.test.js` falha de duas formas, e as duas
 *  importam:
 *
 *  1. Arquivo que usa o banco direto e NÃO está na lista → **falha**. É o que
 *     impede um módulo já convertido de voltar atrás, e o que impede rota nova
 *     de nascer sem filtro.
 *
 *  2. Arquivo que está na lista e NÃO usa mais o banco direto → **falha**. É o
 *     que obriga a lista a encolher: terminou de converter um módulo, tire-o
 *     daqui. Sem isso a lista vira decoração e ninguém percebe que ela parou de
 *     proteger.
 *
 *  A catraca só gira num sentido. Um arquivo que sai daqui não volta.
 *
 *  ================== A VARREDURA FOI ALARGADA TRES VEZES, E ACHOU TRES VEZES
 *
 *  Vale a sequência inteira, porque ela é o argumento mais forte deste projeto
 *  a favor de conferir a varredura contra o disco:
 *
 *  | Alargamento | O que apareceu |
 *  |---|---|
 *  | olhar `services/` e `workers/`, não só `routes/` | os 4 arquivos que gravam dinheiro, estoque e pontos |
 *  | procurar `.query(` em vez de `pool.query(` | `routes/migrate.js` |
 *  | procurar também quem **importa** `../db` | `routes/expiracao-pontos.js` e `middleware/autenticacao.js` |
 *
 *  O terceiro é o mais interessante: `expiracao-pontos.js` **nunca chama**
 *  `.query`. Ele importa o pool e o passa ao worker. Pela busca anterior
 *  parecia convertido — e a catraca acusou o contrário, porque ele estava na
 *  lista de propósito. Foi a lista que corrigiu a varredura, e não o inverso.
 *
 *  =========================== POR QUE A LISTA FOI DE 19 A 25, E DAI A 20
 *
 *  Ela não cresceu porque alguém escreveu consulta crua nova. Cresceu porque a
 *  varredura estava **curta em dois sentidos**, e as duas faltas foram medidas
 *  em 08/09:
 *
 *  - Ela olhava só `server/routes/`. Mas é em `server/services/` e
 *    `server/workers/` que nascem os lançamentos de caixa, as baixas de estoque
 *    e os pontos de fidelidade — as gravações que mais doem se forem para a
 *    clínica errada. Cinco arquivos, e nenhum deles aparecia.
 *  - O padrão procurado era `pool.query(` ou `conn.query(`. `routes/migrate.js`
 *    usa outro nome de variável e passava batido; os serviços usam `conexao`.
 *    Agora o padrão é `.query(` e `.getConnection(`, que é o que a camada
 *    substitui de fato (a camada chama `.q(`).
 *
 *  Registrado aqui porque é a quinta vez neste projeto que uma conferência
 *  passava sem exercitar o que dizia exercitar. O aprendizado: **lista de
 *  exceções só vale acompanhada da varredura que a preenche** — e a varredura
 *  tem de ser conferida contra o mundo, não contra a expectativa de quem a
 *  escreveu.
 *
 *  Consequência prática para o plano: a M1 é maior do que 220 consultas em 19
 *  rotas. A cadeia de efeitos do atendimento (concluir → receita → estoque →
 *  pontos) é um front próprio, e virou a tarefa M1.1c.
 *
 *  ========================================================= POR QUE EXISTE
 *
 *  A camada (`escopo.js`) só protege quem a usa. Enquanto a M1 não converter
 *  tudo, consulta crua continua existindo em toda parte — e sem esta lista não
 *  haveria nada distinguindo "ainda não convertido" de "convertido e alguém
 *  furou".
 *
 *  ============================================================== O NÚMERO
 *
 *  4 arquivos em 10/09, depois da M2.3. E o piso: os quatro sao PERMANENTES. O objetivo da M1 é esta lista ficar
 *  vazia. Quando ficar, apague o arquivo e os testes que o leem.
 *
 *  Já saíram: `routes/clients.js` (M1.1a); `routes/treatments.js` e
 *  `routes/treatment-plans.js` (M1.1b); `routes/appointments.js` e a cadeia de
 *  efeitos inteira — `services/atendimento-concluido.js`,
 *  `services/efeitos-financeiro.js`, `services/efeitos-estoque.js` e
 *  `services/efeitos-fidelidade.js` (M1.1c); `routes/finance.js`,
 *  `routes/pricing.js` e `routes/reports.js` (M1.2); `routes/stock.js` (M1.3);
 *  `routes/loyalty.js` (M1.4); `routes/documents.js` (M1.5); e na M1.6a
 *  `routes/catalog.js`, `routes/interactions.js`, `routes/leads.js`,
 *  `routes/logs.js`, `routes/salespeople.js` e `services/logs.js` -- este
 *  último não por ter sido escopado, mas porque a trilha de auditoria passou a
 *  ter DOIS caminhos declarados (`registrar`, escopado, e `daInstalacao`,
 *  autorizado a atravessar) em vez de um só que gravava sem clínica; e na M1.6b
 *  `routes/users.js`, `routes/evolution.js` e `routes/gemini.js`.
 *
 *  Dois arquivos ENTRARAM na lista sem nunca ter estado nela, e pelo mesmo
 *  motivo: `routes/lembretes.js` (M1.1c), `routes/expiracao-pontos.js`
 *  (M1.4) e -- fora desta lista, porque nem chegam a usar o pool -- a captação
 *  pública de lead (M1.6a) e o webhook do WhatsApp (M2.1a). E na M2.1b
 *  `routes/lembretes.js` e `workers/lembretes.js`: a configuração virou
 *  `clinica_settings`, e o worker passou a percorrer as clínicas montando o
 *  escopo de cada uma -- então "não tenho sessão" deixou de significar "não uso
 *  a camada".
 *
 *  O webhook é o caso mais interessante: ele saiu da lista sem que nenhuma
 *  consulta dele mudasse de forma. O que mudou foi haver **de onde tirar a
 *  clínica** — a instância que recebeu a mensagem. A informação sempre esteve
 *  no envelope; faltava alguém ligar o envelope à clínica. Os dois foram recortados de um módulo maior justamente para que as
 *  rotas que **não podem** usar a camada — o cron chama sem sessão — não
 *  prendessem o módulo inteiro aqui. Não é a catraca andando para trás: é a
 *  exceção ficando do tamanho dela, em vez do tamanho do arquivo em que
 *  morava.
 */

module.exports = [
  /* ---------------------------------------------------------------- rotas */

  /* ============================== AS VARREDURAS DO CRON SAIRAM DAQUI (M2.3)
   *
   * Elas percorrem todas as clínicas por definição -- uma passada manda lembrete
   * de todas e expira ponto de todas --, e por isso pareciam exceção permanente.
   * Não eram.
   *
   * A saída não foi `escopo(req)`, que exigiria uma sessão que não existe: foi
   * `escopo.paraClinica(clinica)`, com o laço em `escopo.todasAsClinicas(motivo)`
   * e o trabalho de cada clínica no escopo dela. **"Não tenho sessão" deixou de
   * significar "não uso a camada"** — e essa distinção é o que fez esta lista
   * cair de 6 para 4.
   *
   * Vale como padrão para o que vier: varredura tem duas camadas. O laço
   * atravessa, com motivo escrito; o trabalho, não. */

  /* ----------------------------------------------------------- os restantes */
  'routes/migrate.js',           // roda as migrations: é DDL da instalação
                                 // inteira, não dado de clínica. Fica.
  'routes/auth.js',              // o login acontece ANTES de existir sessão: é
                                 // ele que descobre a clínica. Não pode usar
                                 // escopo(req).
  'middleware/cron.js',          // lê o token do cron em `system_settings`, que
                                 // é da instalação. Fica.
  'middleware/autenticacao.js'   // o porteiro. Ele importa o pool para entregá-lo
                                 // a `cron.identidadeDeCron`, que precisa ler o
                                 // token ANTES de existir sessão -- é o passo que
                                 // decide se a requisição é a rotina automática.
                                 // Não pode usar escopo(req): é ele quem descobre
                                 // a clínica da sessão. Fica.
                                 //
                                 // Só apareceu na lista em 09/09, quando a
                                 // varredura passou a enxergar quem IMPORTA o
                                 // pool e não só quem chama `.query`. Ele nunca
                                 // chamou -- só entregava.
];
