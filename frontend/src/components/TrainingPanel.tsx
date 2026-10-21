import React, { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from "lucide-react";
import { uploadAgentDocument, getKnowledgeStatus, validateKnowledge } from "../services/api";
import type { KnowledgeStatus, KnowledgeValidationResult } from "../services/api";
import { useI18n } from "../i18n";

/**
 * REAL training pipeline UI (spec §9 §10 §11).
 *
 * Every displayed stage/number comes from the backend's actual ingestion
 * state — nothing is simulated. Stages: extracting → chunking → embedding →
 * indexing → validating → ready. The validation step runs the backend's
 * retrieval smoke tests and reports the REAL pass rate.
 */

const STAGE_ORDER = ["extracting", "extracted", "chunking", "embedding", "indexing", "validating", "ready"] as const;

/** Literal i18n key for each real ingestion stage (keeps `t()` type-safe). */
function stageLabelKey(s: string) {
  switch (s) {
    case "extracting": return "train.extracting" as const;
    case "extracted": return "train.extracted" as const;
    case "chunking": return "train.chunking" as const;
    case "embedding": return "train.embedding" as const;
    case "indexing": return "train.indexing" as const;
    case "validating": return "train.validating" as const;
    default: return "train.trainAgent" as const;
  }
}

interface Props {
  agentId: string;
  onReady?: () => void;
}

export default function TrainingPanel({ agentId, onReady }: Props) {
  const { t } = useI18n();
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
    <div className="glass-strong rounded-3xl p-6 shadow-2xl border border-slate-800 mb-6 text-slate-100">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-sky-400" /> {t("train.trainAgent")}
        </h2>
        {phase === "done" && validation?.validated && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/15 border border-emerald-400/30 px-3 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5" /> Knowledge validated
          </span>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Upload a knowledge document and run the REAL pipeline: extract → chunk → embed → index → validate.
      </p>

      {/* File picker + TRAIN button */}
      {phase === "idle" || phase === "failed" ? (
        <div className="flex flex-col gap-3.5">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            className="border-2 border-dashed border-slate-700 hover:border-sky-400/70 rounded-2xl py-6 flex flex-col items-center justify-center cursor-pointer transition-all bg-slate-900/60 hover:bg-slate-900/90"
          >
            {file ? (
              <div className="text-xs font-semibold text-sky-300">{file.name} — {(file.size / 1024).toFixed(0)} KB</div>
            ) : (
              <>
                <div className="text-xs font-semibold text-slate-200">Drop knowledge document or click to upload</div>
                <div className="text-[11px] text-slate-500 mt-1">PDF, DOCX, TXT — up to 20 MB</div>
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
              className="flex items-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 shadow-lg shadow-sky-500/25 disabled:opacity-40 disabled:shadow-none text-white text-xs font-bold rounded-xl px-5 py-2.5 border border-sky-400/30 transition-all cursor-pointer"
            >
              <GraduationCap className="w-4 h-4" /> {t("train.trainAgent")}
            </button>
            {phase === "failed" && (
              <button onClick={reset} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl px-4 py-2.5 border border-slate-700 transition-all">
                Reset
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Real pipeline stage display */}
      {busy && (
        <div className="space-y-2.5">
          {phase === "uploading" && (
            <div className="flex items-center gap-2.5 text-xs text-slate-300">
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
              Uploading document… {uploadPct}%
              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
            </div>
          )}
          {STAGE_ORDER.filter((s) => s !== "ready").map((s) => {
            const i = STAGE_ORDER.indexOf(s);
            const done = stageIdx > i || phase === "validating";
            const active = (stageIdx === i && phase === "processing") || (phase === "validating" && s === "validating");
            return (
              <div key={s} className={`flex items-center gap-2.5 text-xs ${done ? "text-emerald-400" : active ? "text-sky-300 font-bold" : "text-slate-500"}`}>
                {done ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : active ? <Loader2 className="w-4 h-4 animate-spin text-sky-400" /> : <span className="w-4 h-4 rounded-full border border-slate-700 inline-block" />}
                <span>{t(stageLabelKey(s))}</span>
                {s === "extracted" && status?.page_count ? (
                  <span className="text-slate-400">— {status.page_count} page(s), {status.extracted_word_count?.toLocaleString() ?? 0} words</span>
                ) : null}
                {s === "chunking" && status?.chunks ? <span className="text-slate-400">— {status.chunks.toLocaleString()} chunks created</span> : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Done */}
      {phase === "done" && (
        <div className="space-y-3.5">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Agent ready — knowledge indexed and validated
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <Stat label="Pages" value={status?.page_count ?? "—"} />
            <Stat label="Words" value={status?.extracted_word_count?.toLocaleString() ?? "—"} />
            <Stat label="Chunks" value={status?.chunks ?? 0} />
            <Stat label="Document" value={status?.document_name?.slice(0, 18) ?? "—"} />
            <Stat label="Index version" value={`v${status?.document_version ?? 1}`} />
            <Stat label="Validation" value={validation ? `${validation.pass_rate}%` : "—"} />
          </div>
          {validation && (
            <div className={`text-xs rounded-xl px-3.5 py-2.5 border ${validation.validated ? "text-emerald-300 bg-emerald-950/80 border-emerald-500/40" : "text-amber-300 bg-amber-950/80 border-amber-500/40"}`}>
              <div className="flex items-center gap-1.5 font-bold mb-1">
                {validation.validated ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {validation.tests_passed}/{validation.tests_total} retrieval tests passed
              </div>
              {validation.message}
            </div>
          )}
          <button onClick={reset} className="text-xs font-semibold text-sky-400 hover:text-sky-300">
            Upload another document
          </button>
        </div>
      )}

      {/* Error */}
      {phase === "failed" && (
        <div className="flex items-start gap-2 text-xs text-red-200 bg-red-950/80 border border-red-500/50 rounded-xl px-4 py-3">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
          <span><strong>{t("train.failed")}:</strong> {error}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2 text-center shadow-inner">
      <div className="text-sm font-bold text-sky-400 truncate">{value}</div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</div>
    </div>
  );
}
