import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

interface Lead {
  id: string;
  caller: string;
  phone: string;
  student: string;
  className: string;
  course: string;
  location: string;
  hostel: string;
  transport: string;
  interest: number;
  status: "HOT" | "WARM" | "COLD" | "NEW";
  summary: string;
  questions: string[];
  objections: string[];
  nextAction: string;
  createdAt: string;
  durationSeconds: number;
}

const MOCK_LEADS: Lead[] = [
  {
    id: "c001",
    caller: "Rahul",
    phone: "+91 98765 43210",
    student: "Aarav",
    className: "VIII",
    course: "eTechno",
    location: "Hyderabad",
    hostel: "Interested",
    transport: "Asked about availability",
    interest: 82,
    status: "HOT",
    summary: "Caller is actively exploring admission for their Class VIII child. They showed strong interest in the eTechno programme and asked about hostel and admission process.",
    questions: ["Fee?", "Hostel?", "Admission procedure?", "Campus location?"],
    objections: ["Fee clarification"],
    nextAction: "Campus visit",
    createdAt: "2026-09-07T10:15:00Z",
    durationSeconds: 243,
  },
  {
    id: "c002",
    caller: "Priya",
    phone: "+91 98765 11111",
    student: "Kavya",
    className: "VI",
    course: "eChamps",
    location: "Hyderabad",
    hostel: "No",
    transport: "Maybe",
    interest: 64,
    status: "WARM",
    summary: "Caller enquiring about Class VI programme. Interested in eChamps, asked about transport availability.",
    questions: ["What programmes for Class VI?", "Transport facility?"],
    objections: [],
    nextAction: "Send information",
    createdAt: "2026-09-06T14:22:00Z",
    durationSeconds: 180,
  },
  {
    id: "c003",
    caller: "Srinivas",
    phone: "+91 98765 22222",
    student: "",
    className: "",
    course: "",
    location: "",
    hostel: "",
    transport: "",
    interest: 25,
    status: "COLD",
    summary: "Caller just exploring, not ready to commit. Suggested callback in 3 months.",
    questions: ["General info"],
    objections: ["Timing"],
    nextAction: "Callback",
    createdAt: "2026-09-05T09:10:00Z",
    durationSeconds: 90,
  },
];

export default function Calls() {
  const navigate = useNavigate();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [filter, setFilter] = useState<"ALL" | "HOT" | "WARM" | "COLD">("ALL");
  const leads = MOCK_LEADS.filter((l) => filter === "ALL" || l.status === filter);

  const summary = {
    totalCalls: MOCK_LEADS.length,
    answeredCalls: 2,
    missedCalls: 0,
    interestedLeads: MOCK_LEADS.filter((l) => l.interest > 60).length,
    hotLeads: MOCK_LEADS.filter((l) => l.status === "HOT").length,
    warmLeads: MOCK_LEADS.filter((l) => l.status === "WARM").length,
    coldLeads: MOCK_LEADS.filter((l) => l.status === "COLD").length,
    conversionRate: 65,
    avgDuration: Math.round(MOCK_LEADS.reduce((s, l) => s + l.durationSeconds, 0) / MOCK_LEADS.length),
  };

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
                {f !== "ALL" && <span className="ml-1 opacity-60">({MOCK_LEADS.filter((l) => l.status === f).length})</span>}
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
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="hover:bg-sky-50/40 cursor-pointer transition-colors"
                    onClick={() => setSelectedLead(lead)}
                  >
                    <td className="px-4 py-3 font-medium text-sky-900">{lead.caller}</td>
                    <td className="px-4 py-3 text-sky-700">{lead.student || "—"}</td>
                    <td className="px-4 py-3 text-sky-700 hidden sm:table-cell">{lead.course || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-sky-100 overflow-hidden">
                          <div className={`h-full rounded-full ${interestColor(lead.interest)}`} style={{ width: `${lead.interest}%` }} />
                        </div>
                        <span className="text-xs text-sky-500 font-medium">{lead.interest}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        lead.status === "HOT" ? "bg-red-100 text-red-700" :
                        lead.status === "WARM" ? "bg-amber-100 text-amber-700" :
                        "bg-sky-100 text-sky-600"
                      }`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sky-600 hidden sm:table-cell">{formatDuration(lead.durationSeconds)}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-xs text-sky-500 hover:text-sky-700 font-medium">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {leads.length === 0 && (
              <div className="p-8 text-center text-sky-400 text-sm">No calls yet</div>
            )}
          </div>
        </div>

        {/* Lead detail panel */}
        {selectedLead && (
          <aside className="w-80 bg-white/80 border-l border-sky-200/50 p-4 overflow-y-auto flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-sky-900">Lead Details</h2>
              <button className="text-xs text-sky-500 hover:text-sky-700" onClick={() => setSelectedLead(null)}>Close</button>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-lg font-semibold text-sky-900">{selectedLead.caller}</div>
                <div className="text-xs text-sky-500">{selectedLead.phone}</div>
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  selectedLead.status === "HOT" ? "bg-red-100 text-red-700" :
                  selectedLead.status === "WARM" ? "bg-amber-100 text-amber-700" :
                  "bg-sky-100 text-sky-600"
                }`}>
                  {selectedLead.status} LEAD
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-sky-50/50 rounded-xl p-3">
                  <div className="text-[10px] text-sky-400 uppercase">Student</div>
                  <div className="font-medium text-sky-900">{selectedLead.student || "—"}</div>
                </div>
                <div className="bg-sky-50/50 rounded-xl p-3">
                  <div className="text-[10px] text-sky-400 uppercase">Class</div>
                  <div className="font-medium text-sky-900">{selectedLead.className || "—"}</div>
                </div>
                <div className="bg-sky-50/50 rounded-xl p-3">
                  <div className="text-[10px] text-sky-400 uppercase">Course</div>
                  <div className="font-medium text-sky-900">{selectedLead.course || "—"}</div>
                </div>
                <div className="bg-sky-50/50 rounded-xl p-3">
                  <div className="text-[10px] text-sky-400 uppercase">Location</div>
                  <div className="font-medium text-sky-900">{selectedLead.location || "—"}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-sky-400 uppercase mb-1">Interest</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-sky-100 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-red-400" style={{ width: `${selectedLead.interest}%` }} />
                  </div>
                  <span className="text-sm font-semibold text-sky-700">{selectedLead.interest}%</span>
                </div>
              </div>

              {selectedLead.questions.length > 0 && (
                <div>
                  <div className="text-xs text-sky-400 uppercase mb-1.5">Questions Asked</div>
                  <div className="space-y-1">
                    {selectedLead.questions.map((q, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-sky-700">
                        <span className="text-sky-300 mt-0.5">•</span>
                        {q}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedLead.objections.length > 0 && (
                <div>
                  <div className="text-xs text-sky-400 uppercase mb-1.5">Objections</div>
                  <div className="space-y-1">
                    {selectedLead.objections.map((o, i) => (
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
                <div className="text-sm font-medium text-sky-900">{selectedLead.nextAction}</div>
              </div>

              <div>
                <div className="text-xs text-sky-400 uppercase mb-1.5">Summary</div>
                <p className="text-sm text-sky-700 leading-relaxed">{selectedLead.summary}</p>
              </div>

              <div className="pt-2 border-t border-sky-100">
                <div className="text-[10px] text-sky-400">Call date</div>
                <div className="text-xs text-sky-600">{new Date(selectedLead.createdAt).toLocaleString()}</div>
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
