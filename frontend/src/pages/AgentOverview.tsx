import React, { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import {
  Upload, FileText, Loader2, CheckCircle2, Rocket, Pause, Bot, Save,
  PhoneCall, XCircle, AlertTriangle, Database, Headphones, Trash2, RefreshCw, Search,
} from "lucide-react";
import {
  getAgent, updateAgent, listAgentDocuments, publishAgent, pauseAgent,
  saveAgentChanges, parseSaveError, getKnowledgeStatus, startTestCall, getTestCallStatus,
  deleteKnowledgeDocument, reindexKnowledgeDocument, testRetrieval,
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

  // Document management & Retrieval testing
  const [retrievalQuery, setRetrievalQuery] = useState("");
  const [retrievalResults, setRetrievalResults] = useState<any[] | null>(null);
  const [testingRetrieval, setTestingRetrieval] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  const handleDeleteDoc = async (docId: number) => {
    if (!window.confirm("Are you sure you want to delete this document from the knowledge base?")) return;
    setActionLoadingId(docId);
    try {
      await deleteKnowledgeDocument(docId);
      showToast("Document deleted successfully");
      await queryClient.invalidateQueries({ queryKey: ["agent-documents", agentId] });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-status", agentId] });
    } catch (err: any) {
      showToast(err.message || "Failed to delete document", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReindexDoc = async (docId: number) => {
    setActionLoadingId(docId);
    try {
      await reindexKnowledgeDocument(docId);
      showToast("Document re-indexing triggered");
      await queryClient.invalidateQueries({ queryKey: ["agent-documents", agentId] });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-status", agentId] });
    } catch (err: any) {
      showToast(err.message || "Failed to reindex document", "error");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleTestRetrieval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retrievalQuery.trim()) return;
    setTestingRetrieval(true);
    setRetrievalResults(null);
    try {
      const res = await testRetrieval(retrievalQuery.trim(), agentId || 1);
      setRetrievalResults(res.results || []);
    } catch (err: any) {
      showToast(err.message || "Retrieval test failed", "error");
    } finally {
      setTestingRetrieval(false);
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
    <div className="max-w-4xl mx-auto px-6 py-8 text-slate-100">
      {/* Header with knowledge stats (spec §62) */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-sky-500/20 border border-sky-400/30">
            {(agent.agent_name || "A").slice(0, 1)}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-extrabold text-white tracking-tight">{agent.agent_name}</h1>
              <StatusChip status={agent.status} />
            </div>
            <p className="text-xs text-slate-400">{agent.name} · {agent.calling_purpose}</p>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
              <span className="flex items-center gap-1 text-sky-400">
                <Database className="w-3.5 h-3.5" />
                {kStatus?.chunks ? `${kStatus.chunks.toLocaleString()} chunks` : "no chunks"}
                {kStatus?.indexed ? " · Indexed" : ""}
              </span>
              <span className="flex items-center gap-1 text-slate-400">
                <Headphones className="w-3.5 h-3.5 text-slate-400" /> Voice configured
              </span>
              <span className="text-slate-400">
                Preview: <strong className={isReady ? "text-emerald-400" : "text-amber-400"}>{isReady ? "Available" : "Locked until Save"}</strong>
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {agent.status === "published" ? (
            <button onClick={handlePause} className="flex items-center gap-1.5 text-xs font-semibold text-orange-300 bg-orange-950/80 hover:bg-orange-900 border border-orange-500/40 rounded-xl px-4 py-2 transition-all">
              <Pause className="w-4 h-4" /> Pause
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing || !isReady}
              title={isReady ? "" : "Agent must be READY first — click Save Changes"}
              className="flex items-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 shadow-lg shadow-sky-500/25 disabled:opacity-40 disabled:shadow-none text-white text-xs font-bold rounded-xl px-4 py-2.5 border border-sky-400/30 transition-all"
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Publish Agent
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div className={`mb-5 text-xs rounded-xl px-4 py-3 border ${
          toastKind === "error"
            ? "text-red-200 bg-red-950/80 border-red-500/50"
            : "text-sky-200 bg-sky-950/80 border-sky-500/50"
        }`}>{toast}</div>
      )}

      {/* Save validation failures */}
      {saveErrors.length > 0 && (
        <div className="mb-5 bg-amber-950/80 border border-amber-500/50 rounded-2xl px-4 py-3.5">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-300 mb-1.5">
            <AlertTriangle className="w-4 h-4" /> Cannot mark agent READY — fix these:
          </div>
          <ul className="space-y-1">
            {saveErrors.map((e, i) => (
              <li key={i} className="text-xs text-amber-200 flex items-start gap-1.5">
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" /> {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* REAL training pipeline */}
      <TrainingPanel agentId={agentId!} onReady={() => queryClient.invalidateQueries({ queryKey: ["agent", agentId] })} />

      {/* Knowledge documents list */}
      <section className="glass-strong rounded-3xl p-6 shadow-2xl border border-slate-800 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-sky-400" /> Knowledge Base Documents
          </h2>
          {kStatus?.indexed && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/15 border border-emerald-400/30 px-3 py-1 rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" /> Indexed in FAISS
            </span>
          )}
        </div>

        {kStatus?.status === "error" && kStatus.error && (
          <div className="mt-3 flex items-start gap-2 text-xs text-red-200 bg-red-950/80 border border-red-500/50 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
            <span><strong>Ingestion failed:</strong> {kStatus.error}</span>
          </div>
        )}

        {documents && documents.length > 0 ? (
          <div className="mt-4 space-y-2.5">
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-xs bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3 shadow-inner">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-sky-400" />
                  </div>
                  <span className="truncate text-white font-medium">{d.name}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-400 shrink-0">
                  <span>{d.size_kb} KB</span>
                  <span className="text-sky-400 font-mono">{d.chunks} chunks</span>
                  <span className="capitalize font-semibold text-emerald-400 bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-0.5 rounded-full">{d.status}</span>
                  <button
                    onClick={() => handleReindexDoc(d.id)}
                    disabled={actionLoadingId === d.id}
                    title="Re-index document into vector store"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
                  >
                    {actionLoadingId === d.id ? <Loader2 className="w-4 h-4 animate-spin text-sky-400" /> : <RefreshCw className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDeleteDoc(d.id)}
                    disabled={actionLoadingId === d.id}
                    title="Delete document"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 mt-2 italic">No documents indexed yet.</p>
        )}

        {/* Live Retrieval Tester */}
        <div className="mt-6 pt-5 border-t border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-sky-400" /> Test Knowledge Retrieval
            </span>
            <span className="text-[11px] text-slate-400">Test what chunks will be retrieved for a student's query</span>
          </div>
          <form onSubmit={handleTestRetrieval} className="flex gap-2">
            <input
              type="text"
              value={retrievalQuery}
              onChange={(e) => setRetrievalQuery(e.target.value)}
              placeholder="e.g., What is the fee for MPC? Or: What courses are offered?"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-sky-400"
            />
            <button
              type="submit"
              disabled={testingRetrieval || !retrievalQuery.trim()}
              className="flex items-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl px-4 py-2 transition-all shadow-md shadow-sky-500/20 border border-sky-400/30"
            >
              {testingRetrieval ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              <span>Test Query</span>
            </button>
          </form>

          {retrievalResults !== null && (
            <div className="mt-4 space-y-2.5">
              <div className="text-xs font-semibold text-slate-300">
                Found {retrievalResults.length} relevant chunks:
              </div>
              {retrievalResults.length === 0 ? (
                <div className="text-xs text-slate-400 italic bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                  No matching chunks retrieved for this query.
                </div>
              ) : (
                retrievalResults.map((r, i) => (
                  <div key={i} className="text-xs bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 space-y-1.5 shadow-sm">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                      <span className="text-slate-300">📖 {r.document_name || "Document"} {r.page ? `· Page ${r.page}` : ""} {r.section ? `· ${r.section}` : ""}</span>
                      <span className="bg-sky-500/15 border border-sky-400/30 text-sky-300 px-2 py-0.5 rounded-full font-mono font-bold">Score: {typeof r.score === 'number' ? r.score.toFixed(3) : r.score}</span>
                    </div>
                    <p className="text-slate-300 leading-relaxed line-clamp-3">{r.text || r.content}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>

      {/* Test Call — REAL phone call */}
      <section className="glass-strong rounded-3xl p-6 shadow-2xl border border-slate-800 mb-6">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-1">
          <PhoneCall className="w-4 h-4 text-sky-400" /> Real Phone Test Call
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          Enter your phone number to receive a live telecall from Mrs. D. Requires telephony credentials.
        </p>
        {isReady ? (
          <form onSubmit={handleTestCall} className="flex flex-col gap-3">
            <div className="flex gap-2.5">
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs font-mono focus:outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                disabled={testCalling || !testPhone.trim()}
                className="flex items-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 shadow-lg shadow-sky-500/25 disabled:opacity-50 disabled:shadow-none text-white text-xs font-bold rounded-xl px-5 py-2.5 border border-sky-400/30"
              >
                {testCalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
                <span>Call Phone</span>
              </button>
            </div>
            {testError && (
              <div className="text-[12.5px] text-red-700 bg-red-50/70 border border-red-200 rounded-xl px-3.5 py-2.5">{testError}</div>
            )}
            {testCallId && liveStatus && (
              <div className="bg-white/70 backdrop-blur-md border hairline rounded-xl px-4 py-3">
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
          <div className="text-xs text-amber-300 bg-amber-950/80 border border-amber-500/40 rounded-xl px-4 py-3">
            Agent must be READY (or PUBLISHED) before test calls. Click <strong>Save Changes</strong> after the knowledge index finishes.
          </div>
        )}
      </section>

      {/* Agent settings */}
      <section className="glass-strong rounded-3xl p-6 shadow-2xl border border-slate-800 mb-6">
        <h2 className="text-base font-bold text-white flex items-center gap-2 mb-4">
          <Bot className="w-4 h-4 text-sky-400" /> Telecaller Configuration & Behavior
        </h2>
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <LabeledInput label="Agent Name" value={form.agent_name ?? ""} onChange={(v) => setForm({ ...form, agent_name: v })} />
          <LabeledInput label="Company / Institution" value={form.company_name ?? ""} onChange={(v) => setForm({ ...form, company_name: v })} />
        </div>
        <LabeledTextarea label="Greeting Message" rows={2} value={form.greeting_message ?? ""} onChange={(v) => setForm({ ...form, greeting_message: v })} />
        <div className="mt-4">
          <LabeledTextarea label="Special Admission Instructions" rows={3} value={form.instructions ?? ""} onChange={(v) => setForm({ ...form, instructions: v })} />
        </div>
        <div className="flex justify-end mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 shadow-xl shadow-sky-500/25 text-white text-xs font-bold rounded-xl px-5 py-2.5 border border-sky-400/30 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save Changes</span>
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-3">
          Save runs full validation: name, knowledge ingestion, vector index, voice config. Agent becomes READY only when everything passes.
        </p>
      </section>

      {/* Preview gate */}
      {isReady ? (
        <Link
          to={`/agent/${agentId}/test`}
          className="mt-5 flex items-center justify-center gap-2 w-full p-4 text-xs font-bold text-sky-300 bg-sky-950/60 hover:bg-sky-900/60 border border-sky-500/40 rounded-2xl transition-all shadow-lg"
        >
          <Headphones className="w-4 h-4 text-sky-400" />
          <span>Open Live Telecaller Console — Speak with Mrs. D</span>
        </Link>
      ) : (
        <div className="mt-5 flex items-center justify-center gap-2 w-full p-4 text-xs text-slate-500 bg-slate-900/60 border border-slate-800 rounded-2xl">
          <Headphones className="w-4 h-4" />
          <span>Preview unlocks after Save Changes marks the agent READY</span>
        </div>
      )}
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-300 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-sky-400"
      />
    </div>
  );
}

function LabeledTextarea({ label, rows, value, onChange }: { label: string; rows: number; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-300 mb-1.5">{label}</label>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-sky-400 resize-none leading-relaxed"
      />
    </div>
  );
}
