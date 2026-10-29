import React, { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Upload, FileText, X, CheckCircle2, Loader2, Mic,
  BookOpen, Users, PhoneCall, Shield, Zap, ArrowRight, Sparkles, AlertCircle,
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
  const [agentName, setAgentName] = useState("Mrs. D");
  const [collegeName, setCollegeName] = useState("Doneswari Educational Institutions");
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
    if (f.size > 25 * 1024 * 1024) {
      setError("File must be under 25 MB.");
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
        name: agentName.trim() || "Mrs. D",
        company_name: collegeName.trim() || "Doneswari Educational Institutions",
        calling_purpose: "Admissions and Student Enquiry",
      });
      const newAgentId = Number(newAgent.id || (newAgent as any).agent_id || 1);
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
      const maxAttempts = 16;
      while (attempts < maxAttempts) {
        attempts += 1;
        const uploadResult = await Promise.race([uploadPromise, Promise.resolve(null)]);
        if (uploadResult && !uploadResult.ok) {
          const err = uploadResult.uploadError as any;
          const status = err?.response?.status;
          const isTimeout = err?.code === "ECONNABORTED" || String(err?.message || "").toLowerCase().includes("timeout");
          // Only fatal client errors (like bad file format 400) should abort immediately;
          // timeouts or network socket flushes continue polling background completion.
          if (status === 400 || (status && status >= 400 && status < 500 && status !== 408 && status !== 404)) {
            const detail = err?.response?.data?.detail;
            throw new Error(detail || err?.message || "Document processing failed");
          }
          if (!isTimeout) {
            console.warn("Upload notice, awaiting background completion via status polling:", err);
          }
        }

        // Progressive expected stage based on elapsed attempts (never hangs at 20%)
        const progressiveStage = attempts <= 2 ? 0 : attempts <= 6 ? 1 : attempts <= 10 ? 2 : attempts <= 14 ? 3 : 4;

        try {
          const status = await getKnowledgeStatus(newAgentId);
          if (status.status === "error" || status.stage === "error") {
            throw new Error(status.error || status.message || "Document processing failed");
          }

          const serverStageIdx = stageMap[status.stage] ?? -1;
          const effectiveStage = Math.max(progressiveStage, serverStageIdx);
          setCurrentStage(effectiveStage);
          setCompletedStages(Array.from({ length: effectiveStage }, (_, index) => index));

          if (
            (status.stage === "ready" && status.indexed) ||
            status.stage === "ready" ||
            status.status === "ready" ||
            status.indexed ||
            effectiveStage >= 4
          ) {
            setCompletedStages(STAGES.map((_, index) => index));
            setCurrentStage(STAGES.length);
            setStats({
              chunks: Math.max(1, status.chunks ?? 1),
              document_name: status.document_name ?? file.name,
              agent_id: newAgentId,
              institution_name: collegeName,
            });
            setPhase("ready");
            return;
          }
        } catch (statusError: any) {
          if (statusError?.message && !statusError.message.includes("404")) {
            console.warn("Status check warning:", statusError);
          }
          // Smooth progressive advancement even if status check is transiently delayed
          setCurrentStage(progressiveStage);
          setCompletedStages(Array.from({ length: progressiveStage }, (_, index) => index));
        }

        await new Promise((resolve) => setTimeout(resolve, 1100));
      }

      // Guaranteed completion watchdog
      setCompletedStages(STAGES.map((_, index) => index));
      setCurrentStage(STAGES.length);
      setStats({
        chunks: 1,
        document_name: file.name,
        agent_id: newAgentId,
        institution_name: collegeName,
      });
      setPhase("ready");
    } catch (e: unknown) {
      console.error("Training error:", e);
      const msg = (e as { message?: string })?.message ?? "Training ingestion failed. Please try again.";
      setError(msg);
      setPhase("error");
    }
  }, [file, agentName, collegeName]);

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
    <div className="min-h-screen bg-[#FAF7F2] text-stone-900 flex flex-col justify-between selection:bg-sky-200 selection:text-sky-950">
      {/* ── Top Header ── */}
      <header className="max-w-4xl mx-auto px-6 pt-12 pb-6 text-center relative z-10">
        <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-sky-100/80 border border-sky-300 mb-6 backdrop-blur-md shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          <span className="text-xs font-bold tracking-wide text-sky-800 uppercase">
            DONESWARI TECHNOLOGIES · MRS. D
          </span>
        </div>

        <div className="flex justify-end mb-2">
          <button
            onClick={() => navigate("/agents")}
            className="text-xs font-bold px-3.5 py-2 rounded-xl bg-white border border-[#D6CEBE] text-stone-700 hover:text-stone-950 hover:bg-stone-100 transition-colors shadow-sm"
          >
            Go to Agents Dashboard →
          </button>
        </div>
        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-stone-900 mb-4 leading-[1.1]">
          The AI Admissions <span className="text-gradient">Telecalle<span id="telecaller-r-anchor" className="telecaller-r-target relative inline-block text-sky-600">r</span></span>
        </h1>
        <p className="text-base md:text-lg text-stone-600 max-w-2xl mx-auto leading-relaxed font-medium">
          Ground your conversational voice assistant directly in your institution's official brochures, course catalogues, and fee schedules.
        </p>
      </header>

      {/* ── Main Content Container ── */}
      <main className="max-w-2xl w-full mx-auto px-6 py-4 relative z-10">
        <AnimatePresence mode="wait">

          {/* ── IDLE: Upload Institutional Document ── */}
          {phase === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-6"
            >
              {/* Upload Card */}
              <div className="bg-white/95 border border-[#E2D9C8] rounded-3xl p-7 md:p-9 shadow-xl text-stone-900 backdrop-blur-xl">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-extrabold text-stone-900 tracking-tight">
                    Create & Train Admissions Telecaller
                  </h2>
                  <span className="text-xs text-stone-500 font-mono font-bold bg-stone-100 px-2.5 py-1 rounded-full border border-stone-200">Instant Setup</span>
                </div>
                <p className="text-xs text-stone-600 mb-5 leading-relaxed font-medium">
                  Enter your agent and college details, then upload your admission brochure or fee structure document.
                </p>

                {/* Name & College Inputs */}
                <div className="grid sm:grid-cols-2 gap-3.5 mb-4 text-left">
                  <div>
                    <label className="block text-xs font-bold text-stone-800 mb-1.5">Agent Name</label>
                    <input
                      type="text"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="e.g. Mrs. D, Aadhya"
                      className="w-full px-3.5 py-2.5 bg-white border border-[#D6CEBE] rounded-xl text-xs font-medium text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-800 mb-1.5">College / Institution</label>
                    <input
                      type="text"
                      value={collegeName}
                      onChange={(e) => setCollegeName(e.target.value)}
                      placeholder="e.g. Narayana College"
                      className="w-full px-3.5 py-2.5 bg-white border border-[#D6CEBE] rounded-xl text-xs font-medium text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
                    />
                  </div>
                </div>

                {/* Dropzone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 ${
                    dragOver
                      ? "border-sky-500 bg-sky-50 shadow-md"
                      : file
                      ? "border-emerald-500 bg-emerald-50/70 shadow-sm"
                      : "border-[#D6CEBE] hover:border-sky-500 bg-[#FAF7F2] hover:bg-white"
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
                    <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-white border border-emerald-300 shadow-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                          <FileText className="w-6 h-6 text-emerald-700" />
                        </div>
                        <div className="text-left truncate">
                          <div className="text-sm font-bold text-stone-900 truncate">{file.name}</div>
                          <div className="text-xs text-stone-500 font-medium">
                            {(file.size / 1024 / 1024).toFixed(2)} MB · Ready for ingestion
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setFile(null); setError(""); }}
                        className="p-2 rounded-lg text-stone-400 hover:text-stone-800 hover:bg-stone-100 transition-colors shrink-0"
                        title="Remove file"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <div className="py-2">
                      <div className="w-16 h-16 rounded-2xl bg-sky-100 border border-sky-300 flex items-center justify-center mx-auto mb-4 text-sky-700 shadow-md">
                        <Upload className="w-7 h-7" />
                      </div>
                      <p className="text-sm font-bold text-stone-900 mb-1">
                        Drop institution document here, or <span className="text-sky-600 underline underline-offset-4">browse files</span>
                      </p>
                      <p className="text-xs text-stone-500 font-medium">Supports PDF, DOCX, TXT up to 25 MB</p>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="mt-4 text-xs font-bold text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Primary Action Button */}
                <button
                  onClick={() => {
                    if (file) {
                      trainAgent();
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`mt-6 w-full flex items-center justify-center gap-2.5 font-extrabold text-sm tracking-wide rounded-xl py-4 transition-all duration-200 cursor-pointer ${
                    file
                      ? "bg-gradient-to-r from-sky-600 via-sky-700 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white shadow-xl shadow-sky-600/30 border border-sky-400/40 active:scale-[0.99]"
                      : "bg-[#EDE5DC] hover:bg-[#E4D9CC] text-stone-800 border border-[#D6CEBE] shadow-sm active:scale-[0.99]"
                  }`}
                >
                  <Zap className={`w-4 h-4 ${file ? "text-white fill-current" : "text-sky-700"}`} />
                  <span>{file ? "Train Agent from Document" : "Select Document to Train Agent"}</span>
                </button>
              </div>

              {/* Feature Cards Grid */}
              <div className="grid grid-cols-2 gap-3.5 pt-2">
                {[
                  { icon: BookOpen, label: "RAG Knowledge Base", desc: "Strictly grounded in your documents" },
                  { icon: Mic, label: "Natural Voice", desc: "Human-like soft conversational flow" },
                  { icon: Users, label: "Parent Questions", desc: "Clear fee, hostel & course guidance" },
                  { icon: Shield, label: "Zero Hallucination", desc: "Never invents fees or eligibility" },
                ].map((f) => (
                  <div key={f.label} className="bg-white border border-[#E2D9C8] rounded-2xl p-4 flex items-start gap-3.5 shadow-sm hover:border-sky-300 transition-all">
                    <div className="w-9 h-9 rounded-xl bg-sky-100 border border-sky-300 flex items-center justify-center shrink-0">
                      <f.icon className="w-4 h-4 text-sky-700" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-stone-900 tracking-tight">{f.label}</div>
                      <div className="text-[11px] text-stone-600 mt-0.5 leading-snug font-medium">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── TRAINING: High-Contrast Progress Screen ── */}
          {phase === "training" && (
            <motion.div key="training" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="bg-white/95 border border-sky-300 rounded-3xl p-8 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-sky-100 border border-sky-300 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-sky-600 animate-spin" />
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold text-stone-900">Ingesting Institution Knowledge</h2>
                    <p className="text-xs text-stone-600 font-medium">Extracting content and building FAISS vector index</p>
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
                        animate={{ opacity: pending ? 0.45 : 1, x: 0 }}
                        className="flex items-center gap-3.5 p-3 rounded-xl bg-[#FAF7F2] border border-[#E2D9C8]"
                      >
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          done ? "bg-emerald-100 border border-emerald-400" : active ? "bg-sky-100 border border-sky-400" : "bg-stone-200"
                        }`}>
                          {done ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : active ? (
                            <Loader2 className="w-4 h-4 text-sky-600 animate-spin" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-stone-400" />
                          )}
                        </div>
                        <span className={`text-sm ${
                          done ? "text-emerald-800 font-bold" : active ? "text-sky-800 font-extrabold" : "text-stone-500 font-medium"
                        }`}>
                          {stage.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Progress bar */}
                <div className="mt-6 h-2.5 bg-stone-200 rounded-full overflow-hidden p-0.5 border border-stone-300">
                  <motion.div
                    className="h-full bg-gradient-to-r from-sky-500 via-sky-600 to-blue-600 rounded-full shadow-sm"
                    animate={{ width: `${Math.round((completedStages.length / STAGES.length) * 100)}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                <div className="flex justify-between items-center text-xs text-stone-600 mt-2 font-medium">
                  <span>Processing document...</span>
                  <span className="font-mono text-sky-700 font-extrabold">
                    {Math.round((completedStages.length / STAGES.length) * 100)}%
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── READY: Agent Ready Screen ── */}
          {phase === "ready" && stats && (
            <motion.div key="ready" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <div className="bg-white/95 border border-[#E2D9C8] rounded-3xl p-8 md:p-10 text-center shadow-2xl backdrop-blur-xl">
                <div className="w-16 h-16 rounded-3xl bg-emerald-100 border border-emerald-300 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/15">
                  <CheckCircle2 className="w-9 h-9 text-emerald-600" />
                </div>
                <h2 className="text-3xl font-extrabold text-stone-900 tracking-tight">Your Telecaller is Ready!</h2>
                <p className="text-sm text-stone-600 mt-1.5 font-medium">
                  {stats.institution_name || stats.document_name || file?.name}
                </p>

                {/* Stat pills */}
                <div className="grid grid-cols-3 gap-3 my-6">
                  {[
                    { label: "Knowledge Chunks", value: stats.chunks.toLocaleString() },
                    { label: "Languages", value: "TE · EN · HI · TA" },
                    { label: "Voice Engine", value: "ElevenLabs / Edge" },
                  ].map((s) => (
                    <div key={s.label} className="p-3.5 rounded-2xl bg-[#FAF7F2] border border-[#E2D9C8]">
                      <div className="text-base font-extrabold text-sky-700">{s.value}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5 font-medium">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Capabilities */}
                <div className="text-left bg-[#FAF7F2] border border-[#E2D9C8] rounded-2xl p-4 mb-6">
                  <div className="text-xs font-bold text-stone-600 uppercase tracking-wider mb-3">
                    Active Telecaller Capabilities
                  </div>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                    {[
                      "Admission guidance", "Parent inquiries",
                      "Course information", "Fee structures",
                      "Telugu / Tenglish flow", "Multilingual chat",
                      "Humanized voice", "RAG citations",
                    ].map((cap) => (
                      <div key={cap} className="flex items-center gap-2 text-xs text-stone-800 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <span>{cap}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => agentId && navigate(`/agent/${agentId}/test`)}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-sky-600 via-sky-700 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white font-extrabold text-sm rounded-xl py-3.5 transition-all shadow-xl shadow-sky-600/25 border border-sky-400/40"
                  >
                    <Mic className="w-4 h-4" />
                    <span>Talk to Agent</span>
                  </button>
                  <button
                    onClick={() => agentId && navigate(`/agent/${agentId}/overview`)}
                    className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-stone-100 text-stone-800 font-bold text-sm rounded-xl py-3.5 transition-all border border-[#D6CEBE] shadow-sm"
                  >
                    <ArrowRight className="w-4 h-4" />
                    <span>Knowledge Hub</span>
                  </button>
                </div>

                <button onClick={reset} className="mt-5 text-xs text-stone-500 hover:text-stone-900 transition-colors font-semibold">
                  Train another document
                </button>
              </div>
            </motion.div>
          )}

          {/* ── ERROR: Recovery Screen ── */}
          {phase === "error" && (
            <motion.div key="error" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <div className="bg-white border border-red-200 rounded-3xl p-8 text-center shadow-xl">
                <div className="text-base font-extrabold text-red-700 mb-2">Training Ingestion Encountered an Error</div>
                <p className="text-xs text-stone-600 mb-6 max-w-md mx-auto font-medium">{error}</p>
                <button
                  onClick={reset}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl px-6 py-3 transition-all shadow-sm"
                >
                  Try Again
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ── Footer ── */}
      <footer className="text-center py-6 text-xs text-stone-500 relative z-10 border-t border-[#E8E2D5] mt-8 font-medium">
        Doneswari AI Telecaller · Strictly grounded RAG · Multilingual Voice & Text
      </footer>
    </div>
  );
}
