import React from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import {
  LayoutDashboard, Bot, BookOpen, Users, PhoneCall, BarChart3, Settings,
  LogOut, ChevronDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listAgents, logout } from "../services/api";
import { useI18n } from "../i18n";

interface SidebarProps {
  workspaceName?: string;
  userName?: string;
  onLogout?: () => void;
}

const NAV_AGENT = [
  { to: "overview", label: "Overview", icon: Bot },
  { to: "test", label: "Voice Test", icon: PhoneCall },
  { to: "students", label: "Students", icon: Users },
  { to: "campaign", label: "Start Calls", icon: PhoneCall },
  { to: "analytics", label: "Analytics", icon: BarChart3 },
];

export default function Sidebar({ workspaceName, userName, onLogout }: SidebarProps) {
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();
  const { t } = useI18n();

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
    staleTime: 30_000,
  });

  const activeAgent = agents?.find((a) => String(a.id) === agentId);

  const handleLogout = async () => {
    onLogout?.();
    navigate("/");
  };

  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col bg-slate-950/85 backdrop-blur-2xl border-r border-slate-800/80 z-20">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-sky-500/20 border border-sky-400/30">
            D
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-white leading-tight tracking-tight">Doneswari AI</div>
            <div className="text-[11px] text-slate-400 truncate">{workspaceName || "Admissions Workspace"}</div>
          </div>
        </div>
      </div>

      {/* Global nav */}
      <nav className="px-3 pt-4 space-y-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 pb-1.5 font-mono">
          {t("nav.platform")}
        </div>
        <SideLink to="/home" icon={LayoutDashboard} label={t("nav.home")} end />
        <SideLink to="/dashboard" icon={LayoutDashboard} label={t("nav.dashboard")} end />
        <SideLink to="/agents" icon={Bot} label={t("nav.agents")} end />
        <SideLink to="/settings" icon={Settings} label={t("nav.settings")} end />
      </nav>

      {/* Agent-scoped nav */}
      {agentId && (
        <nav className="px-3 pt-5 pb-2 border-t border-slate-800/80 mt-3 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 pb-1.5 font-mono">
            Agent{activeAgent ? ` · ${activeAgent.agent_name}` : ""}
          </div>
          {NAV_AGENT.map((item) => (
            <SideLink
              key={item.to}
              to={`/agent/${agentId}/${item.to}`}
              icon={item.icon}
              label={t(`nav.${item.to === "overview" ? "overview" : item.to === "test" ? "voiceTest" : item.to === "students" ? "students" : item.to === "campaign" ? "startCalls" : "analytics"}` as never)}
            />
          ))}
        </nav>
      )}

      {/* Agent switcher */}
      {agents && agents.length > 0 && (
        <div className="px-3 mt-3">
          <div className="relative">
            <select
              value={agentId ?? ""}
              onChange={(e) => navigate(`/agent/${e.target.value}/overview`)}
              className="w-full appearance-none bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2 pr-8 text-xs text-slate-300 focus:outline-none focus:border-sky-400 cursor-pointer shadow-inner"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id} className="bg-slate-900 text-slate-200">
                  {a.agent_name} — {a.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* User footer */}
      <div className="p-3 border-t border-slate-800/80">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl bg-slate-900/50 border border-slate-800/60">
          <div className="w-8 h-8 rounded-full bg-sky-500/20 text-sky-400 border border-sky-400/30 flex items-center justify-center text-xs font-bold">
            {(userName || "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-200 truncate">{userName || "Administrator"}</div>
            <div className="text-[10px] text-slate-500">Live Telecaller</div>
          </div>
          <button
            onClick={handleLogout}
            title={t("nav.logout")}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function SideLink({
  to, icon: Icon, label, end,
}: { to: string; icon: React.ComponentType<{ className?: string }>; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
          isActive
            ? "bg-sky-500/15 text-sky-400 border border-sky-500/30 shadow-md shadow-sky-500/10 font-bold"
            : "text-slate-400 hover:bg-slate-900/80 hover:text-slate-200"
        }`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}
