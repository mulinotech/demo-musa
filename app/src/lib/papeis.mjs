/** Os papéis do sistema, do lado da tela.
 *
 *  ========================================================= O QUE ISTO NÃO É
 *
 *  Não é permissão. Quem recusa de verdade é `REGRAS_DE_PAPEL` e
 *  `ALCANCE_DO_PAPEL` em `server/middleware/autorizacao.js` — este arquivo só
 *  evita mostrar botão que o servidor vai recusar, e escrever o nome do papel
 *  por extenso na barra lateral.
 *
 *  A distinção não é acadêmica: antes desta tarefa havia quinze lugares na tela
 *  escrevendo `['admin','gerente'].includes(papelDoToken())` à mão. Acrescentar
 *  um papel significava caçar os quinze, e o que sobra de um esquecido não é um
 *  erro — é uma tela em branco para alguém que deveria vê-la, sem nenhuma
 *  mensagem dizendo por quê.
 *
 *  É `.mjs` pela mesma razão que `origens.mjs` e `telefone.mjs`: a suíte do
 *  servidor (CommonJS) consegue `import()` deste arquivo e conferir que a lista
 *  daqui bate com a do servidor. Duas listas que discordam fazem a tela
 *  oferecer um papel que o PATCH recusa.
 */

/** Todo papel que existe, na ordem em que a tela mostra: do mais amplo ao mais
 *  estreito. `ajuda` é o que a pessoa lê antes de escolher — e é o único lugar
 *  do sistema onde "o que este papel alcança" está escrito em português. */
export const PAPEIS = [
  { valor: 'admin', rotulo: 'Administrador',
    ajuda: 'Acesso total, inclusive usuários e logs.' },

  { valor: 'gerente_admin', rotulo: 'Gerente Administrativo',
    ajuda: 'Tudo menos a gestão de usuários: financeiro, preço, estoque, agenda e funil.' },

  { valor: 'gerente_comercial', rotulo: 'Gerente Comercial',
    ajuda: 'Funil, agenda, pacientes e relatórios. Não abre financeiro, preço nem custo.' },

  /* O PAPEL ANTIGO CONTINUA NA LISTA, e marcado.
   *
   * A migration 043 não converteu ninguém: ela não tem como saber qual gerente
   * é o comercial e qual é o administrativo. Enquanto a clínica não decidir uma
   * a uma, essas pessoas continuam com o papel que sempre tiveram — e a tela
   * precisa conseguir MOSTRAR esse papel sem parecer defeito. */
  { valor: 'gerente', rotulo: 'Gerente (modelo antigo)', legado: true,
    ajuda: 'Mesmo alcance do Gerente Administrativo. Escolha um dos dois acima para novos acessos.' },

  { valor: 'profissional', rotulo: 'Profissional',
    ajuda: 'Operação clínica: agenda, prontuário, documentos e estoque.' },

  { valor: 'secretaria', rotulo: 'Secretária(o)',
    ajuda: 'Recepção: agenda, pacientes, funil e WhatsApp. Sem prontuário e sem dinheiro.' },

  { valor: 'financeiro', rotulo: 'Financeiro',
    ajuda: 'Caixa, contas, custos, preço e relatórios. Sem prontuário e sem agenda.' },

  { valor: 'contador', rotulo: 'Contador',
    ajuda: 'Só leitura do financeiro e dos relatórios. Nenhum dado de paciente.' },

  { valor: 'vendedor', rotulo: 'Vendedor',
    ajuda: 'Só funil, pacientes e atendimento.' }
];

export const VALORES = PAPEIS.map((p) => p.valor);

/** Nome por extenso. Papel desconhecido volta como está: inventar um rótulo
 *  bonito esconderia o fato de que alguém gravou um valor que a tela não
 *  conhece. */
export function rotuloDoPapel(papel) {
  const p = PAPEIS.find((x) => x.valor === papel);
  return p ? p.rotulo : String(papel || '—');
}

/** Rótulo curto da barra lateral — cabe em uma linha estreita. */
export const ROTULO_CURTO = {
  admin: 'Administração',
  gerente: 'Gerência',
  gerente_admin: 'Gerência Adm.',
  gerente_comercial: 'Gerência Com.',
  profissional: 'Profissional',
  secretaria: 'Recepção',
  financeiro: 'Financeiro',
  contador: 'Contabilidade',
  vendedor: 'Comercial'
};

/* ============================================================== OS TRÊS GRUPOS
 *
 * São três, e não um, porque o sistema já distinguia três coisas diferentes que
 * a expressão `['admin','gerente']` misturava:
 *
 *   - CONFIGURAR a clínica (timbre, WhatsApp, captação, equipe, logs);
 *   - VER DINHEIRO (faturamento, ticket, CPL, custo);
 *   - DESFAZER dinheiro (estornar um atendimento concluído).
 *
 * O Gerente Comercial configura e não vê custo. O Financeiro vê dinheiro e não
 * configura. Com uma lista só, um dos dois teria de ganhar o que não é dele. */

/** Quem mexe na configuração da clínica. */
export const GESTAO = ['admin', 'gerente', 'gerente_admin', 'gerente_comercial'];

/** Quem enxerga faturamento, custo e margem. */
export const DINHEIRO = ['admin', 'gerente', 'gerente_admin', 'financeiro', 'contador'];

/** Quem pode DESFAZER um lançamento — estorno mexe em receita, baixa de insumo
 *  e ponto de fidelidade de uma vez. O contador é leitura; o financeiro lança,
 *  mas não alcança `/api/appointments` além do GET. Sobra a gerência plena. */
export const ESTORNO = ['admin', 'gerente', 'gerente_admin'];

export const ehGestao = (papel) => GESTAO.includes(papel);
export const veDinheiro = (papel) => DINHEIRO.includes(papel);
export const podeEstornar = (papel) => ESTORNO.includes(papel);

/** A tela em que cada papel CAI ao entrar.
 *
 *  Até a M6.7 todo mundo caía na Visão Geral, e para quem não alcança
 *  `/api/dashboard` isso era uma tela com a frase "Não foi possível carregar os
 *  números do período" — que é a descrição de um defeito, não de uma permissão.
 *  O vendedor convivia com isso desde sempre; a secretária e o contador
 *  entrariam no mesmo buraco no primeiro login.
 *
 *  Cair numa tela que funciona é melhor do que explicar um erro que não é erro.
 */
export function telaInicial(papel) {
  if (papel === 'secretaria') return '/crm/agenda';
  if (papel === 'vendedor') return '/crm/funil';
  return '/crm';
}

/** Quem enxerga a Visão Geral. Fora daqui, `telaInicial` desvia. */
export const VE_VISAO_GERAL = Array.from(new Set(
  GESTAO.concat(DINHEIRO, ['profissional'])));
