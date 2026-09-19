import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Bot, Loader2, ArrowUpRight, GraduationCap, PhoneCall, Users, TrendingUp, Clock } from "lucide-react";
import { getMe, listAgents, createAgent } from "../services/api";
import { StatusChip } from "./Dashboard";
import { useI18n } from "../i18n";

/**
 * HOME (spec §5 §19 §55): the main agent-management area.
 * Every number is queried from the agent's actual records — no fake values.
 * Empty state is honest: a fresh workspace shows zero agents.
 */
export default function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: 60_000 });
  const { data: agents, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
    refetchInterval: 15_000, // keep statuses (draft/processing/ready/published) fresh
  });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", company_name: "", calling_purpose: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const agent = await createAgent({
        name: form.name.trim(),
        company_name: form.company_name.trim(),
        calling_purpose: form.calling_purpose.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
      setShowCreate(false);
      navigate(`/agent/${agent.id}/overview`);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Workspace header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gray-800)]">
            {t("home.welcome")}{me?.user?.full_name ? `, ${me.user.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-[var(--gray-500)] mt-0.5">
            {me?.workspace?.name ?? "Your workspace"} · AI telecalling agents
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors shadow-[var(--shadow-sm)]"
        >
          <Plus className="w-4 h-4" /> {t("home.createAgent")}
        </button>
      </div>

      {/* Agents grid — REAL per-agent data (spec §5 §55) */}
      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-44 rounded-[var(--radius-md)]" />)}
        </div>
      ) : (agents ?? []).length === 0 ? (
        <div className="glass rounded-[var(--radius-md)] p-12 text-center">
          <Bot className="w-10 h-10 text-[var(--gray-300)] mx-auto mb-3" />
          <div className="text-[15px] font-semibold text-[var(--gray-700)]">{t("home.agents")}</div>
          <p className="text-[13px] text-[var(--gray-500)] mt-1.5 max-w-sm mx-auto">
            {t("home.noAgents")}
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-5 inline-flex items-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg px-5 py-2.5"
          >
            <Plus className="w-4 h-4" /> {t("home.createAgent")}
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(agents ?? []).map((a) => (
            <Link
              key={a.id}
              to={`/agent/${a.id}/overview`}
              className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] flex items-center justify-center text-white font-bold">
                  {(a.agent_name || "A").slice(0, 1)}
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={a.status} />
                  <ArrowUpRight className="w-4 h-4 text-[var(--gray-300)] group-hover:text-[var(--sky-500)] transition-colors" />
                </div>
              </div>
              <div className="font-semibold text-[var(--gray-800)]">{a.agent_name}</div>
              <div className="text-[12.5px] text-[var(--gray-500)] truncate">{a.name}</div>
              <div className="flex items-center gap-1 text-[11.5px] text-[var(--gray-500)] mt-1">
                <GraduationCap className="w-3 h-3" />
                {a.knowledge_ready ? "Knowledge ready" : "Knowledge pending"}
              </div>

              {/* Real counts from the agent's own records (spec §55) */}
              <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3.5 border-t border-[var(--gray-100)] text-center">
                <MiniStat icon={Users} value={a.total_students ?? 0} label={t("home.students")} />
                <MiniStat icon={PhoneCall} value={a.calls_completed ?? 0} label={t("home.calls")} />
                <MiniStat icon={TrendingUp} value={a.interested_count ?? 0} label={t("home.interested")} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create modal — reusable CREATE NEW AGENT flow (spec §6 §7) */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-[var(--gray-800)] mb-1">{t("home.createAgent")}</h2>
            <p className="text-[12.5px] text-[var(--gray-500)] mb-5">
              The agent starts as a DRAFT — you'll upload knowledge and train it next.
            </p>
            <form onSubmit={handleCreate} className="space-y-4">
              <Field label="Agent Name" placeholder='e.g. "Aira"' value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
              <Field label="Organization / Institution" placeholder="e.g. Narayana College" value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} required />
              <Field label="Calling Purpose" placeholder="Admissions and Student Enquiry" value={form.calling_purpose} onChange={(v) => setForm({ ...form, calling_purpose: v })} />

              {error && <div className="text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

              <div className="flex gap-2.5 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 text-sm font-medium text-[var(--gray-600)] bg-[var(--gray-50)] hover:bg-[var(--gray-100)] border border-[var(--gray-200)] rounded-lg py-2.5">
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="flex-1 flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white text-sm font-semibold rounded-lg py-2.5 disabled:opacity-60">
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />} Create Agent
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, value, label }: { icon: React.ComponentType<{ className?: string }>; value: number; label: string }) {
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-[14px] font-bold text-[var(--gray-800)]">
        <Icon className="w-3 h-3 text-[var(--gray-400)]" /> {value}
      </div>
      <div className="text-[10.5px] text-[var(--gray-500)] mt-0.5">{label}</div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange, required }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">
        {label} {required ? <span className="text-red-400">*</span> : <span className="text-[var(--gray-400)] font-normal">(optional)</span>}
      </label>
      <input
        type="text"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-[var(--gray-200)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
      />
    </div>
  );
}
