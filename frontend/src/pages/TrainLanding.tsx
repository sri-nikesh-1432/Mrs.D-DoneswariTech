import React, { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Upload, FileText, X, CheckCircle2, Loader2, Mic,
  BookOpen, Users, PhoneCall, Shield, Zap, ArrowRight, Sparkles,
} from "lucide-react";
import { createAgent, uploadAgentDocument, getKnowledgeStatus } from "../services/api";

const STAGES = [
  { key: "extracting", label: "Extracting institutional text" },
  { key: "chunking", label: "Structuring knowledge chunks" },
  { key: "embedding", label: "Generating semantic embeddings" },
  { key: "indexing", label: "Compiling vector index (FAISS)" },
  { key: "ready", label: "Telecaller ready for admission calls" },
];

type Phase = "idle" | "training" | "ready" | "error";

interface KnowledgeStats {
  chunks: number;
  institution_name?: string;
  document_name?: string;
  agent_id?: number;
}

export default function TrainLanding() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [currentStage, setCurrentStage] = useState(-1);
  const [completedStages, setCompletedStages] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [agentId, setAgentId] = useState<number | null>(null);

  // ── File selection ────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext ?? "")) {
      setError("Please upload a PDF, DOCX, or TXT file.");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setError("File must be under 20 MB.");
      return;
    }
    setError("");
    setFile(f);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ── Train Agent ───────────────────────────────────────────────────
  const trainAgent = useCallback(async () => {
    if (!file) return;
    setPhase("training");
    setCurrentStage(0);
    setCompletedStages([]);
    setError("");

    try {
      const newAgent = await createAgent({
        name: file.name.replace(/\.[^.]+$/, ""),
        company_name: "Institution",
        calling_purpose: "Admissions and Student Enquiry",
      });
      const newAgentId = Number(newAgent.id);
      setAgentId(newAgentId);
      setCompletedStages([]);
      setCurrentStage(0);

      const uploadPromise = uploadAgentDocument(newAgentId, file).then(
        () => ({ ok: true as const }),
        (uploadError: unknown) => ({ ok: false as const, uploadError }),
      );

      const stageMap: Record<string, number> = {
        extracting: 0,
        extracted: 0,
        chunking: 1,
        embedding: 2,
        indexing: 3,
        ready: 4,
      };

      let attempts = 0;
      while (attempts < 300) {
        attempts += 1;
        const uploadResult = await Promise.race([uploadPromise, Promise.resolve(null)]);
        if (uploadResult && !uploadResult.ok) {
          const detail = (uploadResult.uploadError as { response?: { data?: { detail?: string } } })
            ?.response?.data?.detail;
          throw new Error(detail || (uploadResult.uploadError as Error)?.message || "Document processing failed");
        }

        try {
          const status = await getKnowledgeStatus(newAgentId);
          if (status.status === "error" || status.stage === "error") {
            throw new Error(status.error || status.message || "Document processing failed");
          }

          const stageIdx = stageMap[status.stage];
          if (stageIdx !== undefined) {
            setCurrentStage(stageIdx);
            setCompletedStages(Array.from({ length: stageIdx }, (_, index) => index));
          }

          if (status.stage === "ready" && status.indexed) {
            const result = await uploadPromise;
            if (!result.ok) {
              const detail = (result.uploadError as { response?: { data?: { detail?: string } } })
                ?.response?.data?.detail;
              throw new Error(detail || (result.uploadError as Error)?.message || "Document processing failed");
            }
            setCompletedStages(STAGES.map((_, index) => index));
            setCurrentStage(STAGES.length);
            setStats({
              chunks: status.chunks ?? 0,
              document_name: status.document_name ?? file.name,
              agent_id: newAgentId,
            });
            setPhase("ready");
            return;
          }
        } catch (statusError) {
          if (statusError instanceof Error && statusError.message !== "Network Error") throw statusError;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      throw new Error("Training timed out — please try again.");
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "Training failed";
      setError(msg);
      setPhase("error");
    }
  }, [file]);

  const reset = () => {
    setPhase("idle");
    setFile(null);
    setCurrentStage(-1);
    setCompletedStages([]);
    setError("");
    setStats(null);
    setAgentId(null);
  };

  return (
    <div className="min-h-screen bg-app text-slate-100 flex flex-col justify-between">
      {/* ── Top Header ── */}
      <header className="max-w-4xl mx-auto px-6 pt-12 pb-6 text-center relative z-10">
        <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/25 mb-6 backdrop-blur-md shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          <span className="text-xs font-semibold tracking-wide text-sky-300 uppercase">
            DONESWARI TECHNOLOGIES · MRS. D
          </span>
        </div>

        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white mb-4 leading-[1.1]">
          The AI Admissions <span className="text-gradient">Telecaller</span>
        </h1>
        <p className="text-base md:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
          Ground your conversational voice assistant directly in your institution's official brochures, course catalogues, and fee schedules.
        </p>
      </header>

      {/* ── Main Content Container ── */}
      <main className="max-w-2xl w-full mx-auto px-6 py-4 relative z-10">
        <AnimatePresence mode="wait">

          {/* ── IDLE: Upload & Direct Launch ── */}
          {phase === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-6"
            >
              {/* Ready Telecaller Quick Action */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950/80 via-slate-900/90 to-indigo-950/80 border border-sky-500/30 backdrop-blur-xl shadow-xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300 shrink-0 shadow-inner">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white flex items-center gap-2">
                      <span>Mrs. D is live with knowledge</span>
                      <span className="text-[10px] bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 px-2 py-0.5 rounded-full font-mono">
                        361 Chunks
                      </span>
                    </div>
                    <div className="text-xs text-slate-300">Narayana College Admissions & Fees</div>
                  </div>
                </div>
                <button
                  onClick={() => navigate("/agent/1/test")}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold text-xs tracking-wide shadow-lg shadow-sky-500/25 border border-sky-400/30 active:scale-95 transition-all shrink-0"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Launch Telecaller</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Upload Card */}
              <div className="glass-strong rounded-3xl p-7 md:p-9 shadow-2xl border border-slate-700/80">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-bold text-white tracking-tight">
                    Upload Institution Information
                  </h2>
                  <span className="text-xs text-slate-400 font-mono">Step 1 of 2</span>
                </div>
                <p className="text-xs text-slate-300 mb-6 leading-relaxed">
                  Prospectus · Admission Brochure · Fee Structure · Course Document · FAQ Document
                </p>

                {/* Dropzone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 ${
                    dragOver
                      ? "border-sky-400 bg-sky-500/15 shadow-[0_0_25px_rgba(56,189,248,0.25)]"
                      : file
                      ? "border-sky-500/80 bg-slate-800/90 shadow-md"
                      : "border-slate-700 hover:border-sky-400/70 bg-slate-900/60 hover:bg-slate-900/90"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />

                  {file ? (
                    <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-slate-800 border border-slate-700">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center shrink-0">
                          <FileText className="w-6 h-6 text-sky-400" />
                        </div>
                        <div className="text-left truncate">
                          <div className="text-sm font-semibold text-white truncate">{file.name}</div>
                          <div className="text-xs text-slate-400">
                            {(file.size / 1024 / 1024).toFixed(2)} MB · Ready for ingestion
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setFile(null); setError(""); }}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
                        title="Remove file"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <div className="py-2">
                      <div className="w-16 h-16 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mx-auto mb-4 text-sky-400 shadow-lg shadow-sky-500/10">
                        <Upload className="w-7 h-7" />
                      </div>
                      <p className="text-sm font-medium text-slate-200 mb-1">
                        Drop institution document here, or <span className="text-sky-400 font-semibold underline underline-offset-4">browse files</span>
                      </p>
                      <p className="text-xs text-slate-400">Supports PDF, DOCX, TXT up to 20 MB</p>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="mt-4 text-xs font-medium text-red-200 bg-red-950/60 border border-red-500/50 rounded-xl px-4 py-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Primary Action Button — High Contrast & Clear Text */}
                <button
                  onClick={trainAgent}
                  disabled={!file}
                  className={`mt-6 w-full flex items-center justify-center gap-2.5 font-bold text-sm tracking-wide rounded-xl py-4 transition-all duration-200 ${
                    file
                      ? "bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-xl shadow-sky-500/30 border border-sky-400/40 active:scale-[0.99] cursor-pointer"
                      : "bg-slate-800/90 text-slate-400 border border-slate-700/80 cursor-not-allowed shadow-none"
                  }`}
                >
                  <Zap className={`w-4 h-4 ${file ? "text-white fill-current" : "text-slate-400"}`} />
                  <span>{file ? "Train Agent from Document" : "Select Document to Train Agent"}</span>
                </button>
              </div>

              {/* Feature Cards Grid */}
              <div className="grid grid-cols-2 gap-3.5 pt-2">
                {[
                  { icon: BookOpen, label: "RAG Knowledge Base", desc: "Strictly grounded in your documents" },
                  { icon: Mic, label: "Natural Voice", desc: "Human-like conversational flow" },
                  { icon: Users, label: "Parent Questions", desc: "Clear fee, hostel & course guidance" },
                  { icon: Shield, label: "Zero Hallucination", desc: "Never invents fees or eligibility" },
                ].map((f) => (
                  <div key={f.label} className="glass rounded-2xl p-4 flex items-start gap-3.5 border border-slate-800/90 hover:border-slate-700 transition-all">
                    <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center shrink-0">
                      <f.icon className="w-4 h-4 text-sky-400" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white tracking-tight">{f.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── TRAINING: High-Contrast Progress Screen ── */}
          {phase === "training" && (
            <motion.div key="training" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="glass-strong rounded-3xl p-8 border border-sky-500/30 shadow-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Ingesting Institution Knowledge</h2>
                    <p className="text-xs text-slate-400">Extracting content and building FAISS vector index</p>
                  </div>
                </div>

                <div className="space-y-3.5 my-6">
                  {STAGES.map((stage, i) => {
                    const done = completedStages.includes(i);
                    const active = currentStage === i;
                    const pending = !done && !active;
                    return (
                      <motion.div
                        key={stage.key}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: pending ? 0.35 : 1, x: 0 }}
                        className="flex items-center gap-3.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800"
                      >
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          done ? "bg-emerald-500/20 border border-emerald-400/50" : active ? "bg-sky-500/20 border border-sky-400/50" : "bg-slate-800"
                        }`}>
                          {done ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : active ? (
                            <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-slate-600" />
                          )}
                        </div>
                        <span className={`text-sm ${
                          done ? "text-emerald-300 font-medium" : active ? "text-sky-300 font-semibold" : "text-slate-500"
                        }`}>
                          {stage.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Progress bar */}
                <div className="mt-6 h-2 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
                  <motion.div
                    className="h-full bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500 rounded-full shadow-[0_0_12px_rgba(56,189,248,0.5)]"
                    animate={{ width: `${Math.round((completedStages.length / STAGES.length) * 100)}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                <div className="flex justify-between items-center text-xs text-slate-400 mt-2">
                  <span>Processing...</span>
                  <span className="font-mono text-sky-400 font-bold">
                    {Math.round((completedStages.length / STAGES.length) * 100)}%
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── READY: Agent Ready Screen ── */}
          {phase === "ready" && stats && (
            <motion.div key="ready" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <div className="glass-strong rounded-3xl p-8 md:p-10 text-center border border-sky-500/40 shadow-2xl">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
                  <CheckCircle2 className="w-9 h-9 text-emerald-400" />
                </div>
                <h2 className="text-3xl font-extrabold text-white tracking-tight">Your Agent is Ready</h2>
                <p className="text-sm text-slate-300 mt-1.5">
                  {stats.institution_name || stats.document_name || file?.name}
                </p>

                {/* Stat pills */}
                <div className="grid grid-cols-3 gap-3 my-6">
                  {[
                    { label: "Knowledge Chunks", value: stats.chunks.toLocaleString() },
                    { label: "Languages", value: "EN · TE · HI · TA" },
                    { label: "Voice Engine", value: "ElevenLabs" },
                  ].map((s) => (
                    <div key={s.label} className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800">
                      <div className="text-base font-bold text-sky-400">{s.value}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Capabilities */}
                <div className="text-left bg-slate-900/60 border border-slate-800 rounded-2xl p-4 mb-6">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Active Telecaller Capabilities
                  </div>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                    {[
                      "Admission guidance", "Parent inquiries",
                      "Course information", "Fee structures",
                      "Objection handling", "Multilingual chat",
                      "ElevenLabs speech", "RAG citations",
                    ].map((cap) => (
                      <div key={cap} className="flex items-center gap-2 text-xs text-slate-200">
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>{cap}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => agentId && navigate(`/agent/${agentId}/test`)}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold text-sm rounded-xl py-3.5 transition-all shadow-xl shadow-sky-500/30 border border-sky-400/40"
                  >
                    <Mic className="w-4 h-4" />
                    <span>Talk to Agent</span>
                  </button>
                  <button
                    onClick={() => agentId && navigate(`/agent/${agentId}/overview`)}
                    className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm rounded-xl py-3.5 transition-all border border-slate-700"
                  >
                    <ArrowRight className="w-4 h-4" />
                    <span>Knowledge Hub</span>
                  </button>
                </div>

                <button onClick={reset} className="mt-5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                  Train another document
                </button>
              </div>
            </motion.div>
          )}

          {/* ── ERROR: Recovery Screen ── */}
          {phase === "error" && (
            <motion.div key="error" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <div className="glass-strong rounded-3xl border border-red-500/40 p-8 text-center shadow-2xl">
                <div className="text-base font-bold text-red-400 mb-2">Training Ingestion Encountered an Error</div>
                <p className="text-xs text-slate-300 mb-6 max-w-md mx-auto">{error}</p>
                <button
                  onClick={reset}
                  className="bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl px-6 py-3 border border-slate-700 transition-all"
                >
                  Try Again
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ── Footer ── */}
      <footer className="text-center py-6 text-xs text-slate-500 relative z-10 border-t border-slate-800/60 mt-8">
        Doneswari AI Telecaller · Strictly grounded RAG · Multilingual Voice & Text
      </footer>
    </div>
  );
}
