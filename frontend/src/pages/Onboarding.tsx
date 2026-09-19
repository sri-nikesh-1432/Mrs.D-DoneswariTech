import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, Check, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createAgent, uploadAgentDocument, getKnowledgeStatus, validateKnowledge } from "../services/api";

/**
 * ONBOARDING (spec §4 §8-§11): Welcome → Agent identity → Knowledge upload →
 * REAL training → done. All progress comes from the backend's actual
 * ingestion status — no fake timers or animated placeholders.
 */

const STEPS = ["Welcome", "Agent identity", "Knowledge", "Training"] as const;

const STAGE_ORDER = ["extracting", "chunking", "embedding", "indexing"] as const;

const STAGE_LABEL: Record<string, string> = {
  extracting: "Extracting content…",
  chunking: "Creating knowledge chunks…",
  embedding: "Generating embeddings…",
  indexing: "Building knowledge index…",
};

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const [agentName, setAgentName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [purpose, setPurpose] = useState("Admissions and Student Enquiry");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const [creating, setCreating] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [stage, setStage] = useState<string>("");
  const [chunks, setChunks] = useState(0);
  const [validated, setValidated] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const finish = useCallback((_agentId: string) => {
    navigate(`/agent/${_agentId}/overview`);
  }, [navigate]);

  const startTraining = async () => {
    if (!agentId || !file) return;
    setStep(3);
    setError("");
    try {
      await uploadAgentDocument(agentId, file, setUploadPct);
      // Poll REAL ingestion status (spec §11)
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const s = await getKnowledgeStatus(agentId);
          setStage(s.stage);
          setChunks(s.chunks);
          if (s.status === "error") {
            stopPolling();
            setError(s.error || "Knowledge processing failed");
            return;
          }
          if (s.status === "ready" && s.indexed) {
            stopPolling();
            await validateKnowledge(agentId); // real retrieval smoke test (spec §48)
            setValidated(true);
            finish(agentId);
          }
        } catch {
          /* transient — keep polling */
        }
      }, 1200);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Upload failed");
    }
  };

  const handleCreateAgent = async () => {
    if (!agentName.trim()) { setError("Please name your agent."); return; }
    if (!companyName.trim()) { setError("Please enter your organization name."); return; }
    setError("");
    setCreating(true);
    try {
      const agent = await createAgent({
        name: agentName.trim(),
        company_name: companyName.trim(),
        calling_purpose: purpose.trim() || undefined,
      });
      setAgentId(String(agent.id));
      setCreating(false);
      if (file) {
        await startTrainingWithAgent(String(agent.id));
      } else {
        finish(String(agent.id));
      }
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Failed to create agent");
      setCreating(false);
    }
  };

  const startTrainingWithAgent = async (id: string) => {
    setStep(3);
    try {
      if (!file) return;
      await uploadAgentDocument(id, file, setUploadPct);
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const s = await getKnowledgeStatus(id);
          setStage(s.stage);
          setChunks(s.chunks);
          if (s.status === "error") {
            stopPolling();
            setError(s.error || "Knowledge processing failed");
            return;
          }
          if (s.status === "ready" && s.indexed) {
            stopPolling();
            await validateKnowledge(id);
            setValidated(true);
            finish(id);
          }
        } catch {
          /* keep polling */
        }
      }, 1200);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Upload failed");
    }
  };

  const handleFile = (f: File) => {
    const ok = /\.(pdf|docx|txt|csv|xlsx|xls)$/i.test(f.name);
    if (!ok) { setError("Please upload a PDF, DOCX, TXT, CSV, or XLSX file."); return; }
    if (f.size > 50 * 1024 * 1024) { setError("File must be under 50 MB."); return; }
    setFile(f);
    setError("");
  };

  const busy = step === 3;

  return (
    <div className="min-h-screen bg-sky-gradient flex items-center justify-center px-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          {/* Progress header */}
          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-13 h-13 rounded-2xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] text-white font-bold text-xl mb-4 shadow-[var(--shadow-md)]" style={{ width: 52, height: 52 }}>
              D
            </div>
            <div className="flex items-center justify-center gap-1.5 mb-3">
              {STEPS.map((s, i) => (
                <React.Fragment key={s}>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${i < step ? "bg-emerald-50 text-emerald-700" : i === step ? "bg-[var(--sky-50)] text-[var(--sky-700)]" : "bg-[var(--gray-50)] text-[var(--gray-400)]"}`}>{s}</span>
                  {i < STEPS.length - 1 && <span className="text-[var(--gray-300)] text-[10px]">→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="glass rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] p-7">
            {/* Step 0: Welcome */}
            {step === 0 && (
              <>
                <h1 className="text-xl font-bold text-[var(--gray-800)]">Welcome to Doneswari AI Telecaller</h1>
                <p className="text-[13.5px] text-[var(--gray-500)] mt-2 leading-relaxed">
                  You're about to create an AI calling agent trained on your own knowledge.
                  It can handle admissions, follow-ups, and support calls — with grounded answers
                  and real analytics.
                </p>
                <ul className="mt-4 space-y-2">
                  {["Upload your documents — they become the agent's knowledge",
                    "Preview and test with your voice before going live",
                    "Add students and start real calling campaigns"].map((t) => (
                    <li key={t} className="flex items-start gap-2 text-[13px] text-[var(--gray-600)]">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> {t}
                    </li>
                  ))}
                </ul>
                <button onClick={() => setStep(1)} className="mt-6 w-full flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white font-semibold text-sm rounded-lg py-2.5">
                  Get Started <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Step 1: Agent identity (spec §7) */}
            {step === 1 && (
              <>
                <h1 className="text-xl font-bold text-[var(--gray-800)]">Create your first agent</h1>
                <p className="text-[13px] text-[var(--gray-500)] mt-1.5 mb-5">It starts as a DRAFT — you'll add knowledge next.</p>
                <div className="space-y-4">
                  <In label="Agent Name" placeholder='e.g. "Aira"' value={agentName} onChange={setAgentName} />
                  <In label="Organization / Institution" placeholder="e.g. Doneswari Technologies" value={companyName} onChange={setCompanyName} />
                  <In label="Calling Purpose" placeholder="Admissions and Student Enquiry" value={purpose} onChange={setPurpose} />
                </div>
                {error && <div className="mt-4 text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
                <div className="flex gap-2.5 mt-6">
                  <button onClick={() => setStep(0)} className="flex-1 text-sm font-medium text-[var(--gray-600)] bg-[var(--gray-50)] border border-[var(--gray-200)] rounded-lg py-2.5">Back</button>
                  <button onClick={() => setStep(2)} disabled={!agentName.trim() || !companyName.trim()} className="flex-1 flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] disabled:opacity-50 text-white font-semibold text-sm rounded-lg py-2.5">
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Knowledge upload (spec §8) */}
            {step === 2 && (
              <>
                <h1 className="text-xl font-bold text-[var(--gray-800)]">Upload knowledge</h1>
                <p className="text-[13px] text-[var(--gray-500)] mt-1.5 mb-5">
                  PDF, DOCX, TXT, CSV, or XLSX. You can also skip and add it later from the agent page.
                </p>
                <div
                  onClick={() => !file && fileInputRef.current?.click()}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  className={`rounded-2xl border-2 border-dashed transition-all cursor-pointer ${dragging ? "border-sky-400 bg-sky-50" : file ? "border-sky-300 bg-sky-50/50" : "border-[var(--gray-300)] hover:border-[var(--sky-400)] bg-white/50"}`}
                  style={{ minHeight: 110 }}
                >
                  {file ? (
                    <div className="p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                        <FileText size={18} className="text-sky-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--gray-700)] truncate">{file.name}</p>
                        <p className="text-xs text-[var(--gray-400)]">{(file.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="w-6 h-6 rounded-full bg-[var(--gray-100)] flex items-center justify-center hover:bg-red-50 hover:text-red-500">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                      <Upload size={18} className="text-sky-500" />
                      <p className="text-sm font-medium text-[var(--gray-600)]">{dragging ? "Drop it here!" : "Drag & drop or click to upload"}</p>
                      <p className="text-xs text-[var(--gray-400)]">PDF, DOCX, TXT, CSV, XLSX · Max 50 MB</p>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
                </div>
                {error && <div className="mt-4 text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
                <div className="flex gap-2.5 mt-6">
                  <button onClick={() => setStep(1)} className="flex-1 text-sm font-medium text-[var(--gray-600)] bg-[var(--gray-50)] border border-[var(--gray-200)] rounded-lg py-2.5">Back</button>
                  <button onClick={handleCreateAgent} disabled={creating} className="flex-1 flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] disabled:opacity-60 text-white font-semibold text-sm rounded-lg py-2.5">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {file ? "Create & Train" : "Create Agent"}
                  </button>
                </div>
              </>
            )}

            {/* Step 3: REAL training (spec §10 §11) — every value is real */}
            {step === 3 && (
              <>
                <h1 className="text-xl font-bold text-[var(--gray-800)]">Training your agent</h1>
                <p className="text-[13px] text-[var(--gray-500)] mt-1.5 mb-5">
                  Real pipeline: extract → chunk → embed → index → validate. These are live backend operations.
                </p>
                <div className="space-y-2.5">
                  {uploadPct > 0 && uploadPct < 100 && (
                    <div className="flex items-center gap-2.5 text-[13px] text-[var(--gray-600)]">
                      <Loader2 className="w-4 h-4 animate-spin text-[var(--sky-500)]" /> Uploading… {uploadPct}%
                    </div>
                  )}
                  {STAGE_ORDER.map((s) => {
                    const idx = STAGE_ORDER.indexOf(s);
                    const cur = STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]);
                    const done = cur > idx || validated === true;
                    const active = cur === idx && !done;
                    return (
                      <div key={s} className={`flex items-center gap-2.5 text-[13px] ${done ? "text-emerald-700" : active ? "text-[var(--sky-700)] font-semibold" : "text-[var(--gray-400)]"}`}>
                        {done ? <Check className="w-4 h-4" /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="w-4 h-4 rounded-full border border-[var(--gray-300)] inline-block" />}
                        {STAGE_LABEL[s]}
                        {s === "chunking" && chunks > 0 && <span className="text-[var(--gray-500)]">— {chunks.toLocaleString()} chunks</span>}
                      </div>
                    );
                  })}
                  {validated && (
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700 pt-1">
                      <ShieldCheck className="w-4 h-4" /> Knowledge validated
                    </div>
                  )}
                </div>
                {error && (
                  <div className="mt-4 text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function In({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
      />
    </div>
  );
}
