import React, { useState } from "react";
import { Bug, Loader2, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { retrievalDebug } from "../services/api";
import type { RetrievalDebugResult } from "../services/api";

/**
 * Retrieval debug view (spec §14).
 *
 * Shows exactly what the RAG pipeline did for a question:
 *   USER QUESTION → NORMALIZED/REWRITTEN QUERY → RETRIEVED CHUNKS
 *   (document · page · section · score · preview) → RERANKED ORDER
 *   → FINAL LLM CONTEXT → FINAL ANSWER
 *
 * Every value comes from the backend's real retrieval run — nothing here is
 * simulated, which is what makes "the agent doesn't know" diagnosable.
 */
export default function RetrievalDebugPanel({ agentId }: { agentId: string | number }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<RetrievalDebugResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      setResult(await retrievalDebug(agentId, q, true));
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Retrieval debug failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <details className="glass rounded-[var(--radius-md)] p-4 shadow-[var(--shadow-sm)] mt-4">
      <summary className="flex items-center gap-2 cursor-pointer text-[13.5px] font-semibold text-[var(--gray-700)]">
        <Bug className="w-4 h-4 text-[var(--sky-600)]" /> Retrieval debug — what did the agent actually read?
      </summary>

      <div className="flex gap-2 mt-3">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="Ask something you expect to be in the uploaded document…"
          className="flex-1 h-10 px-3.5 rounded-lg border border-[var(--gray-200)] text-[13px] outline-none focus:border-[var(--sky-400)]"
        />
        <button
          onClick={run}
          disabled={loading || !question.trim()}
          className="flex items-center gap-1.5 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg px-4"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Trace
        </button>
      </div>

      {error && <div className="mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">{error}</div>}

      {result && (
        <div className="mt-4 space-y-3 text-[12.5px]">
          {/* Query resolution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Field label="Question" value={result.query} />
            <Field label="Normalized query" value={result.normalized_query} />
            <Field label="Rewritten (context-resolved) query" value={result.rewritten_query} />
            <Field
              label="Index state"
              value={result.knowledge_ready ? `${result.retrieved_count} chunk(s) retrieved` : "no chunks retrieved"}
            />
          </div>

          {/* Retrieved chunks with full provenance */}
          <div>
            <div className="font-semibold text-[var(--gray-700)] mb-1.5">
              Retrieved chunks ({result.retrieved.length})
            </div>
            {result.retrieved.length === 0 ? (
              <div className="flex items-center gap-1.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <ShieldAlert className="w-3.5 h-3.5" /> Nothing retrieved — the agent must say it doesn't have this,
                not invent it.
              </div>
            ) : (
              <div className="space-y-1.5">
                {result.retrieved.map((c, i) => (
                  <div key={`${c.chunk_id}-${i}`} className="bg-white border border-[var(--gray-100)] rounded-lg px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--gray-500)] mb-1">
                      <span className="font-semibold text-[var(--sky-700)]">chunk {c.chunk_id}</span>
                      <span>doc: {c.document ?? "—"}</span>
                      <span>page: {c.page ?? "—"}</span>
                      <span>section: {c.section ?? "—"}</span>
                      <span>score: {c.score?.toFixed(3) ?? "—"}</span>
                      <span>rerank: {c.rerank_score?.toFixed(3) ?? "—"}</span>
                    </div>
                    <div className="text-[var(--gray-700)] leading-snug">{c.text_preview}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Final context actually given to the LLM */}
          <div>
            <div className="font-semibold text-[var(--gray-700)] mb-1.5">Final LLM context (reranked)</div>
            <pre className="bg-[var(--gray-50)] border border-[var(--gray-100)] rounded-lg px-3 py-2 whitespace-pre-wrap max-h-56 overflow-y-auto text-[11.5px] text-[var(--gray-700)]">
              {result.final_context || "(empty — nothing was passed to the LLM)"}
            </pre>
          </div>

          {/* Final answer from the same grounded path the live agent uses */}
          <div>
            <div className="font-semibold text-[var(--gray-700)] mb-1.5">Final answer</div>
            {result.answer ? (
              <div className="flex items-start gap-1.5 text-[var(--gray-800)] bg-white border border-[var(--gray-100)] rounded-lg px-3 py-2">
                {result.grounded ? <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-emerald-600" /> : <ShieldAlert className="w-3.5 h-3.5 mt-0.5 text-amber-600" />}
                <span>{result.answer}</span>
              </div>
            ) : (
              <div className="text-[var(--gray-500)]">{result.answer_error ?? "—"}</div>
            )}
          </div>
        </div>
      )}
    </details>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[var(--gray-100)] rounded-lg px-3 py-2">
      <div className="text-[11px] text-[var(--gray-500)]">{label}</div>
      <div className="text-[var(--gray-800)] break-words">{value || "—"}</div>
    </div>
  );
}
