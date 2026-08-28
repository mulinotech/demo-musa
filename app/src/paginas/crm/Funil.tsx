import PipelineKanban from "../../components/PipelineKanban";
import { useCrm } from "./contexto";

export default function Funil() {
  const crm = useCrm();
  return (
    <PipelineKanban
      leads={crm.leads}
      onAddLead={crm.onAddLead}
      onUpdateLeadStatus={crm.onUpdateLeadStatus}
      onSelectLead={(lead) => crm.onSelectLead(lead)}
    />
  );
}
