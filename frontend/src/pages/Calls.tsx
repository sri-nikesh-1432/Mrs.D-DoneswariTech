import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, TrendingUp, Users, Flame, ThermometerSun, Snowflake,
  Clock, Search, Download, ChevronRight, X, Star, MessageSquare,
  AlertCircle, Calendar
} from "lucide-react";
import TopBar from "../components/TopBar";
import { getCalls, getCallStats } from "../services/api";
import type { CallRecord, CallStats, LeadIntent } from "../types";

// ─── Stat card ────────────────────────────────────────────────────
function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number; color: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="flex flex-col gap-2 p-4 rounded-2xl"
      style={{
        background: "rgba(255,255,255,0.8)",
        border: "1px solid rgba(186,230,253,0.4)",
        boxShadow: "0 2px 12px rgba(14,165,233,0.06)",
      }}
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-xl font-bold text-gray-800">{value}</p>
        <p className="text-xs text-gray-400 font-medium">{label}</p>
      </div>
    </motion.div>
  );
}

// ─── Lead badge ───────────────────────────────────────────────────
function LeadBadge({ intent }: { intent: LeadIntent }) {
  const conf = {
    HOT:  { bg: "bg-red-50",    text: "text-red-600",    icon: <Flame size={11} />,           border: "border-red-200" },
    WARM: { bg: "bg-orange-50", text: "text-orange-600", icon: <ThermometerSun size={11} />,  border: "border-orange-200" },
    COLD: { bg: "bg-blue-50",   text: "text-blue-600",   icon: <Snowflake size={11} />,        border: "border-blue-200" },
  };
  const c = conf[intent];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${c.bg} ${c.text} ${c.border}`}>
      {c.icon}{intent}
    </span>
  );
}

// ─── Interest bar ──────────────────────────────────────────────────
function InterestBar({ value }: { value: number }) {
  const color = value >= 70 ? "#ef4444" : value >= 40 ? "#f97316" : "#3b82f6";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold text-gray-600">{value}%</span>
    </div>
  );
}

// ─── Call detail drawer ─────────────────────────────────────────
function CallDetailDrawer({ call, onClose }: { call: CallRecord; onClose: () => void }) {
  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 280, damping: 30 }}
      className="fixed right-0 top-0 h-full w-full max-w-md z-50 flex flex-col overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.97)",
        borderLeft: "1px solid rgba(186,230,253,0.5)",
        boxShadow: "-8px 0 32px rgba(14,165,233,0.1)",
      }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-sky-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-800 text-lg">{call.caller_name || "Unknown"}</h2>
          <p className="text-sm text-gray-500">{call.caller_phone}</p>
        </div>
        <div className="flex items-center gap-2">
          {call.lead_status && <LeadBadge intent={call.lead_status} />}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-2">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Scores */}
        <div className="grid grid-cols-2 gap-3">
          <ScoreBlock label="AI Interest" value={call.interest_score} color="#0ea5e9" />
          <ScoreBlock label="AI Conversion" value={call.conversion_likelihood ?? 0} color="#10b981" />
        </div>

        {/* Meta */}
        <SectionCard title="Call Details">
          <Row label="Date"     value={call.date} />
          <Row label="Duration" value={call.duration} />
          <Row label="Language" value={call.language} />
          <Row label="Course"   value={call.course ?? "—"} />
          <Row label="Outcome"  value={call.outcome} />
        </SectionCard>

        {/* Lead info */}
        {call.lead && (
          <SectionCard title="Lead Information">
            {Object.entries(call.lead).filter(([,v]) => v).map(([k, v]) => (
              <Row key={k} label={k.replace(/_/g, " ")} value={String(v)} />
            ))}
          </SectionCard>
        )}

        {/* Summary */}
        {call.summary && (
          <SectionCard title="AI Summary">
            <p className="text-sm text-gray-600 leading-relaxed">{call.summary}</p>
          </SectionCard>
        )}

        {/* Questions */}
        {call.questions_asked?.length ? (
          <SectionCard title="Questions Asked">
            <ul className="space-y-1">
              {call.questions_asked.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <MessageSquare size={12} className="text-sky-400 mt-0.5 flex-shrink-0" />
                  {q}
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}

        {/* Objections */}
        {call.objections?.length ? (
          <SectionCard title="Objections">
            <ul className="space-y-1">
              {call.objections.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <AlertCircle size={12} className="text-orange-400 mt-0.5 flex-shrink-0" />
                  {o}
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}

        {/* Next action */}
        {call.next_action && (
          <SectionCard title="Recommended Next Action">
            <p className="text-sm font-medium text-sky-700">{call.next_action}</p>
          </SectionCard>
        )}

        {/* Transcript */}
        {call.transcript?.length ? (
          <SectionCard title="Transcript">
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {call.transcript.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`text-xs px-3 py-1.5 rounded-xl max-w-[80%] ${
                    m.role === "user"
                      ? "bg-sky-500 text-white"
                      : "bg-gray-100 text-gray-700"
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : null}
      </div>
    </motion.div>
  );
}

function ScoreBlock({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-3 rounded-xl border border-sky-100 text-center">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}%</p>
      <p className="text-[10px] text-gray-400">AI-estimated</p>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-sky-100 overflow-hidden">
      <div className="px-4 py-2.5 bg-sky-50 border-b border-sky-100">
        <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-xs text-gray-400 capitalize">{label}</span>
      <span className="text-xs font-medium text-gray-700 text-right">{value}</span>
    </div>
  );
}

