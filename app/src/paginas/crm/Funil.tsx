import PipelineKanban from "../../components/PipelineKanban";
import CaptacaoCard from "../../components/CaptacaoCard";
import { useCrm } from "./contexto";

export default function Funil() {
  const crm = useCrm();
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* O endereço do formulário do site fica AQUI, e não em Cadastros, porque
        * é aqui que alguém se pergunta "por que não está entrando lead?".
        * Configuração guardada longe da pergunta que ela responde é
        * configuração que ninguém encontra — foi o que aconteceu com o botão de
        * editar vendedor em 10/09. */}
      <CaptacaoCard />
      <div className="flex-1 min-h-0">
        <PipelineKanban
          leads={crm.leads}
          onAddLead={crm.onAddLead}
          onUpdateLeadStatus={crm.onUpdateLeadStatus}
          onSelectLead={(lead) => crm.onSelectLead(lead)}
        />
      </div>
    </div>
  );
}
