/**
 * Trocar texto livre por lista, sem apagar o que já foi escrito (M5.11, 21/09).
 *
 * ===================================================== POR QUE ISTO EXISTE
 *
 * Item 5 do PDF de 19/09: profissional, equipamento e insumo eram três caixas
 * de texto na janela de lançar a sessão. Viram listas de escolha.
 *
 * Só que a troca tem um risco que não é óbvio, e é ele que este arquivo trata:
 *
 *     A sessão de março foi lançada com "ultra former" digitado à mão. O
 *     cadastro novo tem "Ultraformer MPT". Se a janela abrir mostrando a lista
 *     e nada selecionado, a recepção clica em Salvar por qualquer outro motivo
 *     — mudar a data, corrigir a evolução — e **o equipamento da sessão de
 *     março some**. Sem aviso, sem erro, sem ninguém pedindo.
 *
 * Apagar prontuário como efeito colateral de uma melhoria de tela é pior do que
 * a tela ruim que havia antes. Então a regra deste arquivo é uma só:
 *
 *     **O que já está gravado sempre aparece na lista, selecionado.**
 *
 * Ele entra como uma opção a mais, marcada como digitada antes, e sai de lá se
 * — e só se — alguém trocar por uma do cadastro. A conversão fica sendo uma
 * decisão de quem conhece o caso, e não um palpite do sistema. É a mesma
 * escolha da M5.10 com a mãe e a filha.
 *
 * Este arquivo é `.mjs` pelo motivo de sempre neste projeto: assim a suíte do
 * servidor o carrega com um `import()` e testa a regra de verdade.
 */

/** O texto de um campo de vários itens vira lista.
 *
 *  Aceita o que já está gravado hoje: "Ácido Hialurônico, Bioestimulador Y",
 *  com espaços a mais, vírgulas sobrando e itens repetidos.
 *
 *  A repetição some ignorando maiúsculas, e a PRIMEIRA grafia é a que fica —
 *  escolher a última faria a lista mudar sozinha ao reabrir a janela. */
export function separarItens(texto) {
  const cru = String(texto || '').split(',');
  const vistos = new Set();
  const fora = [];
  for (const p of cru) {
    const item = p.trim();
    if (!item) continue;
    const chave = item.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    fora.push(item);
  }
  return fora;
}

/** A lista volta a ser o texto que a coluna guarda. */
export function juntarItens(lista) {
  return (Array.isArray(lista) ? lista : []).map((i) => String(i || '').trim())
    .filter(Boolean).join(', ');
}

/** Duas grafias do mesmo nome? Compara sem maiúsculas e sem espaço sobrando.
 *
 *  Deliberadamente NÃO tenta ser esperta: "ultra former" e "Ultraformer" não
 *  casam aqui. Casar por aproximação juntaria coisas que a clínica sabe serem
 *  diferentes — e ninguém revisaria, porque a tela ficaria coerente. */
export function mesmoNome(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** As opções de um campo de UM valor (profissional, equipamento).
 *
 *  @param {string} gravado      o que está na sessão hoje; pode ser texto livre
 *  @param {string[]} cadastrados  os nomes do cadastro, já filtrados por ativos
 *  @returns {{valor: string, rotulo: string, legado: boolean}[]}
 *
 *  O cadastro vem primeiro, na ordem em que chegou. O valor gravado que não
 *  estiver nele entra no fim, marcado — e é isso que impede o apagamento
 *  silencioso descrito no cabeçalho.
 */
export function opcoesDeEscolha(gravado, cadastrados) {
  const lista = (Array.isArray(cadastrados) ? cadastrados : [])
    .map((c) => String(c || '').trim()).filter(Boolean);

  const opcoes = lista.map((c) => ({ valor: c, rotulo: c, legado: false }));

  const atual = String(gravado || '').trim();
  if (atual && !lista.some((c) => mesmoNome(c, atual))) {
    opcoes.push({ valor: atual, rotulo: atual + ' — digitado antes', legado: true });
  }
  return opcoes;
}

/** As opções de um campo de VÁRIOS valores (insumos).
 *
 *  Mesma regra, item a item: tudo o que está gravado continua na lista e
 *  continua marcado, mesmo o que não existe no cadastro.
 *
 *  @returns {{opcoes: {valor, rotulo, legado}[], marcados: string[]}}
 */
export function opcoesDeMarcar(gravado, cadastrados) {
  const lista = (Array.isArray(cadastrados) ? cadastrados : [])
    .map((c) => String(c || '').trim()).filter(Boolean);
  const atuais = separarItens(gravado);

  const opcoes = lista.map((c) => ({ valor: c, rotulo: c, legado: false }));
  for (const a of atuais) {
    if (!lista.some((c) => mesmoNome(c, a))) {
      opcoes.push({ valor: a, rotulo: a + ' — digitado antes', legado: true });
    }
  }

  /* Os marcados saem NA ORDEM EM QUE ESTAVAM GRAVADOS, e não na ordem em que
     aparecem na lista da tela.

     Isto não é detalhe: a primeira versão ordenava pela lista, e aí uma sessão
     gravada como "Ácido, Bioestimulador" voltava como "Bioestimulador, Ácido"
     só por alguém ter aberto a janela e salvado. Ordem de insumo pode ser ordem
     de aplicação, e reescrever prontuário sem ninguém pedir é o que este
     arquivo inteiro existe para não fazer. Quem pegou foi a conferência de
     invariante, antes de o código sair daqui. */
  const marcados = atuais
    .map((a) => {
      const op = opcoes.find((o) => mesmoNome(o.valor, a));
      return op ? op.valor : a;
    });

  return { opcoes, marcados };
}
