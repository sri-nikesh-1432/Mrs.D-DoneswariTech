import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import VoiceTestingConsole from "../components/VoiceTestingConsole";

export default function TestingConsole() {
  const navigate = useNavigate();

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#08080c] flex flex-col">
      <div className="h-11 shrink-0 border-b border-white/[0.04] bg-[#08080c]/80 backdrop-blur-xl flex items-center px-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-white/30 hover:text-white/60 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-[11px] font-medium">Back to Home</span>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <VoiceTestingConsole />
      </div>
    </div>
  );
}
