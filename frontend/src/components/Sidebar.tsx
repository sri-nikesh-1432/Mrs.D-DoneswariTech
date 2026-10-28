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
    <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col bg-[#FAF7F2] border-r border-[#E2D9C8] z-20 shadow-sm">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-[#E8E2D5]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 via-sky-600 to-blue-700 flex items-center justify-center text-white font-black text-sm shadow-md shadow-sky-500/20 border border-sky-400/40">
            D
          </div>
          <div className="min-w-0">
            <div className="font-extrabold text-sm text-stone-900 leading-tight tracking-tight">
              Mrs. D Telecalle<span id="telecaller-r-anchor" className="telecaller-r-target relative inline-block text-sky-600">r</span>
            </div>
            <div className="text-[11px] text-stone-500 truncate font-medium">{workspaceName || "Admissions Workspace"}</div>
          </div>
        </div>
      </div>

      {/* Global nav */}
      <nav className="px-3 pt-4 space-y-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 px-3 pb-1.5 font-mono">
          {t("nav.platform")}
        </div>
        <SideLink to="/home" icon={LayoutDashboard} label={t("nav.home")} end />
        <SideLink to="/dashboard" icon={LayoutDashboard} label={t("nav.dashboard")} end />
        <SideLink to="/agents" icon={Bot} label={t("nav.agents")} end />
        <SideLink to="/settings" icon={Settings} label={t("nav.settings")} end />
      </nav>

      {/* Agent-scoped nav */}
      {agentId && (
        <nav className="px-3 pt-5 pb-2 border-t border-[#E8E2D5] mt-3 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 px-3 pb-1.5 font-mono">
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
              className="w-full appearance-none bg-white border border-[#D6CEBE] rounded-xl px-3 py-2 pr-8 text-xs text-stone-900 font-medium focus:outline-none focus:border-sky-500 cursor-pointer shadow-sm"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id} className="bg-white text-stone-900 font-medium">
                  {a.agent_name} — {a.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500 pointer-events-none" />
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* User footer */}
      <div className="p-3 border-t border-[#E8E2D5]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-white border border-[#E2D9C8] shadow-sm">
          <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 border border-sky-300 flex items-center justify-center text-xs font-bold shadow-sm">
            {(userName || "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-stone-900 truncate">{userName || "Administrator"}</div>
            <div className="text-[10px] text-stone-500 font-medium">Live Telecaller</div>
          </div>
          <button
            onClick={handleLogout}
            title={t("nav.logout")}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-800 hover:bg-stone-100 transition-colors"
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
            ? "bg-sky-50 text-sky-700 font-bold border border-sky-200/80 shadow-sm"
            : "text-stone-700 hover:text-stone-950 hover:bg-[#F2EBE1]"
        }`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}
