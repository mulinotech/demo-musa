'use strict';
/** A entrada de mensagens do WhatsApp está viva? (M5.9, 21/09)
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  Em 18/09 descobrimos que o caminho de entrada do WhatsApp da clínica estava
 *  morto **desde sempre**: 8 mensagens enviadas, **zero recebidas**, em nenhum
 *  dia. O código do webhook estava correto e público; a instância da Evolution
 *  simplesmente nunca tinha sido apontada para ele.
 *
 *  O que torna esse defeito caro não é a configuração que faltou — é que
 *  **nenhuma tela dizia nada**. A clínica enviava mensagem e via a mensagem
 *  sair; a paciente respondia e a resposta caía num buraco. Para quem olha a
 *  tela, os dois lados pareciam iguais.
 *
 *  Este arquivo é a regra que decide o que a tela mostra, e ele é **puro**: não
 *  fala com a Evolution nem com o banco. Recebe os quatro fatos que importam e
 *  devolve um diagnóstico. Isso permite testar todos os casos — inclusive os
 *  que ninguém consegue reproduzir à mão, como "o webhook aponta para o
 *  endereço de outra instalação".
 *
 *  ============================================== OS QUATRO FATOS QUE IMPORTAM
 *
 *      instancia          a clínica tem uma instância vinculada?
 *      webhook            a Evolution está com webhook ligado, e para qual URL?
 *      ultimaRecebida     quando entrou a última mensagem de paciente?
 *      ultimaEnviada      quando saiu a última mensagem da clínica?
 *
 *  O par das duas últimas é o que separa "ninguém escreveu" de "chegou e se
 *  perdeu". Clínica que **envia** e nunca **recebe** é o retrato exato do
 *  defeito de 18/09, e merece alarme — enquanto clínica que não fez nada ainda
 *  hoje merece silêncio.
 */

const NIVEIS = ['ok', 'atencao', 'parada'];

/** 'AAAA-MM-DD' de um Date ou string, ou null. */
function dia(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
  }
  return String(v).slice(0, 10);
}

