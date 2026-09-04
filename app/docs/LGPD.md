# LGPD — onde o Musa guarda dado pessoal, e o que o sistema garante

> Documento técnico. Descreve **o que o software faz**. Não define política:
> finalidade, base legal e prazo de retenção são decisão da clínica com o
> jurídico dela, e o sistema entrega o campo e a trilha para registrá-las.
>
> Última revisão: 31/08/2026 (Fase 4, T4.5).

## 1. O que é dado sensível aqui

A Lei 13.709/2018 (LGPD), art. 5º, II, classifica **dado referente à saúde** como
dado pessoal sensível. Numa clínica de estética isso não é detalhe jurídico: é a
maior parte do que o sistema guarda.

| Tabela | Conteúdo | Sensível? |
|---|---|---|
| `clients` | nome, telefone, e-mail, endereço, data de nascimento | pessoal |
| `clients.anamnese` | histórico de saúde em texto livre (cadastro antigo) | **sensível** |
| `clients.imageBase64` | foto do rosto | **sensível** (biométrico/saúde) |
| `clients.laudo` | análise de pele gerada por IA | **sensível** |
| `client_documents` | anamnese estruturada, termos assinados, assinatura | **sensível** |
| `client_documents.signer_document` | CPF de quem assinou | pessoal |
| `client_documents.signed_ip` | endereço de rede no momento da assinatura | pessoal |
| `treatment_plans`, `treatment_sessions` | procedimentos realizados | **sensível** |
| `appointments` | histórico de horários e procedimentos | **sensível** |
| `interactions` | conversas de WhatsApp com a paciente | pessoal, e pode conter sensível |
| `loyalty_transactions` | pontos por atendimento | pessoal |
| `cash_entries` | valores pagos por paciente | pessoal (financeiro) |
| `system_logs` | quem fez o quê, e quando | pessoal (de funcionário) |

`leads` e `salespeople` contêm dado pessoal comum, não sensível.

## 2. O que o sistema garante hoje

**Acesso por papel, verificado no servidor.** `server/middleware/autorizacao.js`.
O perfil `vendedor` **não** acessa nenhuma rota de documento clínico, alerta
clínico ou exportação — o time comercial não tem por que ver histórico de saúde.
Há teste travando isso (`tests/documentos.test.js`).

> Detalhe que já causou um furo e está corrigido: a tabela de papéis casava por
> prefixo, e `/api/clients/:id/documents` cairia sob `/api/clients`, que não tem
> regra de leitura — deixando a rota aberta a qualquer autenticado. As regras
> desse módulo usam `padrao` (expressão regular) por isso. **Rota nova com id no
> meio do caminho precisa de `padrao`.**

**Trilha de acesso a dado sensível.** Toda leitura de documento **assinado**
grava em `system_logs` com categoria `LGPD`: quem abriu, qual documento, de qual
paciente, quando. Toda exportação de dados de paciente também. É o que permite
responder "quem viu isso?" — pergunta que só aparece quando já é tarde.

**Nenhum documento em diretório público.** Não existe arquivo de documento
servido estaticamente. O conteúdo sai por `GET /api/documents/:id/view`,
autenticado. Um PDF de anamnese com URL adivinhável é vazamento de dado
sensível, e a forma de não ter esse risco é não ter o arquivo público.

**Integridade verificável.** Documento gerado é congelado em `rendered_html` com
`content_hash` (SHA-256). A leitura recalcula o hash e avisa na própria página se
o conteúdo não corresponde — sinal de alteração feita por fora do sistema.

**Portabilidade.** `GET /api/clients/:id/export` devolve, em JSON, tudo o que a
clínica guarda sobre a paciente: cadastro, documentos, compromissos, interações,
planos e pontos. Atende o art. 18, V. A foto não vai no JSON (tamanho), e o
arquivo indica que ela existe.

**Consentimento registrado no documento.** O termo semeado tem cláusula de
tratamento de dados, com campos separados para autorização de registro
fotográfico clínico e para autorização de uso em divulgação — que são
finalidades diferentes e não podem ser uma só caixa.

## 3. O que o sistema NÃO garante, e precisa de decisão da clínica

- **Prazo de retenção.** Não há expurgo automático. Prontuário tem prazo definido
  pela legislação sanitária, e apagar dado clínico antes do prazo é problema
  maior do que guardar. Definir o prazo e o procedimento é da clínica.
- **Base legal de cada finalidade.** O texto do termo cita a finalidade de
  atendimento; marketing e divulgação são finalidade distinta, com consentimento
  próprio no mesmo termo. Revisar esse texto é tarefa jurídica, não técnica.
- **Exclusão a pedido.** Não existe rota de "apagar tudo", de propósito: em
  registro de saúde o direito de exclusão convive com obrigação legal de
  guarda, e a decisão caso a caso não deve ser automática.
- **Encarregado (DPO) e canal de titular.** Definição da clínica.
- **Contrato com operadores.** A Evolution API (WhatsApp) e o provedor de IA
  processam dado de paciente. A relação com eles é de controlador–operador e
  precisa de previsão contratual.

## 4. Dívidas técnicas com efeito em privacidade

Registradas também em `OPERACOES.md`:

1. **`clients.anamnese` ainda existe** com o texto livre antigo, preservada de
   propósito por um ciclo (a migration 016 copiou para o modelo novo sem apagar).
   Quando a clínica confirmar a migração, essa coluna deve ser removida — hoje o
   mesmo dado clínico vive em dois lugares.
2. **Fotos em `clients.imageBase64`**, dentro do banco. Funciona, mas mistura
   dado biométrico com a tabela de cadastro e infla backups. Mover para
   armazenamento próprio com acesso autenticado é melhoria pendente.
3. **As duas senhas que já estiveram no bundle** continuam no histórico do git.
   Estão queimadas e não podem ser reutilizadas em nenhum sistema da Mulino.
4. **`salespeople.password`** ainda existe como coluna e deve ser removida.
5. **Credenciais de banco defasadas no `.env`** do servidor, e a rota temporária
   `POST /api/_migrate` que existe por causa disso.

## 5. Como responder a um pedido de titular

1. **Acesso / portabilidade:** `GET /api/clients/:id/export` (admin, gerente ou
   profissional). A exportação fica registrada.
2. **Correção:** editar o cadastro. Documento assinado **não** se corrige —
   emite-se documento novo, e o anterior pode ser cancelado com motivo; os dois
   ficam no histórico.
3. **Saber quem acessou:** filtrar `system_logs` por categoria `LGPD` e pelo nome
   da paciente.
4. **Revogar consentimento de divulgação:** emitir novo termo com a resposta
   alterada. O termo anterior fica, porque houve um período em que a autorização
   valeu — apagá-lo apagaria a prova disso.
