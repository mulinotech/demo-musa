/**
 * O dia de hoje no calendário de quem está usando (relatório de QA de 15/10, BUG-06).
 *
 * `new Date().toISOString().slice(0, 10)` dá o dia em UTC. Depois das 21h em
 * Brasília já é "amanhã" em UTC — e o "Novo Plano", a "Nova Sessão" e a Visão
 * Geral abriam com o dia seguinte às 21h48 de 15/10.
 */
export function diaLocal(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
