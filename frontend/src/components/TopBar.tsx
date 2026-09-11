import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Phone, Settings, Sparkles } from "lucide-react";
import type { AgentStatus } from "../types";

interface TopBarProps {
  agentId?: string;
  agentName?: string;
  status?: AgentStatus;
}

const statusConfig: Record<AgentStatus, { label: string; dot: string; text: string; bg: string }> = {
  published: { label: "Live",     dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  ready:     { label: "Ready",    dot: "bg-sky-500",     text: "text-sky-700",     bg: "bg-sky-50 border-sky-200" },
  training:  { label: "Training", dot: "bg-amber-500",   text: "text-amber-700",   bg: "bg-amber-50 border-amber-200" },
  draft:     { label: "Draft",    dot: "bg-gray-400",    text: "text-gray-600",    bg: "bg-gray-50 border-gray-200" },
  paused:    { label: "Paused",   dot: "bg-gray-400",    text: "text-gray-600",    bg: "bg-gray-50 border-gray-200" },
};

export default function TopBar({ agentId, agentName = "Mrs.D", status = "draft" }: TopBarProps) {
  const location = useLocation();
  const sc = statusConfig[status];

  const navItems = [
    { label: "Agent",        icon: <Sparkles size={15} />, to: agentId ? `/agent/${agentId}` : "/" },
    { label: "Calls & Leads",icon: <Phone size={15} />,    to: "/calls" },
    { label: "Settings",     icon: <Settings size={15} />, to: "/settings" },
  ];

  return (
    <header
      className="w-full flex items-center justify-between px-5 py-3 shrink-0 z-30"
      style={{
        background: "rgba(255,255,255,0.82)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(186,230,253,0.5)",
        boxShadow: "0 1px 8px rgba(14,165,233,0.07)",
      }}
    >
      {/* Logo + Agent Name */}
      <div className="flex items-center gap-3">
        {/* Mrs.D Logo Mark */}
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-sm shadow-sm"
          style={{ background: "linear-gradient(135deg, #38bdf8, #0284c7)" }}
        >
          M
        </div>
        <div>
          <p className="text-sm font-bold text-gray-800 leading-tight">{agentName}</p>
          <p className="text-[10px] text-gray-400 leading-tight">AI Voice Agent</p>
        </div>

        {/* Status badge */}
        <span
          className={`hidden sm:flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${sc.bg} ${sc.text}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${status === "published" ? "animate-pulse" : ""}`} />
          {sc.label}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex items-center gap-1">
        {navItems.map((item) => {
          const active = location.pathname.startsWith(item.to.split("?")[0]) && item.to !== "/";
          const isAgent = item.to.startsWith("/agent") || item.to === "/";
          const agentActive = isAgent && (location.pathname.startsWith("/agent") || location.pathname === "/");

          return (
            <Link
              key={item.label}
              to={item.to}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-200
                ${(active || agentActive)
                  ? "bg-sky-100 text-sky-700"
                  : "text-gray-500 hover:text-sky-600 hover:bg-sky-50"}
              `}
            >
              {item.icon}
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
