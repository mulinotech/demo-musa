'use strict';
/** Venda Fechada vira paciente — sem duplicar (M5.10, 21/09)
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  A coluna "Venda Fechada" do funil sempre escreveu, embaixo do título,
 *  **"Convertido em cliente"**. E o card do lead fechado exibia
 *  **"PACIENTE PREMIUM"**. Nenhuma das duas frases era verdade no servidor: o
 *  `PUT /api/leads/:id` gravava `status = 'arquivado'` e mais nada.
 *
 *  A conversão existia, sim — mas **dentro do navegador**, em `CrmDashboard`:
 *
 *      const clientExists = clients.some(c => c.phone === finalPhone);
 *      if (leadToConvert && !clientExists) { await handleAddClient({...}); }
 *
 *  Três defeitos moram nessas duas linhas, e o time comercial acertou em cheio
 *  ao escrever *"assim não temos duplicidade nos cadastros do banco"*:
 *
 *  1. **`c.phone === finalPhone` é comparação de texto cru.** O lead chega do
 *     WhatsApp como `5511911112222`; a ficha foi digitada pela recepção como
 *     `(11) 91111-2222`. São a mesma mulher e dois textos diferentes — então
 *     `clientExists` dá `false` e nasce a **segunda ficha**. A duplicata que o
 *     time viu não é descuido de quem digita: é a regra de comparação.
 *
 *  2. **A regra roda na aba de quem clicou.** Se a aba fecha entre o `PUT` e o
 *     `handleAddClient`, o lead fica fechado e a ficha nunca nasce — sem erro,
 *     sem log, sem sintoma. E `clients` é o que aquela aba tinha em memória:
 *     lista velha compara com o mundo velho.
 *
 *  3. **Nada registrava que aquela ficha veio daquele lead.** Depois de criada,
 *     a paciente não tinha origem, e o lead não tinha para onde apontar. Pelo
 *     banco, ninguém conseguia responder "de onde veio esta paciente?".
 *
 *  Este arquivo é a regra que decide, e ele é **puro**: não fala com o banco.
 *  Recebe o lead e as fichas da clínica, devolve o que fazer. Isso permite
 *  testar os casos que ninguém reproduz à mão — a mãe e a filha com o mesmo
 *  telefone, o número sem o nono dígito, o celular com DDI colado.
 *
 *  ============================== A DECISÃO QUE ATRAVESSA O ARQUIVO INTEIRO
 *
 *  Entre **criar uma ficha a mais** e **vincular à paciente errada**, este
 *  código sempre escolhe criar a ficha a mais.
 *
 *  Não é simetria: ficha duplicada é trabalho de limpeza. Vínculo errado põe o
 *  histórico clínico, os documentos e as sessões de uma mulher debaixo do nome
 *  de outra — e ninguém percebe, porque a tela fica coerente. Por isso telefone
 *  curto demais para ser telefone **nunca casa com ninguém**, e dois candidatos
 *  empatados **não são desempatados por chute**.
 */

/** Só os dígitos. `null`, `undefined` e máscara viram string vazia. */
function somenteDigitos(t) {
  return String(t || '').replace(/\D+/g, '');
}

/** A chave pela qual dois telefones são o MESMO telefone.
 *
 *  O mesmo número aparece no sistema de pelo menos cinco formas: como o
 *  WhatsApp manda (`5511911112222`), como a recepção digita
 *  (`(11) 91111-2222`), como veio do formulário do site (`+55 11 91111 2222`),
 *  como está numa ficha antiga de antes do nono dígito (`11 1111-2222`) e como
 *  alguém colou de uma planilha (`11911112222`).
 *
 *  Duas normalizações resolvem as cinco:
 *
 *  a) **Fora o DDI 55**, quando sobra número de gente (11 ou 12 dígitos com o
 *     55 na frente). `55` também é começo de DDD válido? Não: DDD vai de 11 a
 *     99, e `55` é Santa Maria/RS. Daí a conferência ser pelo TAMANHO, e não
 *     pelo prefixo: `5511911112222` tem 13 dígitos e só faz sentido com DDI;
 *     `5591111222` tem 10 e é o DDD 55 com número de oito.
 *
 *  b) **Fora o nono dígito**, quando o número tem 9, começa com 9, e o que
 *     sobra ainda começa com 6, 7, 8 ou 9.
 *
 *     Essa segunda conferência não é preciosismo. Celular brasileiro ganhou um
 *     9 **na frente** de um número de oito que já começava com 6 a 9; fixo
 *     começa com 2 a 5. Sem ela, um `93111-2222` qualquer viraria `3111-2222`,
 *     que tem cara de fixo — e o fixo `(11) 3111-2222` de uma clínica casaria
 *     com o celular de uma paciente. É o vínculo errado entrando pela porta da
 *     normalização.
 *
 *  O resultado é sempre DDD + 8 dígitos. Quando não dá para chegar lá, a chave
 *  volta `null` — e chave nula, por decisão do arquivo, não casa com nada.
 */
