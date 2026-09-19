import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge, Timer } from "lucide-react";
import { getLatencyDashboard } from "../services/api";

/**
 * Internal developer performance view (spec §60 + latency spec §LATENCY
 * DASHBOARD). Shows ONLY real measured values from the TurnLatency table:
 * avg / median / P90 / P95 / max first-audio latency, the % of turns that
 * met the 700ms target, and the per-stage breakdown.
 */
export default function LatencyPanel({ agentId }: { agentId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["latency-dashboard", agentId],
    queryFn: () => getLatencyDashboard(agentId),
    enabled: !!agentId,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return <div className="skeleton h-32 rounded-[var(--radius-md)]" />;
  }
  if (!data || !data.has_data) {
    return (
      <div className="glass rounded-[var(--radius-md)] p-5">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--gray-700)] mb-1.5">
          <Gauge className="w-4 h-4 text-[var(--sky-600)]" /> Voice Latency (internal)
        </div>
        <p className="text-[12.5px] text-[var(--gray-500)]">
          {data?.message ?? "No measured turns yet."}
        </p>
      </div>
    );
  }

  const pass = (data.pass_rate_percent ?? 0) >= 90;
  const stage = data.stages ?? {};

  return (
    <div className="glass rounded-[var(--radius-md)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--gray-800)]">
          <Gauge className="w-4 h-4 text-[var(--sky-600)]" /> Voice Latency — time to first audio
        </div>
        <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full border bg-[var(--gray-50)] text-[var(--gray-600)] border-[var(--gray-200)]">
          target ≤ {data.target_ms}ms
        </span>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5 mb-4">
        <Metric label="Avg" value={data.avg_ms} />
        <Metric label="Median" value={data.median_ms} />
        <Metric label="P90" value={data.p90_ms} />
        <Metric label="P95" value={data.p95_ms} />
        <Metric label="Max" value={data.max_ms} />
        <div className={`rounded-lg px-3 py-2.5 text-center border ${pass ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
          <div className={`text-[15px] font-bold ${pass ? "text-emerald-700" : "text-amber-700"}`}>{data.pass_rate_percent}%</div>
          <div className="text-[10.5px] text-[var(--gray-500)]">turns ≤{data.target_ms}ms</div>
        </div>
      </div>

      {/* Per-stage breakdown — measured, not assumed */}
      <div className="flex items-center gap-2 text-[11.5px] text-[var(--gray-500)] mb-1.5">
        <Timer className="w-3.5 h-3.5" /> Stage breakdown (measured averages):
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Metric label="STT" value={stage.stt_ms ?? undefined} suffix="ms" />
        <Metric label="Retrieval" value={stage.retrieval_ms ?? undefined} suffix="ms" />
        <Metric label="LLM first token" value={stage.llm_first_token_ms ?? undefined} suffix="ms" />
        <Metric label="TTS first audio" value={stage.tts_first_audio_ms ?? undefined} suffix="ms" />
      </div>
      <p className="text-[11px] text-[var(--gray-400)] mt-3">
        {data.sample_count} measured turns · {data.pass_count} passed / {data.fail_count} exceeded target
      </p>
    </div>
  );
}

function Metric({ label, value, suffix = "ms" }: { label: string; value?: number; suffix?: string }) {
  return (
    <div className="bg-white border border-[var(--gray-100)] rounded-lg px-3 py-2.5 text-center">
      <div className="text-[15px] font-bold text-[var(--gray-800)]">{value != null ? `${value}${suffix}` : "—"}</div>
      <div className="text-[10.5px] text-[var(--gray-500)]">{label}</div>
    </div>
  );
}
