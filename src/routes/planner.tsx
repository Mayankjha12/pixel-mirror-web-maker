import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Sparkles, CheckCircle2 } from "lucide-react";
import { useFleet } from "@/lib/fleet-context";
import { BASES, HANGARS_PER_BASE } from "@/lib/engine/fleet";
import { HORIZON, type PlanResult, inputsFromStates, planMaintenance } from "@/lib/engine/scheduler";
import { statusFromRul } from "@/lib/engine/core";
import { Button } from "@/components/ui/button";
import { CountUp, PageHeader, Panel, StatusPill, tooltipStyle, statusBg } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/planner")({
  head: () => ({
    meta: [
      { title: "Maintenance Planner — VyomDrishti AI" },
      { name: "description", content: "Priority task queue, hangar Gantt timeline, conflict detection and constraint-aware schedule optimization." },
      { property: "og:title", content: "Maintenance Planner — VyomDrishti AI" },
      { property: "og:description", content: "Greedy urgency × impact optimizer respecting spares, agency capacity and hangar slots." },
    ],
  }),
  component: Planner,
});

function Planner() {
  const { states, fleet } = useFleet();
  const [plan, setPlan] = useState<PlanResult>(() => planMaintenance(inputsFromStates(states), fleet.inventory, fleet.agencies));
  const [optimized, setOptimized] = useState(false);

  const run = () => {
    setPlan(planMaintenance(inputsFromStates(states), fleet.inventory, fleet.agencies));
    setOptimized(true);
  };
  const tasks = optimized ? plan.tasks : plan.naive;
  const rows = BASES.flatMap((b) => Array.from({ length: HANGARS_PER_BASE }, (_, h) => ({ base: b.id, label: `${b.name} · H${h + 1}`, h })));
  const conflicts = tasks.flatMap((t) => t.conflicts.map((c) => ({ tail: t.tail, name: t.name, c, id: t.id })));

  return (
    <div className="space-y-6">
      <PageHeader title="Maintenance Planner" subtitle="Tasks are generated from each component's lower-bound RUL. The naive plan books every job just-in-time in Hangar 1; the optimizer re-sequences by urgency × availability impact under real constraints.">
        <Button onClick={run} size="lg" className="gap-2">
          <Sparkles className="h-4 w-4" /> {optimized ? "Re-optimize" : "Auto-optimize schedule"}
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Tasks in queue" value={plan.tasks.length} />
        <Kpi label="Conflicts" value={conflicts.length} tone={conflicts.length ? "text-warning" : "text-success"} />
        <Kpi label="Availability (time-based → optimized)" value={optimized ? plan.avgOpt : plan.avgBase} decimals={1} suffix="%" tone="text-primary" sub={optimized ? `from ${plan.avgBase.toFixed(1)}%` : "run optimizer"} />
        <Kpi label="Avoided downtime" value={optimized ? plan.avoidedDowntimeDays : 0} decimals={1} suffix=" ac-days" tone="text-success" />
      </div>

      <Panel title={optimized ? "Optimized schedule" : "Naive just-in-time schedule"} action={<span className="text-xs text-muted-foreground">Days 0–{HORIZON}</span>}>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="ml-40 grid text-[10px] text-muted-foreground" style={{ gridTemplateColumns: `repeat(${HORIZON}, 1fr)` }}>
              {Array.from({ length: HORIZON }, (_, d) => (
                <span key={d} className="border-l border-border/50 pl-0.5 font-mono">{d % 5 === 0 ? `D${d}` : ""}</span>
              ))}
            </div>
            {rows.map((r) => {
              const rowTasks = tasks.filter((t) => t.base === r.base && t.hangar === r.h && t.start !== null && t.start < HORIZON);
              return (
                <div key={r.label} className="flex items-center border-t border-border/60">
                  <span className="w-40 shrink-0 py-3 text-xs text-muted-foreground">{r.label}</span>
                  <div className="relative h-10 flex-1">
                    {rowTasks.map((t) => (
                      <motion.div
                        key={t.id}
                        layoutId={t.id}
                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                        className={cn(
                          "absolute top-1.5 flex h-7 items-center overflow-hidden rounded-md border px-1.5 text-[10px] font-medium",
                          t.conflicts.length ? "border-warning/70 bg-warning/20" : "border-primary/50 bg-primary/20",
                        )}
                        style={{ left: `${(t.start! / HORIZON) * 100}%`, width: `${(Math.min(t.duration, HORIZON - t.start!) / HORIZON) * 100}%` }}
                        title={`${t.tail} ${t.name} · day ${t.start}–${t.start! + t.duration}${t.conflicts.length ? " · " + t.conflicts.join("; ") : ""}`}
                      >
                        <span className={cn("mr-1 h-1.5 w-1.5 shrink-0 rounded-full", statusBg[statusFromRul(t.rulHours)])} />
                        <span className="truncate font-mono">{t.tail}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Priority task queue" className="lg:col-span-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="pb-2">#</th><th>Aircraft</th><th>Component</th><th>RUL</th><th>Priority</th><th>Spare</th><th>Start</th></tr>
            </thead>
            <tbody>
              {plan.tasks.map((t, i) => (
                <tr key={t.id} className="border-t border-border/60">
                  <td className="py-2 font-mono text-muted-foreground">{i + 1}</td>
                  <td><Link to="/aircraft/$id" params={{ id: t.acId }} className="font-mono hover:text-primary">{t.tail}</Link></td>
                  <td>{t.name}</td>
                  <td><StatusPill status={statusFromRul(t.rulHours)} className="mr-1" /><span className="font-mono text-xs">{t.rulDays.toFixed(1)}d</span></td>
                  <td className="font-mono">{t.priority.toFixed(2)}</td>
                  <td className="text-xs">{t.spareSource === "base" ? "In stock" : t.spareSource === "transfer" ? `Transfer from ${t.spareFrom}` : t.spareSource === "depot" ? "From depot" : `Order (${t.spareReadyDay}d)`}</td>
                  <td className="font-mono">{optimized ? (t.start !== null ? `D${t.start}` : "—") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.tasks.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No maintenance needed within horizon.</p>}
        </Panel>

        <Panel title="Conflicts" className="lg:col-span-2">
          {conflicts.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> No constraint violations.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {conflicts.map((c, i) => (
                <li key={i} className="flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  <span><span className="font-mono">{c.tail}</span> · {c.name}: {c.c}</span>
                </li>
              ))}
            </ul>
          )}
          {optimized && <p className="mt-3 text-xs text-muted-foreground">Naive plan had {plan.naiveConflicts} conflicts. Remaining items are hard limits (e.g. spares not available anywhere).</p>}
        </Panel>
      </div>

      {optimized && (
        <Panel title="Fleet availability: before vs after">
          <div className="h-56">
            <ResponsiveContainer>
              <AreaChart data={plan.availability} margin={{ left: -16, right: 8 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis domain={[50, 100]} unit="%" stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area dataKey="optimized" name="Optimized" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} strokeWidth={2} />
                <Area dataKey="baseline" name="Time-based" stroke="var(--chart-2)" fill="none" strokeDasharray="5 4" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Kpi({ label, value, decimals = 0, suffix = "", tone, sub }: { label: string; value: number; decimals?: number; suffix?: string; tone?: string; sub?: string }) {
  return (
    <div className="glass lift p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <CountUp value={value} decimals={decimals} suffix={suffix} className={cn("mt-1 block text-2xl font-semibold", tone)} />
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
