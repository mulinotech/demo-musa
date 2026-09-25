import ClientDirectory from "../../components/ClientDirectory";
import { useCrm } from "./contexto";

export default function Pacientes() {
  const crm = useCrm();
  return (
    <ClientDirectory
      clients={crm.clients}
      treatments={crm.treatments}
      onAddClient={crm.onAddClient}
      onAddTreatment={crm.onAddTreatment}
      isAiConfigured={crm.isAiConfigured}
      onUpdateClientData={() => crm.atualizar(true)}
      treatmentCatalog={crm.treatmentCatalog}
      onUpdateClient={crm.onUpdateClient}
      onDeleteClient={crm.onDeleteClient}
      treatmentPlans={crm.treatmentPlans}
      onAddTreatmentPlan={crm.onAddTreatmentPlan}
      onUpdateTreatmentPlan={crm.onUpdateTreatmentPlan}
      onDeleteTreatmentPlan={crm.onDeleteTreatmentPlan}
      onUpdateTreatmentSession={crm.onUpdateTreatmentSession}
    />
  );
}
