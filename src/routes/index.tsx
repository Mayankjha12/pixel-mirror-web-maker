import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Search, ShieldCheck, Activity, Package, Gauge } from "lucide-react";
import { useFleet } from "@/lib/fleet-context";
import { BASES, SPEC } from "@/lib/engine/fleet";
import { inputsFromStates, planMaintenance } from "@/lib/engine/scheduler";
import type { Status } from "@/lib/engine/core";
import { CountUp, HealthRing, Panel, StatusPill, fmtRul, statusText, tooltipStyle } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fleet Dashboard — VyomDrishti AI" },
      { name: "description", content: "Live fleet health, RUL-driven alerts and a 30-day availability forecast for a simulated air fleet." },
      { property: "og:title", content: "Fleet Dashboard — VyomDrishti AI" },
      { property: "og:description", content: "From reactive repairs to predicted readiness. Simulated predictive-maintenance dashboard." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { states, fleet, alerts } = useFleet();
  const [base, setBase] = useState<string>("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"rul" | "health" | "tail">("rul");

  const plan = useMemo(() => planMaintenance(inputsFromStates(states), fleet.inventory, fleet.agencies), [states, fleet]);
  const critical = states.filter((s) => s.status === "critical").length;
  const watch = states.filter((s) => s.status === "watch").length;
  const available = states.filter((s) => !s.comps.some((c) => c.failed)).length;
  const predicted30 = states.flatMap((s) => s.comps).filter((c, i) => c.rul / states[Math.floor(i / 6)].ac.utilization < 30).length;
  const shortages = plan.tasks.filter((t) => t.spareSource === "order").length;

  const list = states
    .filter((s) => base === "all" || s.ac.base === base)
    .filter((s) => status === "all" || s.status === status)
    .filter((s) => s.ac.tail.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === "rul" ? a.rul - b.rul : sort === "health" ? a.health - b.health : a.ac.tail.localeCompare(b.ac.tail)));

  const kpis = [
    { label: "Fleet Availability", value: (available / states.length) * 100, suffix: "%", decimals: 1, icon: ShieldCheck, tone: "text-primary" },
    { label: "Aircraft Critical", value: critical, icon: AlertTriangle, tone: "text-critical" },
    { label: "Aircraft on Watch", value: watch, icon: Activity, tone: "text-warning" },
    { label: "Predicted Failures · 30d", value: predicted30, icon: Gauge, tone: "text-foreground" },
    { label: "Spares Shortages", value: shortages, icon: Package, tone: shortages ? "text-warning" : "text-success" },
  ];

  return (
    <div className="space-y-6">
      <div className="pt-2">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-primary">SIH26249 · Air Power</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">From reactive repairs to predicted readiness.</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
          24 aircraft · 3 bases · 144 monitored components. Health index, remaining useful life and maintenance plans are computed live by the in-browser engine.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="glass lift p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {k.label}
              <k.icon className={cn("h-4 w-4", k.tone)} />
            </div>
            <CountUp value={k.value} decimals={k.decimals} suffix={k.suffix} className={cn("mt-2 block text-3xl font-semibold", k.tone)} />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="30-day availability forecast" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={plan.availability} margin={{ left: -16, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gOpt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(d) => `D${d}`} />
                <YAxis domain={[50, 100]} stroke="var(--muted-foreground)" fontSize={11} unit="%" />
                <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="optimized" name="With VyomDrishti" stroke="var(--primary)" strokeWidth={2} fill="url(#gOpt)" />
                <Area type="monotone" dataKey="baseline" name="Time-based maintenance" stroke="var(--chart-2)" strokeDasharray="5 4" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Avg availability <span className="font-mono text-primary">{plan.avgOpt.toFixed(1)}%</span> vs{" "}
            <span className="font-mono">{plan.avgBase.toFixed(1)}%</span> time-based · consequences evaluated against the simulator's hidden true failure times.
          </p>
        </Panel>

        <Panel title="Live alerts" action={<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-success pulse-critical" />streaming</span>}>
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-live="polite">
            {alerts.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">No active alerts. Fleet nominal.</li>}
            <AnimatePresence initial={false}>
              {alerts.slice(0, 25).map((a) => (
                <motion.li key={a.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                  <Link to="/aircraft/$id" params={{ id: a.acId }} className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm hover:border-primary/40">
                    <AlertTriangle className={cn("h-4 w-4 shrink-0", statusText[a.level])} />
                    <span className="flex-1">
                      <span className="font-mono">{a.tail}</span> · {a.comp}
                      <span className="block text-xs text-muted-foreground">RUL {fmtRul(a.rul)} {a.tick ? `· T+${(a.tick * 0.1).toFixed(1)}d` : "· at start"}</span>
                    </span>
                    <StatusPill status={a.level} />
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Panel>
      </div>

      <Panel
        title="Fleet"
        action={<span className="text-xs text-muted-foreground">{list.length} of {states.length}</span>}
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <label className="relative flex-1 min-w-48">
            <span className="sr-only">Search tail number</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tail…" className="h-9 w-full rounded-md border border-input bg-secondary/50 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <Select label="Base" value={base} onChange={setBase} options={[["all", "All bases"], ...BASES.map((b) => [b.id, b.name] as [string, string])]} />
          <Select label="Status" value={status} onChange={(v) => setStatus(v as Status | "all")} options={[["all", "All status"], ["critical", "Critical"], ["watch", "Watch"], ["healthy", "Healthy"]]} />
          <Select label="Sort" value={sort} onChange={(v) => setSort(v as typeof sort)} options={[["rul", "Sort: RUL"], ["health", "Sort: Health"], ["tail", "Sort: Tail"]]} />
        </div>
        {list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No aircraft match these filters.</p>
        ) : (
          <motion.div layout className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {list.map((s) => (
              <motion.div layout key={s.ac.id}>
                <Link to="/aircraft/$id" params={{ id: s.ac.id }} className="glass lift flex items-center gap-4 p-4">
                  <HealthRing value={s.health} status={s.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold">{s.ac.tail}</span>
                      <StatusPill status={s.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{BASES.find((b) => b.id === s.ac.base)?.name}</p>
                    <p className="mt-1 truncate text-xs">
                      {SPEC[s.worst.key].name} · <span className={cn("font-mono", statusText[s.status])}>RUL {fmtRul(s.rul)}</span>
                    </p>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </Panel>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-input bg-secondary/50 px-2 text-sm outline-none focus:ring-2 focus:ring-ring">
        {options.map(([v, l]) => (
          <option key={v} value={v} className="bg-popover">
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
