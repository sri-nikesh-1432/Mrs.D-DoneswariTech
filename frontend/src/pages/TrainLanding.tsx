import React, { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Upload, FileText, X, CheckCircle2, Loader2, Mic,
  BookOpen, Users, PhoneCall, Shield, Zap, ArrowRight,
} from "lucide-react";
import { createAgent, uploadAgentDocument, getKnowledgeStatus } from "../services/api";

// These stages mirror the ingestion state returned by the backend.
const STAGES = [
  { key: "extracting", label: "Extracting document text" },
  { key: "chunking", label: "Creating knowledge chunks" },
  { key: "embedding", label: "Generating embeddings" },
  { key: "indexing", label: "Building the knowledge index" },
  { key: "ready", label: "Knowledge index ready" },
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
      // Step 1: Create agent
      const newAgent = await createAgent({
        name: file.name.replace(/\.[^.]+$/, ""),
        company_name: "Institution",
        calling_purpose: "Admissions and Student Enquiry",
      });
      const newAgentId = Number(newAgent.id);
      setAgentId(newAgentId);
      setCompletedStages([]);
      setCurrentStage(0);

      // Start ingestion and poll alongside it so the UI follows real backend stages.
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
      // Ingestion runs in the background on the server, so follow the real
      // stages for up to 5 minutes (large documents on a free instance can
      // legitimately take a while to embed and index).
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
    <div className="min-h-screen bg-app text-[var(--gray-800)]">
      {/* ── Header ── */}
      <header className="max-w-3xl mx-auto px-6 pt-12 pb-4 text-center relative z-10">
        <div className="inline-flex items-center gap-2.5 mb-7">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] flex items-center justify-center text-white font-bold text-[15px] shadow-[var(--shadow-md)]">
            D
          </div>
          <span className="font-semibold text-[15px] tracking-[0.02em] text-[var(--gray-800)]">DONESWARI</span>
        </div>
        <h1 className="font-display text-5xl md:text-6xl font-normal leading-[1.02] tracking-tight text-[var(--gray-800)]">
          The AI admissions <span className="text-gradient">telecaller</span>
        </h1>
        <p className="text-[15px] text-[var(--gray-500)] mt-4 max-w-xl mx-auto leading-relaxed">
          Train an AI admissions representative using your institution's official information.
        </p>
      </header>

      {/* ── Main content ── */}
      <main className="max-w-2xl mx-auto px-6 py-10 relative z-10">
        <AnimatePresence mode="wait">

          {/* ── IDLE: Upload card ── */}
          {phase === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="glass-strong rounded-[var(--radius-lg)] p-8">
                {/* Quick Access to existing agent */}
                <div className="flex items-center justify-between p-3.5 mb-6 rounded-2xl bg-sky-50/80 border border-sky-200/80 text-[13.5px]">
                  <div className="flex items-center gap-2.5 text-[var(--gray-700)]">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span><strong>Mrs. D</strong> is ready with admissions knowledge.</span>
                  </div>
                  <button
                    onClick={() => navigate("/agent/1/test")}
                    className="flex items-center gap-1.5 font-semibold text-[var(--sky-600)] hover:text-[var(--sky-700)] bg-white/90 shadow-sm px-3.5 py-1.5 rounded-xl hover:bg-white transition-all"
                  >
                    <span>Test Telecaller</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <h2 className="text-[17px] font-semibold text-[var(--gray-800)] mb-1">Upload Institution Information</h2>
                <p className="text-[13px] text-[var(--gray-500)] mb-6">
                  Prospectus · Admission brochure · Fee structure · Course document · FAQ document
                </p>

                {/* Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${
                    dragOver
                      ? "border-[var(--sky-400)] bg-[var(--sky-50)]"
                      : file
                      ? "border-[var(--sky-400)] bg-[var(--sky-50)]"
                      : "border-[var(--gray-300)] hover:border-[var(--sky-400)] hover:bg-white/60"
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
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[var(--sky-100)] flex items-center justify-center">
                        <FileText className="w-5 h-5 text-[var(--sky-600)]" />
                      </div>
                      <div className="text-left">
                        <div className="text-[14px] font-medium text-[var(--gray-800)]">{file.name}</div>
                        <div className="text-[12px] text-[var(--gray-500)]">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setFile(null); setError(""); }}
                        className="ml-2 text-[var(--gray-400)] hover:text-[var(--gray-800)]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-white/70 border hairline flex items-center justify-center">
                        <Upload className="w-6 h-6 text-[var(--sky-400)]" />
                      </span>
                      <p className="text-[14px] text-[var(--gray-700)] mb-1">
                        Drop institution PDF here, or <span className="text-[var(--sky-600)] font-medium">browse files</span>
                      </p>
                      <p className="text-[12px] text-[var(--gray-400)]">PDF · DOCX · TXT · Max 20 MB</p>
                    </>
                  )}
                </div>

                {error && (
                  <div className="mt-4 text-[13px] text-red-700 bg-red-50/70 backdrop-blur-md border border-red-200 rounded-xl px-4 py-2.5">
                    {error}
                  </div>
                )}

                <button
                  onClick={trainAgent}
                  disabled={!file}
                  className="mt-6 w-full flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] disabled:bg-[var(--gray-300)] disabled:cursor-not-allowed text-white font-semibold text-[15px] rounded-xl py-3.5 transition-colors shadow-[0_8px_24px_rgba(14,147,232,0.35)]"
                >
                  <Zap className="w-4 h-4" />
                  Train Agent
                </button>
              </div>

              {/* Feature pills */}
              <div className="grid grid-cols-2 gap-3 mt-6">
                {[
                  { icon: BookOpen, label: "RAG Knowledge Base", desc: "Grounded in your document" },
                  { icon: Mic, label: "Natural Voice", desc: "Human-like conversation" },
                  { icon: Users, label: "Parent Questions", desc: "Safety, fees, hostel" },
                  { icon: Shield, label: "No Hallucination", desc: "Only documented facts" },
                ].map((f) => (
                  <div key={f.label} className="glass rounded-2xl p-4 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl bg-sky-100/80 flex items-center justify-center shrink-0">
                      <f.icon className="w-4 h-4 text-[var(--sky-600)]" />
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-[var(--gray-800)]">{f.label}</div>
                      <div className="text-[11.5px] text-[var(--gray-500)] mt-0.5">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── TRAINING: Progress screen ── */}
          {phase === "training" && (
            <motion.div key="training" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="glass-strong rounded-[var(--radius-lg)] p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Loader2 className="w-5 h-5 text-[var(--sky-500)] animate-spin" />
                  <h2 className="text-[17px] font-semibold text-[var(--gray-800)]">Processing Your Institution</h2>
                </div>

                <div className="space-y-3">
                  {STAGES.map((stage, i) => {
                    const done = completedStages.includes(i);
                    const active = currentStage === i;
                    const pending = !done && !active;
                    return (
                      <motion.div
                        key={stage.key}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: pending ? 0.4 : 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-center gap-3"
                      >
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                          done ? "bg-emerald-50" : active ? "bg-[var(--sky-100)]" : "bg-[var(--gray-100)]"
                        }`}>
                          {done ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : active ? (
                            <Loader2 className="w-4 h-4 text-[var(--sky-500)] animate-spin" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-[var(--gray-300)]" />
                          )}
                        </div>
                        <span className={`text-[14px] ${
                          done ? "text-emerald-700 font-medium" : active ? "text-[var(--sky-600)] font-medium" : "text-[var(--gray-400)]"
                        }`}>
                          {stage.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>

                <div className="mt-6 h-1.5 bg-[var(--gray-100)] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-[var(--sky-400)] to-[var(--sky-600)] rounded-full"
                    animate={{ width: `${Math.round((completedStages.length / STAGES.length) * 100)}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                <p className="text-[12px] text-[var(--gray-500)] mt-2 text-right">
                  {Math.round((completedStages.length / STAGES.length) * 100)}%
                </p>
              </div>
            </motion.div>
          )}

          {/* ── READY: Agent ready screen ── */}
          {phase === "ready" && stats && (
            <motion.div key="ready" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <div className="glass-strong rounded-[var(--radius-lg)] p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[var(--sky-100)] flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-[var(--sky-600)]" />
                </div>
                <h2 className="font-display text-3xl text-[var(--gray-800)]">Your agent is ready</h2>
                <p className="text-[14px] text-[var(--gray-500)] mt-1.5">
                  {stats.institution_name || stats.document_name || file?.name}
                </p>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mt-6 mb-6">
                  {[
                    { label: "Knowledge Chunks", value: stats.chunks.toLocaleString() },
                    { label: "Languages", value: "EN · TE · HI" },
                    { label: "Voice", value: "Ready" },
                  ].map((s) => (
                    <div key={s.label} className="glass rounded-2xl p-3">
                      <div className="text-[18px] font-bold text-[var(--gray-800)]">{s.value}</div>
                      <div className="text-[11px] text-[var(--gray-500)] mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Capabilities */}
                <div className="text-left bg-white/55 backdrop-blur-md border hairline rounded-2xl p-4 mb-6">
                  <div className="text-[12px] font-semibold text-[var(--gray-500)] uppercase tracking-wide mb-3">Agent Capabilities</div>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                    {[
                      "Admission guidance", "Parent questions",
                      "Course information", "Fee information",
                      "Objection handling", "Multilingual conversation",
                      "Voice interaction", "Lead qualification",
                    ].map((cap) => (
                      <div key={cap} className="flex items-center gap-2 text-[13px] text-[var(--gray-700)]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[var(--sky-500)] shrink-0" />
                        {cap}
                      </div>
                    ))}
                  </div>
                </div>

                {/* CTA buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => agentId && navigate(`/agent/${agentId}/test`)}
                    className="flex-1 flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white font-semibold text-[15px] rounded-xl py-3.5 transition-colors shadow-[0_8px_24px_rgba(14,147,232,0.35)]"
                  >
                    <Mic className="w-4 h-4" />
                    Talk to Agent
                  </button>
                  <button
                    onClick={() => agentId && navigate(`/agent/${agentId}/overview`)}
                    className="flex-1 flex items-center justify-center gap-2 glass hover:bg-white/80 text-[var(--gray-800)] font-semibold text-[15px] rounded-xl py-3.5 transition-colors"
                  >
                    <ArrowRight className="w-4 h-4" />
                    Publish Agent
                  </button>
                </div>

                <button onClick={reset} className="mt-4 text-[13px] text-[var(--gray-400)] hover:text-[var(--gray-700)] transition-colors">
                  Train another agent
                </button>
              </div>
            </motion.div>
          )}

          {/* ── ERROR ── */}
          {phase === "error" && (
            <motion.div key="error" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <div className="glass-strong rounded-[var(--radius-lg)] border-red-200 p-8 text-center">
                <div className="text-[16px] font-semibold text-red-700 mb-2">Training Failed</div>
                <p className="text-[13px] text-[var(--gray-500)] mb-6">{error}</p>
                <button
                  onClick={reset}
                  className="bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white font-semibold text-[14px] rounded-xl px-6 py-3 transition-colors"
                >
                  Try Again
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ── Footer ── */}
      <footer className="text-center pb-8 text-[12px] text-[var(--gray-400)] relative z-10">
        Doneswari AI Telecaller · Grounded answers · No hallucination · Multilingual
      </footer>
    </div>
  );
}