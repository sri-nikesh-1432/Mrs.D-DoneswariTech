import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Users, PhoneCall, CheckCircle2, TrendingUp, Clock, ArrowUpRight } from "lucide-react";
import { getAgentAnalytics, listAgents } from "../services/api";

export default function Dashboard() {
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: listAgents });

  // Use first agent as primary workspace view (single-agent demo workspaces)
  const primaryAgentId = agents?.[0]?.id;
  const { data: analytics, isLoading } = useQuery({
    queryKey: ["agent-analytics", primaryAgentId],
    queryFn: () => getAgentAnalytics(primaryAgentId!),
    enabled: !!primaryAgentId,
  });

  const cards = analytics?.cards;

  const kpis = [
    { label: "Total Students", value: cards?.total_students ?? 0, icon: Users, color: "text-[var(--sky-600)] bg-[var(--sky-50)]" },
    { label: "Total Calls", value: cards?.total_calls ?? 0, icon: PhoneCall, color: "text-indigo-600 bg-indigo-50" },
    { label: "Completed", value: cards?.completed_calls ?? 0, icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
    { label: "Interested", value: cards?.interested ?? 0, icon: TrendingUp, color: "text-emerald-600 bg-emerald-50" },
    { label: "Follow-ups", value: cards?.follow_ups ?? 0, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: "Avg Duration", value: cards?.average_duration ?? "0:00", icon: Clock, color: "text-[var(--gray-600)] bg-[var(--gray-100)]" },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-[var(--gray-800)]">Dashboard</h1>
          <p className="text-sm text-[var(--gray-500)] mt-0.5">
            {analytics ? `${analytics.agent_name} · ${analytics.company_name}` : "Overall campaign analytics"}
          </p>
        </div>
        <Link
          to={primaryAgentId ? `/agent/${primaryAgentId}/analytics` : "/agents"}
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--sky-600)] hover:text-[var(--sky-700)]"
        >
          Detailed analytics <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 mb-8">
        {kpis.map((k) => (
          <div key={k.label} className="glass rounded-[var(--radius-md)] p-4 shadow-[var(--shadow-sm)]">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2.5 ${k.color}`}>
              <k.icon className="w-4 h-4" />
            </div>
            <div className="text-xl font-bold text-[var(--gray-800)]">
              {isLoading ? <span className="skeleton inline-block w-12 h-6" /> : k.value}
            </div>
            <div className="text-[11.5px] text-[var(--gray-500)] mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Calls over time */}
      <div className="glass rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-sm)] mb-6">
        <h2 className="text-[15px] font-semibold text-[var(--gray-800)] mb-4">Calls Over Time</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={analytics?.calls_over_time ?? []}>
              <defs>
                <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--gray-500)" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--gray-500)" }} axisLine={false} tickLine={false} width={28} />
              <Tooltip />
              <Area type="monotone" dataKey="calls" stroke="#0ea5e9" strokeWidth={2} fill="url(#callGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent quick cards */}
      <h2 className="text-[15px] font-semibold text-[var(--gray-800)] mb-3">Your Agents</h2>
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
            <div className="text-[12.5px] text-[var(--gray-500)]">{a.name}</div>
            <div className="flex gap-4 mt-3 text-[12px] text-[var(--gray-500)]">
              <span>{a.total_students ?? 0} students</span>
              <span>{a.calls_completed ?? 0} calls</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function StatusChip({ status }: { status?: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    published: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700" },
    ready: { bg: "bg-[var(--sky-50)] border-[var(--sky-200)]", text: "text-[var(--sky-700)]" },
    draft: { bg: "bg-[var(--gray-50)] border-[var(--gray-200)]", text: "text-[var(--gray-600)]" },
    processing: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700" },
    testing: { bg: "bg-violet-50 border-violet-200", text: "text-violet-700" },
    paused: { bg: "bg-orange-50 border-orange-200", text: "text-orange-700" },
  };
  const s = map[status ?? "draft"] ?? map.draft;
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border capitalize ${s.bg} ${s.text}`}>
      {status ?? "draft"}
    </span>
  );
}
