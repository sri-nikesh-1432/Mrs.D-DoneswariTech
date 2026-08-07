import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import VoiceTestingConsole from "../components/VoiceTestingConsole";

export default function TestingConsole() {
  const navigate = useNavigate();

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-slate-950 via-purple-950/50 to-slate-950 flex flex-col">
      <div className="h-14 shrink-0 border-b border-white/10 bg-black/20 backdrop-blur-2xl flex items-center px-6">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Back to Home</span>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <VoiceTestingConsole />
      </div>
    </div>
  );
}
