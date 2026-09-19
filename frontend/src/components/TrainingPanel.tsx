import React, { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from "lucide-react";
import { uploadAgentDocument, getKnowledgeStatus, validateKnowledge } from "../services/api";
import type { KnowledgeStatus, KnowledgeValidationResult } from "../services/api";

/**
 * REAL training pipeline UI (spec §9 §10 §11).
 *
 * Every displayed stage/number comes from the backend's actual ingestion
 * state — nothing is simulated. Stages: extracting → chunking → embedding →
 * indexing → validating → ready. The validation step runs the backend's
 * retrieval smoke tests and reports the REAL pass rate.
 */

const STAGE_ORDER = ["extracting", "chunking", "embedding", "indexing", "validating", "ready"] as const;

interface Props {
  agentId: string;
  onReady?: () => void;
}

export default function TrainingPanel({ agentId, onReady }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "validating" | "done" | "failed">("idle");
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState<KnowledgeValidationResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll REAL backend status while processing (spec §11)
  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await getKnowledgeStatus(agentId);
        setStatus(s);
        if (s.status === "error") {
          setPhase("failed");
          setError(s.error || "Knowledge processing failed");
          stopPolling();
        } else if (s.status === "ready" && s.indexed) {
          stopPolling();
          await runValidation();
        }
      } catch {
        /* transient poll error — keep polling */
      }
    }, 1200);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const runValidation = async () => {
    setPhase("validating");
    try {
      const v = await validateKnowledge(agentId);
      setValidation(v);
      setPhase("done");
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-documents", agentId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-status", agentId] });
      onReady?.();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPhase("failed");
      setError(typeof detail === "string" ? detail : "Knowledge validation failed");
    }
  };

  const handleTrain = async () => {
    if (!file || !agentId) return;
    setError("");
    setValidation(null);
    setPhase("uploading");
    setUploadPct(0);
    try {
      await uploadAgentDocument(agentId, file, setUploadPct);
      setPhase("processing");
      setStatus({ stage: "extracting", status: "processing", chunks: 0, indexed: false, message: "Processing started" });
      startPolling();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPhase("failed");
      setError(typeof detail === "string" ? detail : "Upload failed");
    }
  };

  const reset = () => {
    setFile(null);
    setPhase("idle");
    setStatus(null);
    setValidation(null);
    setError("");
  };

  const stageIdx = status ? STAGE_ORDER.indexOf((status.stage || "extracting") as typeof STAGE_ORDER[number]) : -1;
  const busy = phase === "uploading" || phase === "processing" || phase === "validating";

  return (
    <div className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] mb-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[15px] font-semibold text-[var(--gray-800)] flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-[var(--sky-600)]" /> Train Agent
        </h2>
        {phase === "done" && validation?.validated && (
          <span className="flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
            <ShieldCheck className="w-3.5 h-3.5" /> Knowledge validated
          </span>
        )}
      </div>
      <p className="text-[12.5px] text-[var(--gray-500)] mb-4">
        Upload a knowledge document and run the REAL pipeline: extract → chunk → embed → index → validate. All progress reflects actual backend operations.
      </p>

      {/* File picker + TRAIN button */}
      {phase === "idle" || phase === "failed" ? (
        <div className="flex flex-col gap-3">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            className="border-2 border-dashed border-[var(--gray-300)] hover:border-[var(--sky-400)] rounded-[var(--radius-md)] py-6 flex flex-col items-center justify-center cursor-pointer transition-colors bg-white/50"
          >
            {file ? (
              <div className="text-sm text-[var(--gray-700)]">{file.name} — {(file.size / 1024).toFixed(0)} KB</div>
            ) : (
              <>
                <div className="text-sm font-medium text-[var(--gray-700)]">Drop knowledge document or click to upload</div>
                <div className="text-[12px] text-[var(--gray-500)] mt-1">PDF, DOCX, TXT, CSV, XLSX — up to 50 MB</div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={handleTrain}
              disabled={!file}
              className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-5 py-2.5"
            >
              <GraduationCap className="w-4 h-4" /> Train Agent
            </button>
            {phase === "failed" && (
              <button onClick={reset} className="text-sm font-medium text-[var(--gray-600)] bg-[var(--gray-50)] hover:bg-[var(--gray-100)] border border-[var(--gray-200)] rounded-lg px-4 py-2.5">
                Reset
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Real pipeline stage display (spec §10) */}
      {busy && (
        <div className="space-y-2.5">
          {phase === "uploading" && (
            <div className="flex items-center gap-2.5 text-[13px] text-[var(--gray-600)]">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--sky-500)]" />
              Uploading document… {uploadPct}%
              <div className="flex-1 h-1.5 bg-[var(--gray-100)] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--sky-500)] rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
            </div>
          )}
          {STAGE_ORDER.slice(0, 5).map((s, i) => {
            const done = stageIdx > i || phase === "validating";
            const active = (stageIdx === i && phase === "processing") || (phase === "validating" && s === "validating");
            return (
              <div key={s} className={`flex items-center gap-2.5 text-[13px] ${done ? "text-emerald-700" : active ? "text-[var(--sky-700)] font-semibold" : "text-[var(--gray-400)]"}`}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="w-4 h-4 rounded-full border border-[var(--gray-300)] inline-block" />}
                <span className="capitalize">{s === "indexing" ? "Building knowledge index" : s === "validating" ? "Validating knowledge" : `${s}…`}</span>
                {s === "chunking" && status?.chunks ? <span className="text-[var(--gray-500)]">— {status.chunks.toLocaleString()} chunks created</span> : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Done — REAL numbers (spec §10: do not fake values) */}
      {phase === "done" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-emerald-700">
            <CheckCircle2 className="w-4.5 h-4.5" /> Agent ready — knowledge indexed and validated
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Chunks" value={status?.chunks ?? 0} />
            <Stat label="Document" value={status?.document_name?.slice(0, 18) ?? "—"} />
            <Stat label="Index version" value={`v${status?.document_version ?? 1}`} />
            <Stat label="Validation" value={validation ? `${validation.pass_rate}%` : "—"} />
          </div>
          {validation && (
            <div className={`text-[12.5px] rounded-lg px-3.5 py-2.5 border ${validation.validated ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-amber-800 bg-amber-50 border-amber-200"}`}>
              <div className="flex items-center gap-1.5 font-semibold mb-1">
                {validation.validated ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {validation.tests_passed}/{validation.tests_total} retrieval tests passed
              </div>
              {validation.message}
            </div>
          )}
          <button onClick={reset} className="text-[13px] font-medium text-[var(--sky-600)] hover:underline">
            Upload another document
          </button>
        </div>
      )}

      {/* REAL error (spec §78) */}
      {phase === "failed" && (
        <div className="flex items-start gap-2 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span><strong>Training failed:</strong> {error}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-[var(--gray-100)] rounded-lg px-3.5 py-2.5">
      <div className="text-[15px] font-bold text-[var(--gray-800)] truncate">{value}</div>
      <div className="text-[11px] text-[var(--gray-500)]">{label}</div>
    </div>
  );
}
