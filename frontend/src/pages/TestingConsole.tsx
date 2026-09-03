import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import VoiceTestingConsole from "../components/VoiceTestingConsole";

export default function TestingConsole() {
  const navigate = useNavigate();

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-[#fbf6ec] via-[#f5edde] to-[#fbf6ec] flex flex-col">
      <div className="h-11 shrink-0 border-b border-[#8f4426]/[0.08] bg-[#fbf6ec]/80 backdrop-blur-xl flex items-center px-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-[#8a7157] hover:text-[#43301f] transition-colors"
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