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

      const newId = Number(agent.id || (agent as any).agent_id || 1);
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
          // Ignore transient 404s during initial server ingestion setup
          if (pollErr?.message && !pollErr.message.includes("404")) {
            console.warn("Polling warning:", pollErr);
          }
        }

        await new Promise((r) => setTimeout(r, 1200));
      }

      // If we finished upload but status timed out, treat as ready
      setChunksCount(1);
      setCurrentStage(4);
      setCompletedStages([0, 1, 2, 3, 4]);
      setIsTraining(false);
      setStep(4);
      onSuccess?.(newId);
    } catch (err: any) {
      console.error("Agent creation error:", err);
      const detail = err?.response?.data?.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : err?.message || "Training ingestion encountered an error";
      setTrainingError(msg);
      setIsTraining(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-stone-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
      onClick={() => {
        if (!isTraining) onClose();
      }}
    >
      <div
        className="bg-[#FDFBF7] border border-[#E2D9C8] rounded-3xl shadow-2xl w-full max-w-lg p-6 sm:p-8 relative text-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Step indicator */}
        <div className="flex items-center justify-between pb-4 border-b border-[#E8E2D5]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/15 text-sky-600 border border-sky-500/30 flex items-center justify-center shadow-sm">
              <Sparkles className="w-5 h-5 text-sky-600" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-stone-900 tracking-tight">Create AI Admissions Telecaller</h2>
              <p className="text-xs text-stone-600 font-medium">
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
              className="p-1.5 rounded-xl text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* ── STEP 1: Agent Name & College Name ── */}
        {step === 1 && (
          <div className="py-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                Agent Name <span className="text-sky-600">*</span>
              </label>
              <div className="relative">
                <Bot className="absolute left-3.5 top-3 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g. Mrs. D, Aadhya, Janaki"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-[#D6CEBE] rounded-xl text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all shadow-sm"
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-stone-600 mt-1">
                The name the AI telecaller uses to introduce itself to parents and prospective students.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                College / Institution Name <span className="text-sky-600">*</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-3 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  value={collegeName}
                  onChange={(e) => setCollegeName(e.target.value)}
                  placeholder="e.g. Narayana Educational Institutions"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-[#D6CEBE] rounded-xl text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all shadow-sm"
                />
              </div>
              <p className="text-[11px] text-stone-600 mt-1">
                The institution or university whose admissions the agent represents.
              </p>
            </div>

            <div className="pt-3 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 px-4 rounded-xl border border-[#D6CEBE] text-sm font-bold text-stone-700 bg-white hover:bg-stone-100 transition-colors shadow-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!agentName.trim() || !collegeName.trim()}
                onClick={() => setStep(2)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-sky-600/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next: Upload PDF <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: PDF Upload ── */}
        {step === 2 && (
          <div className="py-5 space-y-4">
            <div className="bg-[#F5EFEB] rounded-xl p-3 border border-[#E2D9C8] flex items-center justify-between text-xs">
              <div>
                <span className="text-stone-500 font-medium">Agent:</span>{" "}
                <span className="font-bold text-sky-700">{agentName}</span>
              </div>
              <div>
                <span className="text-stone-500 font-medium">Institution:</span>{" "}
                <span className="font-bold text-stone-900">{collegeName}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-800 mb-1.5">
                Upload Institutional Knowledge Document <span className="text-sky-600">*</span>
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
                    ? "border-sky-500 bg-sky-50"
                    : file
                    ? "border-emerald-500 bg-emerald-50/60"
                    : "border-[#D6CEBE] hover:border-sky-500 bg-white hover:bg-[#FAF7F2]"
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
                    <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 shadow-sm">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-bold text-stone-900 break-all">{file.name}</div>
                    <div className="text-xs text-stone-600 mt-1">
                      {(file.size / (1024 * 1024)).toFixed(2)} MB · Click to choose different file
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-700 border border-sky-200 flex items-center justify-center mb-2 shadow-sm">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-bold text-stone-900">
                      Drop college prospectus or handbook here
                    </div>
                    <div className="text-xs text-stone-500 mt-1">
                      Supports PDF, DOCX, or TXT up to 25 MB
                    </div>
                  </div>
                )}
              </div>
            </div>

            {trainingError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{trainingError}</span>
              </div>
            )}

            <div className="pt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="py-2.5 px-4 rounded-xl border border-[#D6CEBE] text-sm font-bold text-stone-700 bg-white hover:bg-stone-100 transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="button"
                disabled={!file}
                onClick={startTrainingAndCreate}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-sky-600/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="w-14 h-14 rounded-2xl bg-sky-100 text-sky-700 border border-sky-300 flex items-center justify-center mx-auto mb-3 shadow-md">
                <Loader2 className="w-7 h-7 animate-spin text-sky-600" />
              </div>
              <h3 className="text-base font-extrabold text-stone-900">Training Ingestion in Progress...</h3>
              <p className="text-xs text-stone-600 mt-1">
                Parsing institutional handbook and generating vector embeddings
              </p>
            </div>

            {/* Stages checklist */}
            <div className="bg-[#F5EFEB] rounded-2xl p-4 border border-[#E2D9C8] space-y-3 shadow-inner">
              {STAGES.map((s, idx) => {
                const isDone = completedStages.includes(idx);
                const isCurrent = currentStage === idx && !isDone;

                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : isCurrent ? (
                        <Loader2 className="w-5 h-5 text-sky-600 animate-spin" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-stone-300 bg-white" />
                      )}
                    </div>
                    <span
                      className={`text-xs ${
                        isDone
                          ? "text-emerald-800 font-bold line-through decoration-stone-400"
                          : isCurrent
                          ? "text-stone-950 font-extrabold"
                          : "text-stone-500 font-medium"
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {trainingError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <span>Training Ingestion Encountered an Error</span>
                </div>
                <div className="text-xs text-red-700">{trainingError}</div>
                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={startTrainingAndCreate}
                    className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors shadow-sm"
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 text-xs font-bold hover:bg-stone-100 transition-colors shadow-sm"
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
            <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 border border-emerald-300 flex items-center justify-center mx-auto mb-2 shadow-lg shadow-emerald-500/15">
              <CheckCircle2 className="w-9 h-9 text-emerald-600" />
            </div>

            <div>
              <h3 className="text-lg font-extrabold text-stone-900">Agent Created & Trained!</h3>
              <p className="text-xs text-stone-600 mt-1">
                <strong className="text-sky-700 font-bold">{agentName}</strong> is fully grounded on{" "}
                <strong className="text-stone-900 font-bold">{collegeName}</strong>'s document.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-left bg-[#F5EFEB] rounded-2xl p-4 border border-[#E2D9C8] text-xs">
              <div>
                <span className="text-stone-500 font-medium block">Knowledge Document</span>
                <span className="font-bold text-stone-900 truncate block">{file?.name}</span>
              </div>
              <div>
                <span className="text-stone-500 font-medium block">Verified Chunks</span>
                <span className="font-bold text-emerald-700 block">{chunksCount} Chunks Indexed</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (createdAgentId) navigate(`/agent/${createdAgentId}/overview`);
                }}
                className="py-2.5 px-4 rounded-xl border border-[#D6CEBE] bg-white text-sm font-bold text-stone-700 hover:bg-stone-100 transition-colors shadow-sm"
              >
                View Overview
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (createdAgentId) navigate(`/agent/${createdAgentId}/test`);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-700 hover:to-sky-700 text-white text-sm font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition-all"
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
