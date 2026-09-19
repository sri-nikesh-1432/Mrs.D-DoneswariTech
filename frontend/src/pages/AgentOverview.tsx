import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import {
  Upload, FileText, Loader2, CheckCircle2, Rocket, Pause, Bot, Save,
  PhoneCall, XCircle, AlertTriangle, Database, Headphones,
} from "lucide-react";
import {
  getAgent, updateAgent, listAgentDocuments, publishAgent, pauseAgent,
  saveAgentChanges, parseSaveError, getKnowledgeStatus, startTestCall, getTestCallStatus,
} from "../services/api";
import type { TestCallStatus } from "../services/api";
import TrainingPanel from "../components/TrainingPanel";
import { StatusChip } from "./Dashboard";

const ALLOWED = ".pdf,.docx,.txt,.csv,.xlsx,.xls";

// Ingestion pipeline stages displayed to the user (spec §4)
const STAGES = ["extracting", "chunking", "embedding", "indexing", "ready"];

export default function AgentOverview() {
  const { agentId } = useParams<{ agentId: string }>();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: agent, isLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => getAgent(agentId!),
    enabled: !!agentId,
  });

  const { data: documents } = useQuery({
    queryKey: ["agent-documents", agentId],
    queryFn: () => listAgentDocuments(agentId!),
    enabled: !!agentId,
  });

  // Real ingestion status — polled while processing (spec §4 §53)
  const isProcessing = agent?.status === "processing";
  const { data: kStatus } = useQuery({
    queryKey: ["knowledge-status", agentId],
    queryFn: () => getKnowledgeStatus(agentId!),
    enabled: !!agentId,
    refetchInterval: isProcessing ? 1500 : false,
  });

  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState("");
  const [toastKind, setToastKind] = useState<"info" | "error">("info");
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [form, setForm] = useState<{ agent_name?: string; company_name?: string; greeting_message?: string; instructions?: string } | null>(null);

  // Test call state (spec §33)
  const [showTestCall, setShowTestCall] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testCalling, setTestCalling] = useState(false);
  const [testCallId, setTestCallId] = useState<string | null>(null);
  const [testError, setTestError] = useState("");

  // Live poll of REAL provider status while a test call is active
  const { data: liveStatus } = useQuery({
    queryKey: ["test-call-status", agentId, testCallId],
    queryFn: () => getTestCallStatus(agentId!, testCallId!),
    enabled: !!testCallId && !!agentId,
    refetchInterval: 2000,
  });

  React.useEffect(() => {
    if (agent && !form) {
      setForm({
        agent_name: agent.agent_name ?? "",
        company_name: agent.name ?? "",
        greeting_message: agent.greeting_message ?? "",
        instructions: agent.instructions ?? "",
      });
    }
  }, [agent, form]);

  // Stop polling when the call reaches a terminal state
  React.useEffect(() => {
    const s = liveStatus?.call_status;
    if (s && ["Completed", "No Answer", "Busy", "Failed", "Cancelled"].includes(s)) {
      setTimeout(() => setTestCallId(null), 2500);
    }
  }, [liveStatus?.call_status]);

  const showToast = (msg: string, kind: "info" | "error" = "info") => {
    setToast(msg);
    setToastKind(kind);
    setTimeout(() => setToast(""), 5000);
  };

  // SAVE CHANGES = the validation gate (spec §15). Backend returns the exact
  // list of failed checks; the agent becomes READY only when all pass.
  const handleSave = async () => {
    if (!agentId || !form) return;
    setSaving(true);
    setSaveErrors([]);
    try {
      // 1. Persist configuration fields.
      await updateAgent(agentId, {
        agent_name: form.agent_name,
        company_name: form.company_name,
        greeting_message: form.greeting_message,
        instructions: form.instructions,
      });
      // 2. Run the readiness validation gate.
      const res = await saveAgentChanges(agentId);
      showToast(res.message);
      await queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
    } catch (err: unknown) {
      const parsed = parseSaveError(err);
      setSaveErrors(parsed.errors);
      showToast(parsed.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!agentId) return;
    setPublishing(true);
    try {
      const res = await publishAgent(agentId);
      showToast(res.message);
      await queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast(detail || "Publish failed", "error");
    } finally {
      setPublishing(false);
    }
  };

  const handlePause = async () => {
    if (!agentId) return;
    const res = await pauseAgent(agentId);
    showToast(res.message);
    await queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
  };

  const handleTestCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId || !testPhone.trim()) return;
    setTestCalling(true);
    setTestError("");
    try {
      const res = await startTestCall(agentId, testPhone.trim());
      setTestCallId(res.call_id);
      showToast(res.message);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setTestError(typeof detail === "string" ? detail : "Test call failed");
    } finally {
      setTestCalling(false);
    }
  };

  if (isLoading || !agent || !form) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <div className="skeleton h-10 w-1/3" />
        <div className="skeleton h-40 rounded-[var(--radius-md)]" />
      </div>
    );
  }

  const isReady = agent.status === "ready" || agent.status === "published";
  const stageIdx = kStatus ? STAGES.indexOf(kStatus.stage) : -1;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header with knowledge stats (spec §62) */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] flex items-center justify-center text-white font-bold text-lg">
            {(agent.agent_name || "A").slice(0, 1)}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-[var(--gray-800)]">{agent.agent_name}</h1>
              <StatusChip status={agent.status} />
            </div>
            <p className="text-sm text-[var(--gray-500)]">{agent.name} · {agent.calling_purpose}</p>
            <div className="flex items-center gap-3 mt-1 text-[11.5px] text-[var(--gray-500)]">
              <span className="flex items-center gap-1">
                <Database className="w-3 h-3" />
                {kStatus?.chunks ? `${kStatus.chunks.toLocaleString()} chunks` : "no chunks"}
                {kStatus?.indexed ? " · Indexed" : ""}
              </span>
              <span className="flex items-center gap-1">
                <Headphones className="w-3 h-3" /> Voice configured
              </span>
              <span>
                Preview: {isReady ? "Available" : "Locked until Save"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {agent.status === "published" ? (
            <button onClick={handlePause} className="flex items-center gap-1.5 text-sm font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg px-3.5 py-2">
              <Pause className="w-4 h-4" /> Pause
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing || !isReady}
              title={isReady ? "" : "Agent must be READY first — click Save Changes"}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2"
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Publish Agent
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className={`mb-5 text-sm rounded-lg px-4 py-2.5 border ${
          toastKind === "error"
            ? "text-red-800 bg-red-50 border-red-200"
            : "text-[var(--sky-800)] bg-[var(--sky-50)] border-[var(--sky-200)]"
        }`}>{toast}</div>
      )}

      {/* Save validation failures — the exact checks that failed (spec §15 §54) */}
      {saveErrors.length > 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800 mb-1.5">
            <AlertTriangle className="w-4 h-4" /> Cannot mark agent READY — fix these:
          </div>
          <ul className="space-y-1">
            {saveErrors.map((e, i) => (
              <li key={i} className="text-[12.5px] text-amber-700 flex items-start gap-1.5">
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* REAL training pipeline (spec §9 §10) — replaces the inline upload box */}
      <TrainingPanel agentId={agentId!} onReady={() => queryClient.invalidateQueries({ queryKey: ["agent", agentId] })} />

      {/* Knowledge documents list */}
      <section className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-[var(--gray-800)] flex items-center gap-2">
            <FileText className="w-4 h-4 text-[var(--sky-600)]" /> Knowledge Base
          </h2>
          {kStatus?.indexed && (
            <span className="flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> Indexed
            </span>
          )}
        </div>

        {/* Upload failure reason is shown inside TrainingPanel; list lives below */}

        {/* Real failure reason (spec §54) */}
        {kStatus?.status === "error" && kStatus.error && (
          <div className="mt-3 flex items-start gap-2 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span><strong>Ingestion failed:</strong> {kStatus.error}</span>
          </div>
        )}

        {documents && documents.length > 0 && (
          <div className="mt-4 space-y-2">
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-[13px] bg-white border border-[var(--gray-100)] rounded-lg px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-[var(--gray-400)] shrink-0" />
                  <span className="truncate text-[var(--gray-700)]">{d.name}</span>
                </div>
                <div className="flex items-center gap-3 text-[11.5px] text-[var(--gray-500)] shrink-0">
                  <span>{d.size_kb} KB</span>
                  <span>{d.chunks} chunks</span>
                  <span className="capitalize font-medium text-[var(--sky-700)]">{d.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Test Call — REAL phone call (spec §33) */}
      <section className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] mb-5">
        <h2 className="text-[15px] font-semibold text-[var(--gray-800)] flex items-center gap-2 mb-1">
          <PhoneCall className="w-4 h-4 text-[var(--sky-600)]" /> Test Call
        </h2>
        <p className="text-[12.5px] text-[var(--gray-500)] mb-4">
          Enter your real phone number — the agent will actually call you. Requires telephony credentials on the server.
        </p>
        {isReady ? (
          <form onSubmit={handleTestCall} className="flex flex-col gap-3">
            <div className="flex gap-2.5">
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="flex-1 bg-white border border-[var(--gray-200)] rounded-lg px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
              />
              <button
                type="submit"
                disabled={testCalling || !testPhone.trim()}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-5 py-2.5"
              >
                {testCalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
                Test Call
              </button>
            </div>
            {testError && (
              <div className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">{testError}</div>
            )}
            {testCallId && liveStatus && (
              <div className="bg-white border border-[var(--gray-100)] rounded-lg px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold text-[var(--gray-500)] uppercase tracking-wide">Live Provider Status</span>
                  <span className={`text-[12px] font-bold px-2.5 py-0.5 rounded-full ${
                    ["Completed"].includes(liveStatus.call_status) ? "bg-emerald-50 text-emerald-700"
                    : ["No Answer", "Busy", "Failed", "Cancelled"].includes(liveStatus.call_status) ? "bg-red-50 text-red-700"
                    : "bg-[var(--sky-50)] text-[var(--sky-700)] animate-pulse"
                  }`}>{liveStatus.provider_status || liveStatus.call_status}</span>
                </div>
                {liveStatus.events.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {liveStatus.events.map((ev, i) => (
                      <span key={i} className="text-[10.5px] bg-[var(--gray-50)] text-[var(--gray-600)] px-2 py-0.5 rounded-full">
                        {ev.event_type}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11.5px] text-[var(--gray-400)] mt-2">
                  Status comes from REAL provider events — not simulated (spec §34 §63).
                </p>
              </div>
            )}
          </form>
        ) : (
          <div className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
            Agent must be READY (or PUBLISHED) before test calls. Click <strong>Save Changes</strong> after the knowledge index finishes.
          </div>
        )}
      </section>

      {/* Agent settings */}
      <section className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)]">
        <h2 className="text-[15px] font-semibold text-[var(--gray-800)] flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-[var(--sky-600)]" /> Agent Configuration
        </h2>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <LabeledInput label="Agent Name" value={form.agent_name ?? ""} onChange={(v) => setForm({ ...form, agent_name: v })} />
          <LabeledInput label="Company / Institution" value={form.company_name ?? ""} onChange={(v) => setForm({ ...form, company_name: v })} />
        </div>
        <LabeledTextarea label="Greeting Message" rows={2} value={form.greeting_message ?? ""} onChange={(v) => setForm({ ...form, greeting_message: v })} />
        <div className="mt-4">
          <LabeledTextarea label="Special Instructions" rows={3} value={form.instructions ?? ""} onChange={(v) => setForm({ ...form, instructions: v })} />
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
          </button>
        </div>
        <p className="text-[11.5px] text-[var(--gray-400)] mt-3">
          Save runs full validation: name, knowledge ingestion, vector index, voice config. Agent becomes READY only when everything passes.
        </p>
      </section>

      {/* Preview gate — only when READY (spec §15 §16 §29) */}
      {isReady ? (
        <Link
          to={`/agent/${agentId}/test`}
          className="mt-5 flex items-center justify-center gap-2 w-full glass rounded-[var(--radius-md)] p-4 text-sm font-semibold text-[var(--sky-700)] hover:bg-[var(--sky-50)] transition-colors"
        >
          <Headphones className="w-4 h-4" /> Open Voice Preview — talks to the real agent runtime
        </Link>
      ) : (
        <div className="mt-5 flex items-center justify-center gap-2 w-full glass rounded-[var(--radius-md)] p-4 text-[12.5px] text-[var(--gray-400)]">
          <Headphones className="w-4 h-4" /> Preview unlocks after Save Changes marks the agent READY (spec §15)
        </div>
      )}
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
      />
    </div>
  );
}

function LabeledTextarea({ label, rows, value, onChange }: { label: string; rows: number; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{label}</label>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)] resize-none"
      />
    </div>
  );
}
