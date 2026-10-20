import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, Wrench, Package, Building2, CalendarClock } from "lucide-react";
import { useFleet } from "@/lib/fleet-context";
import { BASE_NAME, SENSOR_META, SPEC, type ComponentKey, type Sensors, generateFleet, sensorsFor } from "@/lib/engine/fleet";
import { CountUp, HealthRing, Panel, StatusPill, fmtRul, statusVar, statusText, tooltipStyle } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/aircraft/$id")({
  loader: ({ params }) => {
    if (!generateFleet(2026).aircraft.some((a) => a.id === params.id)) throw notFound();
    return { id: params.id };
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.id} Digital Twin — VyomDrishti AI` },
      { name: "description", content: `Digital twin, live telemetry and RUL forecasts for simulated aircraft ${params.id}.` },
      { property: "og:title", content: `${params.id} Digital Twin — VyomDrishti AI` },
      { property: "og:description", content: "Component health hotspots, streaming sensors and remaining-useful-life bands." },
    ],
  }),
  notFoundComponent: () => (
    <div className="py-20 text-center">
      <p className="text-lg">Aircraft not found.</p>
      <Link to="/aircraft" className="mt-3 inline-block text-primary">Back to aircraft</Link>
    </div>
  ),
  component: AircraftDetail,
});

const HOTSPOTS: Record<ComponentKey, { x: number; y: number }> = {
  avionics: { x: 200, y: 95 },
  fuel: { x: 200, y: 190 },
  airframe: { x: 110, y: 250 },
  hydraulics: { x: 250, y: 245 },
  landingGear: { x: 170, y: 270 },
  engine: { x: 200, y: 335 },
};

function AircraftDetail() {
  const { id } = Route.useParams();
  const { states, seed, tick, fleet } = useFleet();
  const st = states.find((s) => s.ac.id === id);
  const [sel, setSel] = useState<ComponentKey | null>(null);
  const [buf, setBuf] = useState<(Sensors & { i: number })[]>([]);

  useEffect(() => {
    if (!st) return;
    setBuf((b) => [...b.slice(-59), { ...sensorsFor(st, seed, tick), i: tick }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, id, seed]);
  useEffect(() => {
    if (!st) return;
    const seedBuf = Array.from({ length: 30 }, (_, k) => ({ ...sensorsFor(st, seed, tick - 30 + k), i: tick - 30 + k }));
    setBuf(seedBuf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, seed]);

  const comp = useMemo(() => {
    if (!st) return null;
    return st.comps.find((c) => c.key === (sel ?? st.worst.key))!;
  }, [st, sel]);

  if (!st || !comp) return <p className="py-20 text-center text-muted-foreground">Loading aircraft…</p>;
  const spec = SPEC[comp.key];
  const failDays = comp.rul / st.ac.utilization;
  const failDate = new Date(Date.UTC(2026, 9, 20) + failDays * 86400000);
  const stock = fleet.inventory.base[st.ac.base][spec.part] ?? 0;
  const agency = fleet.agencies.find((a) => a.id === spec.agency)!;

  const band = comp.series.map((p) => ({ t: p.t, obs: +p.obs.toFixed(3), smooth: p.smooth !== null ? +p.smooth.toFixed(3) : null }));
  const last = band[band.length - 1];
  const tNow = comp.age;
  const sNow = last?.smooth ?? 0;
  const chartData: { t: number; obs: number | null; smooth: number | null; proj: number | null }[] = band.map((b) => ({ ...b, proj: null }));
  if (comp.rul < 1000 && chartData.length) {
    chartData[chartData.length - 1].proj = sNow;
    const steps = 8;
    for (let k = 1; k <= steps; k++) {
      const dt = (comp.rul * k) / steps;
      // exponential projection consistent with the log-linear model
      const y = Math.log(Math.max(sNow, 0) + 0.05) + (Math.log(1.05) - Math.log(Math.max(sNow, 0) + 0.05)) * (k / steps);
      chartData.push({ t: +(tNow + dt).toFixed(1), obs: null, smooth: null, proj: +(Math.exp(y) - 0.05).toFixed(3) });
    }
  }
  const bandLo = tNow + comp.lo;
  const bandHi = tNow + Math.min(comp.hi, comp.rul * 3 + 50);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link to="/aircraft" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Aircraft</Link>
        <h1 className="font-mono text-2xl font-semibold md:text-3xl">{st.ac.tail}</h1>
        <StatusPill status={st.status} />
        <span className="text-sm text-muted-foreground">{BASE_NAME[st.ac.base]} · {st.ac.squadron} · {st.ac.utilization.toFixed(1)} FH/day</span>
        <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">Aircraft health <CountUp value={st.health} className="text-xl text-foreground" /></span>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Digital twin" className="lg:col-span-2">
          <svg viewBox="0 0 400 400" className="mx-auto w-full max-w-sm" role="group" aria-label="Aircraft schematic">
            <path
              d="M200 30 C212 60 216 100 216 140 L360 270 L360 292 L218 250 L222 320 L268 352 L268 368 L206 356 L200 372 L194 356 L132 368 L132 352 L178 320 L182 250 L40 292 L40 270 L184 140 C184 100 188 60 200 30 Z"
              fill="var(--secondary)"
              stroke="var(--primary)"
              strokeOpacity={0.5}
              strokeWidth={1.5}
            />
            <path d="M200 60 L200 350" stroke="var(--primary)" strokeOpacity={0.15} strokeDasharray="4 6" />
            {st.comps.map((c) => {
              const h = HOTSPOTS[c.key];
              const active = comp.key === c.key;
              return (
                <g
                  key={c.key}
                  role="button"
                  tabIndex={0}
                  aria-label={`${c.name}, health ${c.health.toFixed(0)}`}
                  onClick={() => setSel(c.key)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(c.key)}
                  className="cursor-pointer outline-none"
                >
                  {c.status === "critical" && <circle cx={h.x} cy={h.y} r={18} fill={statusVar[c.status]} opacity={0.35} className="pulse-critical" style={{ transformOrigin: `${h.x}px ${h.y}px` }} />}
                  <circle cx={h.x} cy={h.y} r={active ? 13 : 10} fill={statusVar[c.status]} stroke="var(--background)" strokeWidth={3} />
                  {active && <circle cx={h.x} cy={h.y} r={19} fill="none" stroke="var(--primary)" strokeWidth={1.5} />}
                  <text x={h.x + (h.x < 200 ? -24 : 24)} y={h.y + 4} textAnchor={h.x < 200 ? "end" : "start"} fontSize={11} className="fill-muted-foreground">
                    {c.name}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {st.comps.map((c) => (
              <button key={c.key} onClick={() => setSel(c.key)} className={cn("rounded-md border px-2 py-1.5 text-left text-xs transition-colors", comp.key === c.key ? "border-primary/60 bg-primary/10" : "border-border hover:border-primary/30")}>
                <span className="block text-muted-foreground">{c.name}</span>
                <span className={cn("font-mono", statusText[c.status])}>{c.health.toFixed(0)} · {fmtRul(c.rul)}</span>
              </button>
            ))}
          </div>
        </Panel>

        <motion.div key={comp.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-3">
          <Panel title={`${comp.name} · remaining useful life`} action={<StatusPill status={comp.status} />} className="h-full">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="RUL estimate" value={fmtRul(comp.rul)} tone={statusText[comp.status]} />
              <Stat label="95% band" value={`${comp.lo.toFixed(0)}–${comp.hi >= 1000 ? "1000+" : comp.hi.toFixed(0)}h`} />
              <Stat label="Health index" value={comp.health.toFixed(1)} />
              <Stat label="Predicted failure" value={comp.rul >= 1000 ? "> horizon" : failDate.toISOString().slice(0, 10)} />
            </div>
            <div className="mt-4 h-56">
              <ResponsiveContainer>
                <ComposedChart data={chartData} margin={{ left: -18, right: 8, top: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} stroke="var(--muted-foreground)" fontSize={11} unit="h" />
                  <YAxis domain={[0, 1.1]} stroke="var(--muted-foreground)" fontSize={11} />
                  <Tooltip {...tooltipStyle} />
                  <ReferenceLine y={1} stroke="var(--critical)" strokeDasharray="4 4" label={{ value: "failure threshold", fill: "var(--critical)", fontSize: 10, position: "insideTopLeft" }} />
                  {comp.rul < 1000 && <ReferenceArea x1={bandLo} x2={bandHi} fill="var(--warning)" fillOpacity={0.1} ifOverflow="extendDomain" label={{ value: "95% failure window", fill: "var(--warning)", fontSize: 10, position: "insideBottom" }} />}
                  <Line dataKey="obs" stroke="var(--chart-2)" dot={{ r: 1.5 }} strokeWidth={0} name="Observed damage" isAnimationActive={false} />
                  <Line dataKey="smooth" stroke="var(--primary)" dot={false} strokeWidth={2} name="Smoothed" isAnimationActive={false} />
                  <Line dataKey="proj" stroke="var(--warning)" strokeDasharray="5 4" dot={false} strokeWidth={2} name="Projection" connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Rec icon={Wrench} label="Recommended action" value={comp.status === "healthy" ? "Continue monitoring" : spec.action} />
              <Rec icon={Package} label="Required spare" value={`${spec.partName} (${spec.part}) · ${stock} at base`} />
              <Rec icon={Building2} label="Suggested agency" value={`${agency.name} · ${agency.turnaroundDays}d turnaround`} />
            </div>
          </Panel>
        </motion.div>
      </div>

      <Panel title="Live telemetry" action={<span className="font-mono text-xs text-muted-foreground">1 Hz · last 60 samples</span>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SENSOR_META.map((m) => {
            const v = buf[buf.length - 1]?.[m.key] ?? 0;
            const breach = m.dir === "max" ? v > m.limit : v < m.limit;
            return (
              <div key={m.key} className="rounded-lg border border-border bg-secondary/30 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">{m.label}</span>
                  <span className={cn("font-mono text-sm", breach ? "text-critical" : "text-foreground")}>
                    {v.toFixed(m.key === "vibration" ? 2 : 0)} <span className="text-[10px] text-muted-foreground">{m.unit}</span>
                  </span>
                </div>
                <div className="h-24">
                  <ResponsiveContainer>
                    <LineChart data={buf} margin={{ top: 6, bottom: 0, left: 0, right: 0 }}>
                      <YAxis hide domain={["auto", "auto"]} />
                      <ReferenceLine y={m.limit} stroke="var(--critical)" strokeDasharray="3 3" ifOverflow="extendDomain" />
                      <Line dataKey={m.key} stroke={breach ? "var(--critical)" : "var(--primary)"} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Maintenance & fault history">
        <ol className="relative space-y-4 border-l border-border pl-5">
          {st.ac.history.map((h, i) => (
            <li key={i} className="relative">
              <span className={cn("absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-background", h.kind === "fault" ? "bg-critical" : h.kind === "maintenance" ? "bg-primary" : "bg-muted-foreground")} />
              <p className="text-sm">{h.text}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="h-3 w-3" />{h.daysAgo} days ago · {h.kind}</p>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold", tone)}>{value}</p>
    </div>
  );
}
function Rec({ icon: Icon, label, value }: { icon: typeof Wrench; label: string; value: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-border p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}
