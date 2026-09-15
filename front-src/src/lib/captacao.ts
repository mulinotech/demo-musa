/**
 * A CHAVE DE CAPTAÇÃO DESTE SITE (11/09).
 *
 * ====================================================== O QUE ELA É
 *
 * O endereço `POST /api/leads` é a única gravação sem sessão do sistema: é por
 * onde o formulário de pré-agendamento e o quiz mandam o contato. Com várias
 * clínicas na mesma instalação, o servidor não tem como adivinhar de quem é o
 * lead — então quem posta diz, pela chave da clínica:
 *
 *     POST /api/leads?captacao=cap_xxxxxxxxxxxxxxxxxxxxxxxx
 *
 * **Ela não é uma senha, e não precisa ser secreta.** Ela vive no código desta
 * página: qualquer visitante a lê apertando Ctrl+U. O que ela permite é criar
 * um lead nesta clínica, e nada mais — não lê paciente, não lê agenda, não lê
 * nada. O remédio contra uso indevido é o limite de envios por IP no servidor,
 * não o sigilo.
 *
 * ======================================= POR QUE ELA ESTÁ ESCRITA AQUI
 *
 * Porque este site é o site de UMA clínica. Cada clínica tem o seu, e cada um
 * carrega a chave da sua — é o mesmo trecho que a tela de Funil & Leads mostra
 * pronto para colar.
 *
 * Para publicar este mesmo front para outra clínica, defina `VITE_CHAVE_CAPTACAO`
 * na hora de gerar o `dist`; sem isso vale a chave abaixo, que é a da Musa.
 *
 * Se a chave for trocada no banco e não aqui, o servidor recusa (503) e o
 * visitante vê uma mensagem pedindo para falar pelo WhatsApp — a recusa é alta e
 * visível de propósito, e o registro dela fica nos logs da plataforma.
 */
export const CHAVE_CAPTACAO: string =
  (import.meta as any).env?.VITE_CHAVE_CAPTACAO || 'cap_9f429454fb35ebe6b7919f60';

/** O endereço de captação pronto, com a chave. Um lugar só para montar isso. */
export const URL_CAPTACAO = '/api/leads?captacao=' + encodeURIComponent(CHAVE_CAPTACAO);
