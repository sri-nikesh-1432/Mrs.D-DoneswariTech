import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area,
} from "recharts";
import { Loader2, X, PhoneCall, Clock, FileText, MessageSquare, AlertTriangle, CalendarClock } from "lucide-react";
import { getAgentAnalytics, getAgentCalls, getStudentAnalytics } from "../services/api";
import type { AgentCallRecord } from "../types";

export default function AgentAnalytics() {
  const { agentId } = useParams<{ agentId: string }>();

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["agent-analytics", agentId],
    queryFn: () => getAgentAnalytics(agentId!),
    enabled: !!agentId,
  });

  const { data: callsData } = useQuery({
    queryKey: ["agent-calls", agentId],
    queryFn: () => getAgentCalls(agentId!),
    enabled: !!agentId,
  });

  const [selectedCall, setSelectedCall] = useState<AgentCallRecord | null>(null);
  const [studentDetail, setStudentDetail] = useState<Awaited<ReturnType<typeof getStudentAnalytics>> | null>(null);

  const openStudent = async (call: AgentCallRecord) => {
    setSelectedCall(call);
    setStudentDetail(null);
    if (call.student_id && agentId) {
      try {
        const detail = await getStudentAnalytics(agentId, call.student_id);
        setStudentDetail(detail);
      } catch {
        /* transcript view still available from the call record */
      }
    }
  };

  if (isLoading || !analytics) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-4">
        <div className="skeleton h-10 w-1/3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-24 rounded-[var(--radius-md)]" />)}
        </div>
      </div>
    );
  }

  const c = analytics.cards;

  const kpis = [
    { label: "Total Students", value: c.total_students },
    { label: "Total Calls", value: c.total_calls },
    { label: "Completed", value: c.completed_calls },
    { label: "Interested", value: c.interested },
    { label: "Not Interested", value: c.not_interested },
    { label: "Follow-ups", value: c.follow_ups },
    { label: "Callbacks", value: c.callbacks },
    { label: "No Answer", value: c.no_answer },
  ];

  const latency = analytics.latency_metrics;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--gray-800)]">Analytics — {analytics.agent_name}</h1>
        <p className="text-sm text-[var(--gray-500)] mt-0.5">{analytics.company_name} · student-level call intelligence</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
        {kpis.map((k) => (
          <div key={k.label} className="glass rounded-[var(--radius-md)] p-4 shadow-[var(--shadow-sm)]">
            <div className="text-xl font-bold text-[var(--gray-800)]">{k.value}</div>
            <div className="text-[11.5px] text-[var(--gray-500)] mt-0.5">{k.label}</div>
          </div>
        ))}
        <div className="glass rounded-[var(--radius-md)] p-4 shadow-[var(--shadow-sm)] md:col-span-4 flex items-center gap-6">
          <div className="flex items-center gap-2 text-[13px] text-[var(--gray-600)]">
            <Clock className="w-4 h-4 text-[var(--sky-600)]" />
            Avg duration: <strong className="text-[var(--gray-800)]">{c.average_duration}</strong>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-[var(--gray-500)]">
            <span>STT {latency.avg_stt_ms}ms</span>
            <span>RAG {latency.avg_retrieval_ms}ms</span>
            <span>LLM {latency.avg_llm_ms}ms</span>
            <span>TTS {latency.avg_tts_ms}ms</span>
            <span className="font-semibold text-[var(--sky-700)]">Total {latency.avg_total_ms}ms</span>
          </div>
        </div>
      </div>

      {/* Charts row 1 */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        {/* Interest donut */}
        <div className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-[15px] font-semibold text-[var(--gray-800)] mb-4">Interest Distribution</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics.interest_distribution.filter((d) => d.value > 0)}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                >
                  {analytics.interest_distribution.filter((d) => d.value > 0).map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center mt-2">
            {analytics.interest_distribution.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-[11.5px] text-[var(--gray-600)]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </div>

        {/* Outcomes bar */}
        <div className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-[15px] font-semibold text-[var(--gray-800)] mb-4">Call Outcomes</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.call_outcomes} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--gray-500)" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="outcome" width={130} tick={{ fontSize: 10.5, fill: "var(--gray-600)" }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#0ea5e9" radius={[0, 6, 6, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        {/* Calls over time */}
        <div className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-[15px] font-semibold text-[var(--gray-800)] mb-4">Calls Over Time</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={analytics.calls_over_time}>
                <defs>
                  <linearGradient id="analyticsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--gray-500)" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--gray-500)" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip />
                <Area type="monotone" dataKey="calls" stroke="#0ea5e9" strokeWidth={2} fill="url(#analyticsGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Most asked questions */}
        <div className="glass rounded-[var(--radius-md)] p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-[15px] font-semibold text-[var(--gray-800)] mb-4">Most Asked Questions</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.most_asked_questions} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--gray-500)" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="question" width={150} tick={{ fontSize: 10.5, fill: "var(--gray-600)" }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Call history table */}
      <div className="glass rounded-[var(--radius-md)] shadow-[var(--shadow-sm)] overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[var(--gray-100)] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--gray-800)]">Call History</h2>
          <span className="text-[12px] text-[var(--gray-500)]">{callsData?.total ?? 0} calls</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/70 border-b border-[var(--gray-200)] text-left text-[12px] uppercase tracking-wide text-[var(--gray-500)]">
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Interest</th>
                <th className="px-4 py-3 font-semibold">Duration</th>
                <th className="px-4 py-3 font-semibold">Latency (ms)</th>
                <th className="px-4 py-3 font-semibold text-right">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {(callsData?.calls ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <PhoneCall className="w-8 h-8 text-[var(--gray-300)] mx-auto mb-2" />
                    <div className="text-sm text-[var(--gray-500)]">No calls yet — run a campaign first</div>
                  </td>
                </tr>
              ) : (
                callsData!.calls.map((call) => (
                  <tr key={call.id} className="border-b border-[var(--gray-100)] hover:bg-white/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--gray-800)]">{call.caller_name}</div>
                      <div className="text-[11.5px] text-[var(--gray-500)] font-mono">{call.caller_number}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--gray-600)]">{call.call_status}</td>
                    <td className="px-4 py-3 text-[var(--gray-600)]">{call.interest_level}</td>
                    <td className="px-4 py-3 text-[var(--gray-600)]">{call.duration_seconds}s</td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-mono text-[var(--gray-600)]">{call.latency?.total_ms ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openStudent(call)}
                        className="text-[12.5px] font-semibold text-[var(--sky-600)] hover:text-[var(--sky-700)]"
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail drawer */}
      {selectedCall && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex justify-end z-50" onClick={() => setSelectedCall(null)}>
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-[var(--gray-100)] px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-semibold text-[var(--gray-800)]">{selectedCall.caller_name}</h2>
                <div className="text-[12.5px] text-[var(--gray-500)]">
                  {selectedCall.call_status} · {selectedCall.duration_seconds}s · {selectedCall.interest_level}
                </div>
              </div>
              <button onClick={() => setSelectedCall(null)} className="p-2 rounded-lg hover:bg-[var(--gray-100)] text-[var(--gray-500)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Summary */}
              {selectedCall.summary && (
                <Section icon={FileText} title="Summary">
                  <p className="text-[13.5px] text-[var(--gray-700)] leading-relaxed">{selectedCall.summary}</p>
                </Section>
              )}

              {/* Questions */}
              {selectedCall.questions_asked?.length > 0 && (
                <Section icon={MessageSquare} title="Questions Asked">
                  <ul className="space-y-1.5">
                    {selectedCall.questions_asked.map((q, i) => (
                      <li key={i} className="text-[13px] text-[var(--gray-700)] flex gap-2">
                        <span className="text-[var(--sky-500)] font-bold">·</span> {q}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Objections */}
              {selectedCall.objections?.length > 0 && (
                <Section icon={AlertTriangle} title="Objections">
                  <div className="flex flex-wrap gap-2">
                    {selectedCall.objections.map((o, i) => (
                      <span key={i} className="text-[12px] bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2.5 py-1">{o}</span>
                    ))}
                  </div>
                </Section>
              )}

              {/* Callback */}
              {selectedCall.callback_requested && (
                <div className="flex items-center gap-2 text-[13px] text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3.5 py-2.5">
                  <CalendarClock className="w-4 h-4" /> Callback requested
                </div>
              )}

              {/* Latency audit */}
              <Section icon={Clock} title="Latency Audit">
                <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                  <LatCell label="STT" value={selectedCall.latency?.stt_ms} />
                  <LatCell label="Retrieval" value={selectedCall.latency?.retrieval_ms} />
                  <LatCell label="LLM" value={selectedCall.latency?.llm_ms} />
                  <LatCell label="TTS" value={selectedCall.latency?.tts_ms} />
                  <div className="col-span-2 flex justify-between bg-[var(--sky-50)] border border-[var(--sky-100)] rounded-lg px-3 py-2">
                    <span className="font-semibold text-[var(--sky-800)]">Total</span>
                    <span className="font-mono font-bold text-[var(--sky-800)]">{selectedCall.latency?.total_ms ?? "—"} ms</span>
                  </div>
                </div>
              </Section>

              {/* Transcript */}
              {selectedCall && (studentDetail?.calls?.length || selectedCall.summary) && (
                <Section icon={FileText} title="Transcript">
                  {studentDetail?.calls?.find((cc) => cc.id === selectedCall.call_id)?.transcript ? (
                    <pre className="text-[12.5px] whitespace-pre-wrap font-sans text-[var(--gray-700)] bg-[var(--gray-50)] border border-[var(--gray-100)] rounded-lg p-3.5 leading-relaxed">
                      {studentDetail.calls.find((cc) => cc.id === selectedCall.call_id)!.transcript}
                    </pre>
                  ) : (
                    <div className="text-[12.5px] text-[var(--gray-400)]">Transcript available in call records.</div>
                  )}
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-[var(--sky-600)]" />
        <h3 className="text-[13.5px] font-semibold text-[var(--gray-800)]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function LatCell({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex justify-between bg-[var(--gray-50)] border border-[var(--gray-100)] rounded-lg px-3 py-2">
      <span className="text-[var(--gray-600)]">{label}</span>
      <span className="font-mono text-[var(--gray-800)]">{value != null ? `${value} ms` : "—"}</span>
    </div>
  );
}
