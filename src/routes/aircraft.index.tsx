import { createFileRoute, Link } from "@tanstack/react-router";
import { useFleet } from "@/lib/fleet-context";
import { BASE_NAME } from "@/lib/engine/fleet";
import { HealthRing, PageHeader, Panel, StatusPill, fmtRul, statusText } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/aircraft/")({
  head: () => ({
    meta: [
      { title: "Aircraft — VyomDrishti AI" },
      { name: "description", content: "All 24 simulated aircraft with component-level health and remaining useful life." },
      { property: "og:title", content: "Aircraft — VyomDrishti AI" },
      { property: "og:description", content: "Component-level health and RUL for every simulated airframe." },
    ],
  }),
  component: AircraftList,
});

function AircraftList() {
  const { states } = useFleet();
  const sorted = [...states].sort((a, b) => a.rul - b.rul);
  return (
    <div>
      <PageHeader title="Aircraft" subtitle="Select an airframe to open its digital twin, live telemetry and RUL forecasts." />
      <Panel className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="p-3">Aircraft</th>
              <th className="p-3">Base</th>
              <th className="p-3">Utilization</th>
              {states[0]?.comps.map((c) => (
                <th key={c.key} className="p-3">{c.name}</th>
              ))}
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.ac.id} className="border-b border-border/60 transition-colors hover:bg-secondary/40">
                <td className="p-3">
                  <Link to="/aircraft/$id" params={{ id: s.ac.id }} className="flex items-center gap-2 font-mono font-semibold hover:text-primary">
                    <HealthRing value={s.health} status={s.status} size={34} stroke={4} />
                    {s.ac.tail}
                  </Link>
                </td>
                <td className="p-3 text-muted-foreground">{BASE_NAME[s.ac.base]}</td>
                <td className="p-3 font-mono text-muted-foreground">{s.ac.utilization.toFixed(1)} FH/d</td>
                {s.comps.map((c) => (
                  <td key={c.key} className={cn("p-3 font-mono text-xs", statusText[c.status])}>
                    {fmtRul(c.rul)}
                  </td>
                ))}
                <td className="p-3"><StatusPill status={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
