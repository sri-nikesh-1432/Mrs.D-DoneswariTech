import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Bot, Loader2, FileUp, Sparkles } from "lucide-react";
import { createAgent, listAgents, uploadAgentDocument } from "../services/api";
import { StatusChip } from "./Dashboard";

export default function Agents() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: agents, isLoading } = useQuery({ queryKey: ["agents"], queryFn: listAgents });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", company_name: "", calling_purpose: "Admissions and Student Enquiry", instructions: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const agent = await createAgent({
        name: form.name.trim() || "Aadhya",
        company_name: form.company_name.trim() || "Doneswari Technologies",
        calling_purpose: form.calling_purpose,
        instructions: form.instructions || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      setShowCreate(false);
      navigate(`/agent/${agent.id}/overview`);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gray-800)]">Agents</h1>
          <p className="text-sm text-[var(--gray-500)] mt-0.5">Create and manage your AI telecalling agents</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Agent
        </button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-44 rounded-[var(--radius-md)]" />)}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(agents ?? []).map((a) => (
            <Link
              key={a.id}
              to={`/agent/${a.id}/overview`}
              className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] flex items-center justify-center text-white font-bold">
                  {(a.agent_name || "A").slice(0, 1)}
                </div>
                <StatusChip status={a.status} />
              </div>
              <div className="font-semibold text-[var(--gray-800)]">{a.agent_name}</div>
              <div className="text-[12.5px] text-[var(--gray-500)] truncate">{a.name}</div>
              <div className="text-[12px] text-[var(--gray-500)] mt-0.5 truncate">{a.calling_purpose}</div>
              <div className="flex gap-4 mt-3 pt-3 border-t border-[var(--gray-100)] text-[12px] text-[var(--gray-500)]">
                <span className="flex items-center gap-1"><Bot className="w-3.5 h-3.5" /> {a.total_students ?? 0} students</span>
                <span className="flex items-center gap-1">
                  <FileUp className="w-3.5 h-3.5" />
                  {a.knowledge_ready ? "Knowledge ready" : "No knowledge"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-9 h-9 rounded-xl bg-[var(--sky-50)] text-[var(--sky-600)] flex items-center justify-center">
                <Sparkles className="w-4.5 h-4.5" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--gray-800)]">Create New Agent</h2>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <Field label="Agent Name" placeholder='e.g. "Aadhya"' value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Company / Institution" placeholder="e.g. Narayana College" value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} />
              <Field label="Calling Purpose" placeholder="Admissions and Student Enquiry" value={form.calling_purpose} onChange={(v) => setForm({ ...form, calling_purpose: v })} />
              <div>
                <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">Instructions <span className="text-[var(--gray-400)] font-normal">(optional)</span></label>
                <textarea
                  rows={3}
                  value={form.instructions}
                  onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                  placeholder="Be polite, highlight placements, mention scholarship deadlines..."
                  className="w-full bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)] resize-none"
                />
              </div>

              {error && <div className="text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

              <div className="flex gap-2.5 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 text-sm font-medium text-[var(--gray-600)] bg-[var(--gray-50)] hover:bg-[var(--gray-100)] border border-[var(--gray-200)] rounded-lg py-2.5">
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="flex-1 flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg py-2.5 disabled:opacity-60">
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />} Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
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
