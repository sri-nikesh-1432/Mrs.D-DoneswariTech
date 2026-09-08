import React from "react";

export type OrbState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "calling" | "connected" | "ended" | "error" | "greeting";

interface Props {
  state: OrbState;
}

const STATE_LABELS: Record<OrbState, string> = {
  idle: "Idle",
  connecting: "Connecting...",
  listening: "Listening...",
  thinking: "Thinking...",
  speaking: "Speaking",
  calling: "Calling...",
  connected: "Connected",
  ended: "Call ended",
  error: "Error",
  greeting: "Greeting...",
};

export default function AgentOrb({ state }: Props) {
  const cls = {
    idle: "bg-gradient-to-br from-sky-100 to-sky-50 border-sky-200",
    connecting: "bg-gradient-to-br from-sky-100 via-blue-50 to-sky-50 border-sky-300",
    listening: "bg-gradient-to-br from-sky-100 via-blue-50 to-sky-50 border-sky-400",
    thinking: "bg-gradient-to-br from-sky-100 via-indigo-50 to-sky-50 border-indigo-300",
    speaking: "bg-gradient-to-br from-sky-100 via-sky-50 to-blue-50 border-sky-500 shadow-sky-200",
    calling: "bg-gradient-to-br from-amber-100 to-orange-50 border-amber-400",
    connected: "bg-gradient-to-br from-green-100 to-emerald-50 border-green-400",
    ended: "bg-gradient-to-br from-gray-100 to-gray-50 border-gray-300",
    error: "bg-gradient-to-br from-red-100 to-rose-50 border-red-300",
  greeting: "bg-gradient-to-br from-sky-100 to-sky-50 border-sky-300",
  }[state];

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="relative w-48 h-48 sm:w-56 sm:h-56">
        {/* Ripple rings */}
        <div className={`absolute inset-0 rounded-full border-2 ${state === "calling" ? "border-amber-300 animate-ping opacity-30" : "border-transparent"} opacity-0 transition-opacity duration-500`} />
        {/* Orb core */}
        <div
          className={`orb-core ${cls} transition-all duration-500 ease-out ${
            state === "listening" ? "scale-105" : ""
          } ${state === "speaking" ? "scale-110" : ""} ${
            state === "thinking" ? "animate-pulse" : ""
          }`}
        >
          {/* Inner icon */}
          <div className="flex items-center justify-center w-full h-full">
            {state === "idle" && (
              <svg className="w-12 h-12 text-sky-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {state === "listening" && (
              <svg className="w-14 h-14 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <path d="M12 19v2" strokeWidth={2} />
              </svg>
            )}
            {state === "thinking" && (
              <svg className="w-12 h-12 text-indigo-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3v5.714a2.25 2.25 0 0 1-.659 1.591L14.25 21" />
              </svg>
            )}
            {state === "speaking" && (
              <svg className="w-14 h-14 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                <path d="M12 1a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <path d="M12 19v2" strokeWidth={2} />
              </svg>
            )}
            {state === "calling" && (
              <svg className="w-14 h-14 text-amber-500 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            )}
            {state === "connected" && (
              <svg className="w-14 h-14 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            )}
            {state === "ended" && (
              <svg className="w-12 h-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            )}
          </div>
        </div>
        {/* Ambient glow based on state */}
        <div className="absolute inset-0 rounded-full opacity-30 blur-xl" style={{
          background: state === "speaking" ? "radial-gradient(circle, rgba(58,159,214,0.4), transparent 70%)" :
                        state === "listening" ? "radial-gradient(circle, rgba(90,184,228,0.3), transparent 70%)" :
                        state === "thinking" ? "radial-gradient(circle, rgba(129,140,248,0.3), transparent 70%)" :
                        state === "calling" ? "radial-gradient(circle, rgba(245,158,11,0.3), transparent 70%)" :
                        state === "connected" ? "radial-gradient(circle, rgba(16,185,129,0.3), transparent 70%)" :
                        "radial-gradient(circle, rgba(58,159,214,0.15), transparent 70%)"
        }} />
      </div>
      <span className={`text-sm font-medium text-sky-700 ${
        state === "speaking" ? "text-sky-600" :
        state === "listening" ? "text-sky-500" :
        state === "thinking" ? "text-indigo-500" :
        state === "calling" ? "text-amber-600" :
        state === "connected" ? "text-green-600" : ""
      }`}>
        {STATE_LABELS[state]}
      </span>
    </div>
  );
}
