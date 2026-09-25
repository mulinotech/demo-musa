import EvolutionHub from "../../components/EvolutionHub";
import { useCrm } from "./contexto";

export default function IntegracaoWhatsApp() {
  const crm = useCrm();
  return <EvolutionHub onWebhookTriggered={() => crm.atualizar()} />;
}
