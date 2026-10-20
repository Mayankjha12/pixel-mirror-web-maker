import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Database, GitMerge, BrainCircuit, Plane, CalendarCog, RefreshCcw } from "lucide-react";
import { PageHeader, Panel } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/architecture")({
  head: () => ({
    meta: [
      { title: "Architecture — VyomDrishti AI" },
      { name: "description", content: "Pipeline from data ingestion through fusion, fault prediction, digital twin and maintenance planning, closed by a feedback loop." },
      { property: "og:title", content: "Architecture — VyomDrishti AI" },
      { property: "og:description", content: "How VyomDrishti turns sensor streams into a maintenance plan." },
    ],
  }),
  component: Architecture,
});

const STAGES = [
  { id: "ingest", title: "Data Ingestion", icon: Database, module: "engine/fleet.ts · observe()", text: "Sensor streams (EGT, vibration, oil pressure, fuel flow, bleed-air) and maintenance logs arrive per airframe. In the demo a seeded simulator stands in for flight-data recorders and MRO systems." },
  { id: "fusion", title: "Data Fusion", icon: GitMerge, module: "engine/core.ts · estimateRul() smoothing", text: "Raw signals are fused into a per-component health index, then cleaned with gap-aware exponential smoothing and an innovation gate that rejects transient spikes and tolerates dropped samples." },
  { id: "predict", title: "Fault Prediction", icon: BrainCircuit, module: "engine/core.ts · log-linear trend + band", text: "A degradation trend is fitted and extrapolated to the failure threshold, giving RUL in flight hours with a 95% confidence band. Watch < 150h, Critical < 50h." },
  { id: "twin", title: "Digital Twin", icon: Plane, module: "routes/aircraft.$id.tsx", text: "Each airframe's twin shows component health hotspots, live telemetry and the projected failure window, so engineers can see why a recommendation was made." },
  { id: "plan", title: "Maintenance Planning", icon: CalendarCog, module: "engine/scheduler.ts · planMaintenance()", text: "A greedy optimizer ranks tasks by urgency × availability impact and books them under spares, agency capacity and hangar-slot constraints, reporting the resulting availability against a time-based baseline." },
  { id: "loop", title: "Feedback Loop", icon: RefreshCcw, module: "engine/backtest.ts · runBacktest()", text: "Completed repairs and confirmed failures become labelled outcomes. The backtest harness re-scores the estimator on them, and thresholds/smoothing gains are re-tuned (later: retrain learned models) before the next release." },
];

function Architecture() {
  const [sel, setSel] = useState(STAGES[2].id);
  const s = STAGES.find((x) => x.id === sel)!;
  return (
    <div className="space-y-6">
      <PageHeader title="Architecture" subtitle="Click any stage to see what it does and which module implements it." />
      <Panel>
        <div className="relative grid grid-cols-2 gap-4 md:grid-cols-6">
          {STAGES.map((st, i) => (
            <motion.button
              key={st.id}
              onClick={() => setSel(st.id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              aria-pressed={sel === st.id}
              className={cn("glass lift relative z-10 flex flex-col items-center gap-2 p-4 text-center", sel === st.id && "border-primary/70 shadow-[var(--shadow-glow)]")}
            >
              <span className={cn("grid h-11 w-11 place-items-center rounded-full border", sel === st.id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground")}>
                <st.icon className="h-5 w-5" />
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">0{i + 1}</span>
              <span className="text-sm font-medium">{st.title}</span>
            </motion.button>
          ))}
        </div>
        <svg viewBox="0 0 600 70" className="mt-2 hidden w-full md:block" aria-hidden>
          <line x1="50" y1="10" x2="550" y2="10" stroke="var(--primary)" strokeWidth="2" className="flow-dash" />
          <path d="M550 10 C 580 10 580 55 550 55 L 50 55 C 20 55 20 10 50 10" fill="none" stroke="var(--warning)" strokeWidth="1.5" className="flow-dash" />
          <text x="300" y="68" textAnchor="middle" fontSize="10" className="fill-warning">feedback loop · outcomes re-score & re-tune the predictor</text>
        </svg>
      </Panel>
      <AnimatePresence mode="wait">
        <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <Panel title={s.title}>
            <p className="text-sm text-muted-foreground">{s.text}</p>
            <p className="mt-3 inline-block rounded-md border border-border bg-secondary/50 px-2 py-1 font-mono text-xs text-primary">{s.module}</p>
          </Panel>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