function diasEntre(de, ate) {
  if (!de || !ate) return null;
  const ms = 86400000;
  return Math.round((new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / ms);
}

/** O webhook da Evolution aponta para ESTA instalação?
 *
 *  Compara só o caminho e o host, ignorando barra final e diferença de
 *  maiúsculas. Um webhook ligado, mas apontado para o endereço de outro
 *  servidor, é o caso mais traiçoeiro de todos: a Evolution reporta "ligado" e
 *  a mensagem vai para a instalação errada. */
function apontaParaCa(urlDoWebhook, urlEsperada) {
  const limpa = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  const a = limpa(urlDoWebhook);
  const b = limpa(urlEsperada);
  if (!a || !b) return false;
  return a === b;
}

/** "hoje", "ontem" ou "há N dias" — nunca precedido de preposição de lugar. */
function quandoEntrou(dias) {
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return 'há ' + dias + ' dias';
}

/** O diagnóstico da entrada.
 *
 *  @param {object} f  { instancia, webhookLigado, webhookUrl, urlEsperada,
 *                       eventos, ultimaRecebida, ultimaEnviada, hoje }
 *  @returns {object}  { nivel, titulo, detalhe, oQueFazer, podeLigar, fatos }
 */
function diagnosticar(f) {
  f = f || {};
  const hoje = dia(f.hoje) || dia(new Date());
  const recebida = dia(f.ultimaRecebida);
  const enviada = dia(f.ultimaEnviada);
  const eventos = f.eventos || [];
  const temUpsert = eventos.some((e) => String(e).toUpperCase() === 'MESSAGES_UPSERT');

  const fatos = {
    instancia: f.instancia || null,
    webhookLigado: !!f.webhookLigado,
    webhookUrl: f.webhookUrl || null,
    apontaParaCa: apontaParaCa(f.webhookUrl, f.urlEsperada),
    temEventoDeMensagem: temUpsert,
    ultimaRecebida: recebida,
    ultimaEnviada: enviada,
    diasSemReceber: diasEntre(recebida, hoje)
  };

  /* A ordem das perguntas é a ordem em que as coisas quebram na vida real, e
     cada resposta diz O QUE FAZER — diagnóstico sem próximo passo só troca uma
     dúvida por outra. */

  if (!fatos.instancia) {
    return {
      nivel: 'parada', titulo: 'Esta clínica não tem WhatsApp conectado',
      detalhe: 'Sem uma instância vinculada, nenhuma mensagem de paciente chega ao CRM — ' +
        'e nenhuma sai por aqui.',
      oQueFazer: 'Conecte o WhatsApp da clínica nesta tela, lendo o QR Code com o aparelho.',
      podeLigar: false, fatos: fatos
    };
  }

  if (!fatos.webhookLigado) {
    return {
      nivel: 'parada', titulo: 'A entrada de mensagens está desligada',
      /* "vinculado", e nao "conectado": ter instancia gravada nao prova que o
         aparelho esta pareado agora -- isso quem mede e' o cartao de status,
         logo abaixo nesta mesma tela. Afirmar o que nao foi medido e' o defeito
         da M5.8 em outra roupa. */
      detalhe: 'A clínica tem WhatsApp vinculado e consegue ENVIAR, mas as respostas das ' +
        'pacientes não voltam para o CRM. Foi assim que a Musa passou semanas sem receber ' +
        'nenhuma resposta, sem nada avisar.',
      oQueFazer: 'Clique em "Ligar a entrada de mensagens" aqui embaixo.',
      podeLigar: true, fatos: fatos
    };
  }

  if (!fatos.apontaParaCa) {
    return {
      nivel: 'parada', titulo: 'A entrada está ligada, mas apontando para outro endereço',
      detalhe: 'O WhatsApp está entregando as mensagens desta clínica em ' +
        (fatos.webhookUrl || 'um endereço desconhecido') + ', que não é este sistema. ' +
        'Elas não se perdem — chegam no lugar errado.',
      oQueFazer: 'Clique em "Ligar a entrada de mensagens" para reapontar para cá.',
      podeLigar: true, fatos: fatos
    };
  }

  if (!fatos.temEventoDeMensagem) {
    return {
      nivel: 'parada', titulo: 'A entrada está ligada, mas não para mensagens',
      detalhe: 'O webhook existe e aponta para cá, só que sem o evento de mensagem recebida ' +
        '(MESSAGES_UPSERT). Na prática, é o mesmo que estar desligado.',
      oQueFazer: 'Clique em "Ligar a entrada de mensagens" para acertar os eventos.',
      podeLigar: true, fatos: fatos
    };
  }

  /* Daqui para baixo a configuração está certa. O que resta é medir o
     COMPORTAMENTO — e aqui o silêncio pode ser normal. */

  if (!recebida && enviada) {
    return {
      nivel: 'atencao', titulo: 'A clínica já enviou, mas nunca recebeu nada',
      detalhe: 'A configuração está correta agora. Mas até hoje nenhuma mensagem de paciente ' +
        'entrou — e a clínica já enviou. Se isso não mudar no próximo contato, a entrada ' +
        'ainda tem problema.',
      oQueFazer: 'Peça a alguém para mandar uma mensagem ao WhatsApp da clínica e volte aqui.',
      podeLigar: true, fatos: fatos
    };
  }

  if (!recebida && !enviada) {
    return {
      nivel: 'ok', titulo: 'Entrada de mensagens ligada',
      detalhe: 'Está tudo configurado. Ainda não houve conversa nenhuma por aqui — o que é ' +
        'esperado em clínica que acabou de conectar.',
      oQueFazer: '', podeLigar: false, fatos: fatos
    };
  }

  if (fatos.diasSemReceber !== null && fatos.diasSemReceber > 7) {
    return {
      nivel: 'atencao', titulo: 'Nenhuma mensagem recebida há ' + fatos.diasSemReceber + ' dias',
      detalhe: 'A configuração está correta, e já entraram mensagens antes. Pode ser só um ' +
        'período parado — ou a conexão do aparelho pode ter caído.',
      oQueFazer: 'Confira o status da conexão acima. Se estiver desconectado, leia o QR Code de novo.',
      podeLigar: false, fatos: fatos
    };
  }

  return {
    nivel: 'ok', titulo: 'Entrada de mensagens funcionando',
    /* "entrou em há 3 dia(s)" foi o que saiu na primeira versao: o "em" pedia
       uma data e recebia uma duracao. Frase que a clinica le todo dia nao pode
       ter costura aparente. */
    detalhe: 'A última mensagem de paciente entrou ' + quandoEntrou(fatos.diasSemReceber) + '.',
    oQueFazer: '', podeLigar: false, fatos: fatos
  };
}

module.exports = { NIVEIS, dia, diasEntre, apontaParaCa, quandoEntrou, diagnosticar };
