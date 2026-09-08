import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listCalls, getCallWithReport } from "../services/api";

export default function Calls() {
  const navigate = useNavigate();
  const { instituteId } = useParams<{ instituteId: string }>();
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [filter, setFilter] = useState<"ALL" | "HOT" | "WARM" | "COLD">("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!instituteId) {
      setLoading(false);
      return;
    }
    listCalls(Number(instituteId))
      .then((data) => setCalls(data.calls || []))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [instituteId]);

  const summary = {
    totalCalls: calls.length,
    answeredCalls: calls.filter((c) => c.call_status === "completed").length,
    missedCalls: calls.filter((c) => c.call_status === "missed").length,
    interestedLeads: 0,
    hotLeads: 0,
    warmLeads: 0,
    coldLeads: 0,
    conversionRate: 0,
    avgDuration: 0,
  };
  if (calls.length > 0) {
    const withReport = calls.filter((c) => c.report);
    summary.interestedLeads = withReport.filter((c) => (c.report?.interest_score || 0) > 60).length;
    summary.hotLeads = withReport.filter((c) => c.report?.intent === "HOT").length;
    summary.warmLeads = withReport.filter((c) => c.report?.intent === "WARM").length;
    summary.coldLeads = withReport.filter((c) => c.report?.intent === "COLD").length;
    summary.conversionRate = Math.round((summary.answeredCalls / summary.totalCalls) * 100);
    summary.avgDuration = Math.round(
      calls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / calls.length
    );
  }

  const filteredCalls = calls.filter((c) => {
    if (filter === "ALL") return true;
    return c.report?.intent === filter;
  });

  return (
    <div className="h-screen w-full flex flex-col bg-sky-50 overflow-hidden">
      {/* Top bar */}
      <header className="glass-nav px-4 py-3 flex items-center justify-between z-20 border-b border-sky-200/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost-premium text-xs"
            onClick={() => navigate("/agent/1")}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-sky-900">Mrs.D</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost-premium text-xs" onClick={() => navigate("/settings")}>Settings</button>
          <div className="w-7 h-7 rounded-full bg-sky-200 text-sky-700 text-xs font-medium flex items-center justify-center">U</div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <h1 className="text-xl font-semibold text-sky-900">Calls & Leads</h1>
            <p className="text-sm text-sky-600">All incoming calls and lead information.</p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Total Calls" value={summary.totalCalls} color="sky" />
            <StatCard label="Interested Leads" value={summary.interestedLeads} color="amber" />
            <StatCard label="Hot Leads" value={summary.hotLeads} color="red" />
            <StatCard label="Conversion Rate" value={`${summary.conversionRate}%`} color="green" />
          </div>

          {/* Filter */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {(["ALL", "HOT", "WARM", "COLD"] as const).map((f) => (
              <button
                key={f}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  filter === f
                    ? "bg-sky-600 text-white shadow-sm"
                    : "bg-white text-sky-600 border border-sky-200 hover:bg-sky-50"
                }`}
                onClick={() => setFilter(f)}
              >
                {f === "ALL" ? "All" : f}
              </button>
            ))}
          </div>

          {/* Call history table */}
          <div className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-sky-50/80 text-sky-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Caller</th>
                  <th className="text-left px-4 py-3 font-medium">Student</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Course</th>
                  <th className="text-left px-4 py-3 font-medium">Interest</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Duration</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-100">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-sky-200 rounded w-3/4" /></td>
                      ))}
                    </tr>
                  ))
                ) : filteredCalls.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sky-400 text-sm">No calls yet</td>
                  </tr>
                ) : (
                  filteredCalls.map((call) => {
                    const report = call.report;
                    const intent = report?.intent || "COLD";
                    return (
                      <tr
                        key={call.call_id}
                        className="hover:bg-sky-50/40 cursor-pointer transition-colors"
                        onClick={() => {
                          setSelectedCall(call);
                          if (!report) {
                            getCallWithReport(call.call_id).then((full) => setSelectedCall(full));
                          }
                        }}
                      >
                        <td className="px-4 py-3 font-medium text-sky-900">{call.caller_name || call.caller_number}</td>
                        <td className="px-4 py-3 text-sky-700">{report?.student_name || "—"}</td>
                        <td className="px-4 py-3 text-sky-700 hidden sm:table-cell">{report?.course || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-sky-100 overflow-hidden">
                              <div className={`h-full rounded-full ${interestColor(report?.interest_score || 0)}`} style={{ width: `${(report?.interest_score || 0)}%` }} />
                            </div>
                            <span className="text-xs text-sky-500 font-medium">{report?.interest_score || 0}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            intent === "HOT" ? "bg-red-100 text-red-700" :
                            intent === "WARM" ? "bg-amber-100 text-amber-700" :
                            "bg-sky-100 text-sky-600"
                          }`}>
                            {report?.lead_status || "NEW"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sky-600 hidden sm:table-cell">{formatDuration(call.duration_seconds || 0)}</td>
                        <td className="px-4 py-3 text-right">
                          <button className="text-xs text-sky-500 hover:text-sky-700 font-medium">View</button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Call detail panel */}
        {selectedCall && (
          <aside className="w-80 bg-white/80 border-l border-sky-200/50 p-4 overflow-y-auto flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-sky-900">Call Report</h2>
              <button className="text-xs text-sky-500 hover:text-sky-700" onClick={() => setSelectedCall(null)}>Close</button>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold text-sky-900">{selectedCall.caller_name || selectedCall.caller_number}</div>
                <div className="text-xs text-sky-500">{selectedCall.caller_number}</div>
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  selectedCall.report?.intent === "HOT" ? "bg-red-100 text-red-700" :
                  selectedCall.report?.intent === "WARM" ? "bg-amber-100 text-amber-700" :
                  "bg-sky-100 text-sky-600"
                }`}>
                  {selectedCall.report?.lead_status || "NEW LEAD"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-sky-50/50 rounded-xl p-3">
                  <div className="text-[10px] text-sky-400 uppercase">Student</div>
                  <div className="font-medium text-sky-900">{selectedCall.report?.student_name || "—"}</div>
                </div>
                <div className="bg-sky-50/50 rounded-xl p-3">
                  <div className="text-[10px] text-sky-400 uppercase">Class</div>
                  <div className="font-medium text-sky-900">{selectedCall.report?.student_class || "—"}</div>
                </div>
                <div className="bg-sky-50/50 rounded-xl p-3">
                  <div className="text-[10px] text-sky-400 uppercase">Course</div>
                  <div className="font-medium text-sky-900">{selectedCall.report?.course || "—"}</div>
                </div>
                <div className="bg-sky-50/50 rounded-xl p-3">
                  <div className="text-[10px] text-sky-400 uppercase">Location</div>
                  <div className="font-medium text-sky-900">{selectedCall.report?.location || "—"}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-sky-400 uppercase mb-1.5">Interest Score</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-sky-100 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-red-400" style={{ width: `${(selectedCall.report?.interest_score || 0)}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-sky-700">{selectedCall.report?.interest_score || 0}%</span>
                  <span className="text-xs text-sky-400">AI-estimated</span>
                </div>
              </div>

              <div>
                <div className="text-xs text-sky-400 uppercase mb-1.5">Conversion Likelihood</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-sky-100 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-500" style={{ width: `${(selectedCall.report?.conversion_probability || 0)}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-sky-700">{selectedCall.report?.conversion_probability || 0}%</span>
                  <span className="text-xs text-sky-400">AI-estimated</span>
                </div>
              </div>

              {selectedCall.report?.questions_asked?.length > 0 && (
                <div>
                  <div className="text-xs text-sky-400 uppercase mb-1.5">Questions Asked</div>
                  <div className="space-y-1">
                    {selectedCall.report.questions_asked.map((q: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-sky-700">
                        <span className="text-sky-300 mt-0.5">•</span>
                        {q}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedCall.report?.objections?.length > 0 && (
                <div>
                  <div className="text-xs text-sky-400 uppercase mb-1.5">Objections</div>
                  <div className="space-y-1">
                    {selectedCall.report.objections.map((o: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-sky-700">
                        <span className="text-red-300 mt-0.5">•</span>
                        {o}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs text-sky-400 uppercase mb-1.5">Next Action</div>
                <div className="text-sm font-medium text-sky-900">{selectedCall.report?.next_action || "—"}</div>
              </div>

              <div>
                <div className="text-xs text-sky-400 uppercase mb-1.5">Summary</div>
                <p className="text-sm text-sky-700 leading-relaxed">{selectedCall.report?.summary || "—"}</p>
              </div>

              <div className="pt-2 border-t border-sky-100">
                <div className="text-[10px] text-sky-400">Call date</div>
                <div className="text-xs text-sky-600">{new Date(selectedCall.started_at).toLocaleString()}</div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colors = {
    sky: "bg-sky-100 text-sky-600",
    amber: "bg-amber-100 text-amber-600",
    red: "bg-red-100 text-red-600",
    green: "bg-green-100 text-green-600",
  };
  return (
    <div className={`rounded-2xl p-4 ${colors[color as keyof typeof colors]}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function interestColor(p: number) {
  if (p >= 70) return "bg-red-400";
  if (p >= 45) return "bg-amber-400";
  return "bg-sky-300";
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
