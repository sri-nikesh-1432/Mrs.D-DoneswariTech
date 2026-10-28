import React, { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles,
  Upload,
  FileText,
  X,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Bot,
  Building2,
  PhoneCall,
  ShieldCheck,
} from "lucide-react";
import { createAgent, uploadAgentDocument, getKnowledgeStatus } from "../services/api";

const STAGES = [
  { key: "extracting", label: "Extracting institutional text" },
  { key: "chunking", label: "Structuring knowledge chunks" },
  { key: "embedding", label: "Generating semantic embeddings" },
  { key: "indexing", label: "Compiling vector index (FAISS)" },
  { key: "ready", label: "Telecaller ready for admission calls" },
];

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (agentId: number) => void;
}

export default function CreateAgentModal({ isOpen, onClose, onSuccess }: CreateAgentModalProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Steps: 1 = Details, 2 = File Upload, 3 = Training & Ingestion, 4 = Ready
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Form State
  const [agentName, setAgentName] = useState("");
  const [collegeName, setCollegeName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Training state
  const [currentStage, setCurrentStage] = useState(0);
  const [completedStages, setCompletedStages] = useState<number[]>([]);
  const [trainingError, setTrainingError] = useState("");
  const [isTraining, setIsTraining] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState<number | null>(null);
  const [chunksCount, setChunksCount] = useState(0);

  if (!isOpen) return null;

  // File validation
  const handleFile = (f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext ?? "")) {
      setTrainingError("Please upload a PDF, DOCX, or TXT file.");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setTrainingError("File size exceeds 25 MB limit.");
      return;
    }
    setTrainingError("");
    setFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  // Start Training & Creation Pipeline
  const startTrainingAndCreate = async () => {
    if (!file || !agentName.trim() || !collegeName.trim()) return;

    setStep(3);
    setIsTraining(true);
    setTrainingError("");
    setCurrentStage(0);
    setCompletedStages([]);

    try {
      // 1. Create the Agent row
      const agent = await createAgent({
        name: agentName.trim(),
        company_name: collegeName.trim(),
        calling_purpose: "Admissions and Student Enquiry",
      });

      const newId = Number(agent.id);
      setCreatedAgentId(newId);

      // 2. Upload document & kick off background ingestion
      const uploadPromise = uploadAgentDocument(newId, file).then(
        (res) => ({ ok: true as const, res }),
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

      // 3. Poll ingestion progress
      let attempts = 0;
      while (attempts < 300) {
        attempts += 1;
        const uploadResult = await Promise.race([uploadPromise, Promise.resolve(null)]);
        if (uploadResult && !uploadResult.ok) {
          const detail =
            (uploadResult.uploadError as { response?: { data?: { detail?: string } } })?.response?.data
              ?.detail;
          throw new Error(
            typeof detail === "string"
              ? detail
              : (uploadResult.uploadError as Error)?.message || "Document processing failed",
          );
        }

        try {
          const status = await getKnowledgeStatus(newId);
          if (status.status === "error" || status.stage === "error") {
            throw new Error(status.error || status.message || "Document processing failed");
          }

          const stageIdx = stageMap[status.stage];
          if (stageIdx !== undefined) {
            setCurrentStage(stageIdx);
            setCompletedStages(Array.from({ length: stageIdx }, (_, i) => i));
          }

          if (status.stage === "ready" && status.indexed) {
            setChunksCount(status.chunks || 0);
            setCurrentStage(4);
            setCompletedStages([0, 1, 2, 3, 4]);
            setIsTraining(false);
            setStep(4);
            onSuccess?.(newId);
            return;
          }
        } catch (pollErr: any) {
          if (pollErr?.message && !pollErr.message.includes("404")) {
            throw pollErr;
          }
        }

        await new Promise((r) => setTimeout(r, 1200));
      }

      throw new Error("Training timed out. Please try again.");
    } catch (err: any) {
      console.error("[CreateAgent] Error:", err);
      const msg =
        err?.response?.data?.detail?.message ||
        err?.response?.data?.detail ||
        err?.message ||
        "Failed to create and train agent. Please try again.";
      setTrainingError(typeof msg === "string" ? msg : JSON.stringify(msg));
      setIsTraining(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
      onClick={() => {
        if (!isTraining) onClose();
      }}
    >
      <div
        className="glass-strong bg-slate-900/95 border border-slate-700/70 rounded-2xl shadow-2xl w-full max-w-lg p-6 sm:p-7 relative text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Step indicator */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Create AI Admissions Telecaller</h2>
              <p className="text-xs text-slate-400">
                {step === 1 && "Step 1: Agent & College Details"}
                {step === 2 && "Step 2: Upload Knowledge Base (PDF)"}
                {step === 3 && "Step 3: Training Knowledge Ingestion"}
                {step === 4 && "Completed: Agent Ready for Calls"}
              </p>
            </div>
          </div>
          {!isTraining && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* ── STEP 1: Agent Name & College Name ── */}
        {step === 1 && (
          <div className="py-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Agent Name <span className="text-sky-400">*</span>
              </label>
              <div className="relative">
                <Bot className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g. Mrs. D, Aadhya, Janaki"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                The name the AI will use to introduce itself to students and parents.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                College / Institution Name <span className="text-sky-400">*</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={collegeName}
                  onChange={(e) => setCollegeName(e.target.value)}
                  placeholder="e.g. Narayana Educational Institutions"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                The organization or university the telecaller represents.
              </p>
            </div>

            <div className="pt-3 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!agentName.trim() || !collegeName.trim()}
                onClick={() => setStep(2)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next: Upload PDF <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: PDF Upload ── */}
        {step === 2 && (
          <div className="py-5 space-y-4">
            <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/60 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400">Agent:</span>{" "}
                <span className="font-semibold text-sky-400">{agentName}</span>
              </div>
              <div>
                <span className="text-slate-400">Institution:</span>{" "}
                <span className="font-semibold text-white">{collegeName}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Upload Institutional Knowledge Document <span className="text-sky-400">*</span>
              </label>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                  dragOver
                    ? "border-sky-400 bg-sky-500/10"
                    : file
                    ? "border-emerald-500/60 bg-emerald-500/5"
                    : "border-slate-700 hover:border-slate-500 bg-slate-800/40"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />

                {file ? (
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-2">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-semibold text-white break-all">{file.name}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {(file.size / (1024 * 1024)).toFixed(2)} MB · Click to choose different file
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-xl bg-slate-800 text-sky-400 border border-slate-700 flex items-center justify-center mb-2">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-semibold text-white">
                      Drop college prospectus or handbook here
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Supports PDF, DOCX, or TXT up to 25 MB
                    </div>
                  </div>
                )}
              </div>
            </div>

            {trainingError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{trainingError}</span>
              </div>
            )}

            <div className="pt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="py-2.5 px-4 rounded-xl border border-slate-700 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="button"
                disabled={!file}
                onClick={startTrainingAndCreate}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-600 hover:to-indigo-600 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Train & Create Agent <Sparkles className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Training & Ingestion Progress ── */}
        {step === 3 && (
          <div className="py-6 space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-400/30 flex items-center justify-center mx-auto mb-3 animate-pulse">
                <Loader2 className="w-7 h-7 animate-spin" />
              </div>
              <h3 className="text-base font-bold text-white">Training Ingestion in Progress...</h3>
              <p className="text-xs text-slate-400 mt-1">
                Parsing institutional handbook and generating vector embeddings
              </p>
            </div>

            {/* Stages checklist */}
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/60 space-y-3">
              {STAGES.map((s, idx) => {
                const isDone = completedStages.includes(idx);
                const isCurrent = currentStage === idx && !isDone;

                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : isCurrent ? (
                        <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-slate-600" />
                      )}
                    </div>
                    <span
                      className={`text-xs ${
                        isDone
                          ? "text-emerald-300 font-medium line-through decoration-slate-600"
                          : isCurrent
                          ? "text-white font-semibold"
                          : "text-slate-400"
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {trainingError && (
              <div className="p-4 rounded-xl bg-red-500/15 border border-red-500/30 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-red-300">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span>Training Ingestion Encountered an Error</span>
                </div>
                <div className="text-xs text-red-200">{trainingError}</div>
                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={startTrainingAndCreate}
                    className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-800 transition-colors"
                  >
                    Change File
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 4: Ready & Telecaller Launch ── */}
        {step === 4 && (
          <div className="py-6 space-y-5 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-400/30 flex items-center justify-center mx-auto mb-2 shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">Agent Created & Trained!</h3>
              <p className="text-xs text-slate-300 mt-1">
                <strong className="text-sky-400">{agentName}</strong> is fully grounded on{" "}
                <strong className="text-white">{collegeName}</strong>'s document.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-left bg-slate-800/60 rounded-xl p-3.5 border border-slate-700/60 text-xs">
              <div>
                <span className="text-slate-400 block">Knowledge Document</span>
                <span className="font-semibold text-white truncate block">{file?.name}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Verified Chunks</span>
                <span className="font-semibold text-emerald-400 block">{chunksCount} Chunks Indexed</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (createdAgentId) navigate(`/agent/${createdAgentId}/overview`);
                }}
                className="py-2.5 px-4 rounded-xl border border-slate-700 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                View Overview
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (createdAgentId) navigate(`/agent/${createdAgentId}/test`);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 hover:from-emerald-600 hover:to-sky-600 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition-all"
              >
                <PhoneCall className="w-4 h-4" /> Launch Voice Telecaller
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
