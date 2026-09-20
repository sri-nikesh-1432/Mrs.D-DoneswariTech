import React, { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Play, Pause, Zap, Loader2, PhoneCall, CheckCircle2, Clock, XCircle } from "lucide-react";
import { getCampaignStatus, startCampaign, pauseCampaign, simulateCall } from "../services/api";
import { StatusPill } from "./Students";

const POLL_MS = 2000;

export default function Campaign() {
  const { agentId } = useParams<{ agentId: string }>();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["campaign-status", agentId],
    queryFn: () => getCampaignStatus(agentId!),
    enabled: !!agentId,
    refetchInterval: POLL_MS,
  });

  // Pause polling refresh while page hidden
  useEffect(() => {
    // react-query handles refetchIntervalInBackground=false by default
  }, []);

  const handleStart = async () => {
    if (!agentId) return;
    try {
      await startCampaign(agentId);
      await queryClient.invalidateQueries({ queryKey: ["campaign-status", agentId] });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(detail || "Failed to start campaign");
    }
  };

  const handlePause = async () => {
    if (!agentId) return;
    await pauseCampaign(agentId);
    await queryClient.invalidateQueries({ queryKey: ["campaign-status", agentId] });
  };

  const handleSimulate = async () => {
    if (!agentId) return;
    try {
      // Labelled DRY-RUN (spec §55): the agent's REAL runtime (real RAG + real
      // LLM + real transcript) with an LLM role-playing the student. Never
      // presented as a real phone call.
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/agents/${agentId}/students?call_status=Pending&limit=1`);
      const json = await res.json();
      const first: { id: number; name: string } | undefined = json.students?.[0];
      if (!first) {
        alert("No pending students for a dry-run.");
        return;
      }
      const sim = await simulateCall(agentId, first.id);
      alert(`${sim.message} — Interest: ${sim.interest_level}`);
      await queryClient.invalidateQueries({ queryKey: ["campaign-status", agentId] });
      await queryClient.invalidateQueries({ queryKey: ["students", agentId] });
    } catch (err) {
      alert("Dry-run failed");
    }
  };

  if (isLoading || !status) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <div className="skeleton h-10 w-1/3" />
        <div className="skeleton h-48 rounded-[var(--radius-md)]" />
      </div>
    );
  }

  const running = status.is_running;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--gray-800)]">Calling Campaign</h1>
          <p className="text-sm text-[var(--gray-500)] mt-0.5">
            {status.agent_name} · {running ? "Queue is live" : "Queue is idle"}
          </p>
        </div>
        <div className="flex gap-2">
          {running ? (
            <button onClick={handlePause} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg px-4 py-2.5">
              <Pause className="w-4 h-4" /> Pause Calling
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg px-4 py-2.5"
            >
              <Play className="w-4 h-4" /> Start Calling
            </button>
          )}
          <button
            onClick={handleSimulate}
            title="Labelled dry-run: the agent's real RAG+LLM runtime with an LLM role-playing the student (no phone call)"
            className="flex items-center gap-2 bg-white hover:bg-[var(--gray-50)] text-[var(--gray-700)] border border-[var(--gray-200)] text-sm font-semibold rounded-lg px-4 py-2.5"
          >
            <Zap className="w-4 h-4" /> Dry-Run (Demo)
          </button>
        </div>
      </div>

      {status.agent_status !== "published" && status.agent_status !== "ready" && (
        <div className="mb-5 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          Agent must be <strong>published</strong> before starting real calls. Current status: <strong>{status.agent_status}</strong> — publish from the Overview page.
        </div>
      )}

      {/* Ready to call overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
        <BigStat icon={PhoneCall} label="Ready to Call" value={status.ready_to_call} accent="text-[var(--sky-600)] bg-[var(--sky-50)]" />
        <BigStat icon={Loader2} label="In Progress" value={status.in_progress} accent="text-indigo-600 bg-indigo-50" />
        <BigStat icon={CheckCircle2} label="Completed" value={status.completed} accent="text-emerald-600 bg-emerald-50" />
        <BigStat icon={XCircle} label="Failed / No Answer" value={status.failed} accent="text-red-600 bg-red-50" />
      </div>

      {/* Progress bar */}
      <div className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-semibold text-[var(--gray-700)]">Queue Progress</span>
          <span className="text-[13px] font-bold text-[var(--sky-700)]">{status.progress_percent}%</span>
        </div>
        <div className="h-3 bg-[var(--gray-100)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[var(--sky-400)] to-[var(--sky-600)] rounded-full transition-all duration-500"
            style={{ width: `${status.progress_percent}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-[11.5px] text-[var(--gray-500)]">
          <span>{status.completed} of {status.total_students} processed</span>
          <span>{status.ready_to_call} remaining</span>
        </div>
      </div>

      {/* Interest breakdown */}
      <div className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-[15px] font-semibold text-[var(--gray-800)] mb-4">Results So Far</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <MiniStat label="Interested" value={status.interested} cls="bg-emerald-50 text-emerald-700 border border-emerald-200" />
          <MiniStat label="Not Interested" value={status.not_interested} cls="bg-red-50 text-red-700 border border-red-200" />
          <MiniStat label="Needs Follow-up" value={status.follow_up_required} cls="bg-blue-50 text-blue-700 border border-blue-200" />
          <MiniStat label="Callbacks" value={status.callback_requested} cls="bg-violet-50 text-violet-700 border border-violet-200" />
        </div>
      </div>

      <p className="text-center text-[12px] text-[var(--gray-400)] mt-6 flex items-center justify-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> Live updates every {POLL_MS / 1000}s
      </p>
    </div>
  );
}

function BigStat({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; accent: string }) {
  return (
    <div className="glass rounded-[var(--radius-md)] p-4 shadow-[var(--shadow-sm)]">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2.5 ${accent}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-2xl font-bold text-[var(--gray-800)]">{value}</div>
      <div className="text-[11.5px] text-[var(--gray-500)] mt-0.5">{label}</div>
    </div>
  );
}

function MiniStat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-lg px-4 py-3 text-center ${cls}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11.5px] mt-0.5">{label}</div>
    </div>
  );
}
