import DashboardOverview from "../../components/DashboardOverview";
import { useCrm } from "./contexto";

export default function VisaoGeral() {
  const crm = useCrm();
  return (
    <DashboardOverview
      leads={crm.leads}
      clients={crm.clients}
      treatments={crm.treatments}
      treatmentCatalog={crm.treatmentCatalog}
    />
  );
}