function chaveDeTelefone(t) {
  let d = somenteDigitos(t);

  if (d.length >= 12 && d.slice(0, 2) === '55') d = d.slice(2);   // (a)

  if (d.length !== 10 && d.length !== 11) return null;

  const ddd = d.slice(0, 2);
  if (Number(ddd) < 11) return null;   // DDD comeca em 11; 00..10 nao existe

  let numero = d.slice(2);
  if (numero.length === 9 && numero[0] === '9' && '6789'.indexOf(numero[1]) !== -1) {
    numero = numero.slice(1);                                     // (b)
  }

  return ddd + numero;
}

/** Os dois telefones são da mesma pessoa?
 *
 *  Telefone que não vira chave não casa NEM COM ELE MESMO. Parece estranho
 *  escrito assim, e é de propósito: dois cadastros com o telefone `0` ou `9999`
 *  não provam nada sobre serem a mesma paciente. */
function mesmoTelefone(a, b) {
  const ka = chaveDeTelefone(a);
  const kb = chaveDeTelefone(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/** O que fazer com este lead que acabou de ser fechado.
 *
 *  @param {object} lead       { id, name, whatsapp, email, clientId }
 *  @param {Array}  pacientes  fichas DESTA clínica: { id, name, phone }
 *  @returns {object} { acao, cliente, candidatos, porque }
 *
 *  `acao` é uma de quatro:
 *
 *    'jaVinculado'  o lead já aponta para uma ficha. Fechar de novo não faz
 *                   nada — e é isto que impede a duplicata de quem arrasta o
 *                   card para fora e para dentro outra vez.
 *    'vincular'     existe UMA ficha com este telefone. O lead passa a apontar
 *                   para ela; nenhuma ficha nova nasce.
 *    'criar'        nenhuma ficha bate. A ficha nasce com os dados do lead.
 *    'ambiguo'      DUAS OU MAIS fichas têm este telefone. Ver abaixo.
 *
 *  ==================================== POR QUE 'ambiguo' NÃO SE RESOLVE SOZINHO
 *
 *  Duas fichas com o mesmo telefone não é defeito de cadastro: é a mãe que
 *  marca pela filha, o casal que usa um número só, a paciente que cadastrou a
 *  irmã. Numa clínica isso é rotina.
 *
 *  "Pegar a mais antiga" resolveria o caso na tela e poria a sessão da filha na
 *  ficha da mãe. "Criar mais uma" acrescenta a terceira duplicata justo onde já
 *  há duas. As duas saídas automáticas são piores do que perguntar, então aqui
 *  o lead fecha, ninguém é vinculado, e a tela pede que a recepção — que
 *  conhece as duas — escolha a ficha certa.
 */
function escolherFicha(lead, pacientes) {
  lead = lead || {};
  const lista = Array.isArray(pacientes) ? pacientes : [];

  if (lead.clientId) {
    return {
      acao: 'jaVinculado', cliente: null, candidatos: [],
      porque: 'Este lead já tem ficha de paciente vinculada.'
    };
  }

  const chave = chaveDeTelefone(lead.whatsapp);

  /* Telefone que nao vira chave nao procura ninguem: procurar com chave frouxa
     e' como o vinculo errado comeca. Cria ficha e segue. */
  const candidatos = chave
    ? lista.filter((p) => chaveDeTelefone(p.phone) === chave)
    : [];

  if (candidatos.length === 1) {
    return {
      acao: 'vincular', cliente: candidatos[0], candidatos: candidatos,
      porque: 'Já existe ficha com este telefone: ' + candidatos[0].name + '.'
    };
  }

  if (candidatos.length > 1) {
    return {
      acao: 'ambiguo', cliente: null, candidatos: candidatos,
      porque: candidatos.length + ' pacientes têm este telefone (' +
        candidatos.map((c) => c.name).join(', ') + '). ' +
        'Escolha a ficha certa — vincular a errada mistura o histórico das duas.'
    };
  }

  return {
    acao: 'criar', cliente: null, candidatos: [],
    porque: chave
      ? 'Nenhuma ficha com este telefone.'
      : 'O telefone do lead não permite procurar ficha existente.'
  };
}

module.exports = { somenteDigitos, chaveDeTelefone, mesmoTelefone, escolherFicha };
