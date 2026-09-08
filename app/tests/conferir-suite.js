'use strict';
/** Confere que TODO arquivo listado em `npm test` existe de verdade.
 *
 *  ===================================================== POR QUE ISTO EXISTE
 *
 *  `node --test a.js b.js` com o `b.js` ausente **não reclama**: roda o que
 *  achou, informa "0 falhas" e sai com sucesso. Medido em 04/09.
 *
 *  Consequência: um arquivo de teste que não chegou ao servidor — envio
 *  interrompido, `scp` que caiu, arquivo esquecido no pacote — some da suíte
 *  sem deixar rastro. A contagem cai, e ninguém repara numa contagem que sobe
 *  o tempo todo. Foi exatamente o que aconteceu: 318 viraram 291, tudo verde.
 *
 *  ================================================ POR QUE NÃO É UM `test()`
 *
 *  Um teste dentro da suíte não protegeria o caso pior: **o próprio arquivo de
 *  guarda faltando**. Aqui isto roda ANTES, com `&&` no `npm test` — se este
 *  arquivo sumir, o `node` erra ao abri-lo, o `&&` corta, e o `npm test`
 *  falha alto. A guarda protege inclusive a si mesma.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
const comando = (pacote.scripts && pacote.scripts.test) || '';

const listados = comando
  .split(/\s+/)
  .filter((p) => /^tests\/.+\.test\.js$/.test(p));

if (!listados.length) {
  console.error(
    'conferir-suite: nao encontrei arquivo de teste nenhum no script "test" do package.json.\n' +
    'Se o formato do comando mudou, ajuste esta guarda junto -- guarda que nao ' +
    'encontra nada passa a aprovar tudo.'
  );
  process.exit(1);
}

const faltando = listados.filter((p) => !fs.existsSync(path.join(RAIZ, p)));

if (faltando.length) {
  console.error(
    '\nconferir-suite: ' + faltando.length + ' arquivo(s) de teste listado(s) em ' +
    '`npm test` NAO existem:\n' +
    faltando.map((p) => '  - ' + p).join('\n') + '\n\n' +
    'Sem esta guarda, `node --test` rodaria o resto e diria "0 falhas". ' +
    'Provavelmente um envio caiu no meio -- reenvie o(s) arquivo(s) e rode de novo.\n'
  );
  process.exit(1);
}

console.log('conferir-suite: ' + listados.length + ' arquivo(s) de teste no lugar.');