// ─── Main Calls page ──────────────────────────────────────────────
export default function Calls() {
  const [stats, setStats] = useState<CallStats | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | LeadIntent>("all");
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // REAL data only (spec §56 §80): no seeded/demo values. A failed load shows
  // an error; an empty result shows the honest empty state.
  useEffect(() => {
    const id = localStorage.getItem("mrsd_agent_id") ?? "1";
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    Promise.all([getCallStats(id), getCalls(id)])
      .then(([s, c]) => {
        if (cancelled) return;
        if (s) setStats(s);
        setCalls(Array.isArray(c) ? c : []);
      })
      .catch((e) => {
        if (!cancelled) setLoadError("Could not load calls — is the backend running and are you signed in?");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = calls.filter((c) => {
    const matchSearch = !search || [c.caller_name, c.caller_phone, c.course].some(
      (v) => v?.toLowerCase().includes(search.toLowerCase())
    );
    const matchFilter = filter === "all" || c.lead_status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: "linear-gradient(160deg, #f0f9ff 0%, #e0f2fe 40%, #f0f9ff 100%)" }}
    >
      <TopBar agentName="Mrs.D" />

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative">
        {/* Page title */}
        <div>
          <h1 className="text-xl font-bold text-gray-800">Calls & Leads</h1>
          <p className="text-xs text-gray-500">All conversations and lead reports from your AI agent</p>
        </div>

        {loadError && (
          <div className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{loadError}</div>
        )}

        {/* Stats grid — REAL values only (spec §56) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard icon={<Phone size={16} className="text-sky-500" />}   label="Total Calls"    value={stats?.total_calls ?? 0}     color="bg-sky-100" />
          <StatCard icon={<Phone size={16} className="text-emerald-500" />} label="Answered"     value={stats?.answered_calls ?? 0}  color="bg-emerald-100" />
          <StatCard icon={<Flame size={16} className="text-red-500" />}   label="Hot Leads"     value={stats?.hot_leads ?? 0}       color="bg-red-100" />
          <StatCard icon={<ThermometerSun size={16} className="text-orange-500" />} label="Warm Leads" value={stats?.warm_leads ?? 0} color="bg-orange-100" />
          <StatCard icon={<Snowflake size={16} className="text-blue-500" />} label="Cold Leads"  value={stats?.cold_leads ?? 0}      color="bg-blue-100" />
          <StatCard icon={<Users size={16} className="text-violet-500" />} label="Interested"   value={stats?.interested_leads ?? 0} color="bg-violet-100" />
          <StatCard icon={<TrendingUp size={16} className="text-emerald-500" />} label="Conversion" value={`${stats?.conversion_rate ?? 0}%`} color="bg-emerald-100" />
          <StatCard icon={<Clock size={16} className="text-sky-500" />}   label="Avg Duration"  value={stats?.avg_duration ?? "0:00"}    color="bg-sky-100" />
        </div>

        {/* Filters & search */}
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          {/* Search */}
          <div
            className="flex items-center gap-2 h-9 px-3 rounded-xl flex-1 max-w-xs"
            style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(186,230,253,0.5)" }}
          >
            <Search size={13} className="text-gray-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search calls..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder-gray-400"
            />
          </div>

          {/* Filter pills */}
          <div className="flex gap-1.5">
            {(["all", "HOT", "WARM", "COLD"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  filter === f
                    ? "bg-sky-500 text-white"
                    : "bg-white/70 text-gray-500 border border-sky-100 hover:bg-sky-50"
                }`}
              >
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>

          {/* Export */}
          <button
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-500 border border-sky-100 bg-white/70 hover:bg-sky-50 transition-colors"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>

        {/* Table */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(186,230,253,0.4)" }}
        >
          {/* Table header */}
          <div className="grid grid-cols-7 px-4 py-3 border-b border-sky-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            <span className="col-span-2">Caller</span>
            <span>Date</span>
            <span>Duration</span>
            <span>Interest</span>
            <span>Lead</span>
            <span>Course</span>
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              <Phone size={32} className="mx-auto mb-2 text-sky-200" />
              {loading ? "Loading calls…" : calls.length === 0 ? "No calls yet — analytics appear after real calls are made." : "No calls match your filters."}
            </div>
          ) : (
            filtered.map((call) => (
              <motion.div
                key={call.id}
                whileHover={{ backgroundColor: "rgba(224,242,254,0.4)" }}
                onClick={() => setSelectedCall(call)}
                className="grid grid-cols-7 px-4 py-3.5 border-b border-sky-50 cursor-pointer transition-colors items-center"
              >
                {/* Caller */}
                <div className="col-span-2 flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-sky-100 flex items-center justify-center text-xs font-bold text-sky-600 flex-shrink-0">
                    {(call.caller_name || "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{call.caller_name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{call.caller_phone}</p>
                  </div>
                </div>

                {/* Date */}
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Calendar size={11} className="text-sky-400" />
                  <span className="hidden sm:inline">{call.date}</span>
                </div>

                {/* Duration */}
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Clock size={11} className="text-sky-400" />
                  {call.duration}
                </div>

                {/* Interest */}
                <InterestBar value={call.interest_score} />

                {/* Lead */}
                <LeadBadge intent={call.lead_status} />

                {/* Course + chevron */}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-gray-600 truncate">{call.course ?? "—"}</span>
                  <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />
                </div>
              </motion.div>
            ))
          )}
        </div>
      </main>

      {/* Detail drawer */}
      <AnimatePresence>
        {selectedCall && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
              onClick={() => setSelectedCall(null)}
            />
            <CallDetailDrawer call={selectedCall} onClose={() => setSelectedCall(null)} />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
