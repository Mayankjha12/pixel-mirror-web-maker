import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle } from "lucide-react";
import { useFleet } from "@/lib/fleet-context";
import { BASES, BASE_NAME, COMPONENT_SPECS } from "@/lib/engine/fleet";
import { HORIZON, inputsFromStates, planMaintenance } from "@/lib/engine/scheduler";
import { PageHeader, Panel, tooltipStyle } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/logistics")({
  head: () => ({
    meta: [
      { title: "Spares & Logistics — VyomDrishti AI" },
      { name: "description", content: "Spares inventory vs RUL-predicted demand, shortage alerts, agency capacity and rerouting between bases and depot." },
      { property: "og:title", content: "Spares & Logistics — VyomDrishti AI" },
      { property: "og:description", content: "Predicted spares demand and cross-base rerouting for a simulated fleet." },
    ],
  }),
  component: Logistics,
});

const NODES: Record<string, { x: number; y: number; label: string }> = {
  north: { x: 300, y: 60, label: "Base North" },
  west: { x: 90, y: 230, label: "Base West" },
  east: { x: 510, y: 230, label: "Base East" },
  depot: { x: 300, y: 300, label: "Central Depot" },
};

function Logistics() {
  const { states, fleet } = useFleet();
  const plan = useMemo(() => planMaintenance(inputsFromStates(states), fleet.inventory, fleet.agencies), [states, fleet]);

  const demand = COMPONENT_SPECS.map((s) => {
    const stock = BASES.reduce((a, b) => a + (fleet.inventory.base[b.id][s.part] ?? 0), 0) + (fleet.inventory.depot[s.part] ?? 0);
    const need = plan.tasks.filter((t) => t.key === s.key).length;
    return { part: s.part, name: s.name, stock, demand: need, lead: fleet.inventory.leadDays[s.part] };
  });
  const shortages = demand.filter((d) => d.demand > d.stock);
  const agencyRows = fleet.agencies.map((a) => {
    const jobs = plan.tasks.filter((t) => t.agencyId === a.id && t.start !== null);
    const load = Array.from({ length: HORIZON }, (_, d) => jobs.filter((t) => d >= t.start! && d < t.start! + t.duration).length);
    const peak = Math.max(0, ...load);
    const firstFree = load.findIndex((l) => l < a.capacity);
    return { ...a, jobs: jobs.length, peak, eta: Math.max(0, firstFree) + a.turnaroundDays };
  });
  const flows = Object.values(
    plan.transfers.reduce<Record<string, { from: string; to: string; parts: string[] }>>((acc, t) => {
      const k = `${t.from}-${t.to}`;
      acc[k] = acc[k] ?? { from: t.from, to: t.to, parts: [] };
      acc[k].parts.push(t.part);
      return acc;
    }, {}),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Spares & Logistics" subtitle="Demand is the number of maintenance tasks the planner raised for each part within the 30-day horizon." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Inventory vs predicted demand" className="lg:col-span-3">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={demand} margin={{ left: -18, right: 8 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...tooltipStyle} cursor={{ fill: "var(--secondary)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="stock" name="Fleet stock" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="demand" name="Predicted demand (30d)" fill="var(--warning)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Shortage alerts" className="lg:col-span-2">
          {shortages.length === 0 ? (
            <p className="py-8 text-center text-sm text-success">Fleet stock covers predicted demand.</p>
          ) : (
            <ul className="space-y-2">
              {shortages.map((s) => (
                <li key={s.part} className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical/5 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-critical" />
                  <div>
                    <p><span className="font-mono">{s.part}</span> · {s.name}</p>
                    <p className="text-xs text-muted-foreground">Short by {s.demand - s.stock} · reorder lead time {s.lead} days — order now</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Spares rerouting network">
          <svg viewBox="0 0 600 340" className="w-full" role="img" aria-label="Bases and depot rerouting graph">
            {[["north", "west"], ["north", "east"], ["west", "east"], ["depot", "north"], ["depot", "west"], ["depot", "east"]].map(([a, b]) => (
              <line key={a + b} x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y} stroke="var(--border)" strokeWidth={1.5} />
            ))}
            {flows.map((f) => (
              <g key={f.from + f.to}>
                <line x1={NODES[f.from].x} y1={NODES[f.from].y} x2={NODES[f.to].x} y2={NODES[f.to].y} stroke="var(--primary)" strokeWidth={2.5} className="flow-dash" />
                <text x={(NODES[f.from].x + NODES[f.to].x) / 2} y={(NODES[f.from].y + NODES[f.to].y) / 2 - 8} textAnchor="middle" fontSize={11} className="fill-primary font-mono">
                  {f.parts.length}× {[...new Set(f.parts)].join(", ")}
                </text>
              </g>
            ))}
            {Object.entries(NODES).map(([id, n]) => {
              const stock = id === "depot" ? Object.values(fleet.inventory.depot).reduce((a, b) => a + b, 0) : Object.values(fleet.inventory.base[id]).reduce((a, b) => a + b, 0);
              return (
                <g key={id}>
                  <circle cx={n.x} cy={n.y} r={30} fill="var(--secondary)" stroke={id === "depot" ? "var(--warning)" : "var(--primary)"} strokeWidth={1.5} />
                  <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={13} className="fill-foreground font-mono">{stock}</text>
                  <text x={n.x} y={n.y + 48} textAnchor="middle" fontSize={11} className="fill-muted-foreground">{n.label}</text>
                </g>
              );
            })}
          </svg>
          <p className="text-xs text-muted-foreground">Node value = units in stock. Animated edges are transfers the optimizer chose instead of waiting on a reorder.</p>
        </Panel>
        <Panel title="Agency capacity & ETA" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="pb-2">Agency</th><th>Capacity</th><th>Jobs (30d)</th><th>Peak load</th><th>Next-slot ETA</th></tr>
            </thead>
            <tbody>
              {agencyRows.map((a) => (
                <tr key={a.id} className="border-t border-border/60">
                  <td className="py-2.5">{a.name}</td>
                  <td className="font-mono">{a.capacity}</td>
                  <td className="font-mono">{a.jobs}</td>
                  <td><span className={cn("font-mono", a.peak >= a.capacity ? "text-warning" : "text-success")}>{a.peak}/{a.capacity}</span></td>
                  <td className="font-mono">{a.eta}d</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            {BASES.map((b) => (
              <div key={b.id} className="rounded-md border border-border p-2">
                <p className="mb-1 text-muted-foreground">{BASE_NAME[b.id]}</p>
                {COMPONENT_SPECS.map((s) => (
                  <p key={s.part} className="flex justify-between font-mono"><span>{s.part.slice(0, 3)}</span><span>{fleet.inventory.base[b.id][s.part]}</span></p>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
