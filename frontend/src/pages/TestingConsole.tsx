import React from "react";
import { useNavigate } from "react-router-dom";
import VoiceTestingConsole from "../components/VoiceTestingConsole";

export default function TestingConsole() {
  const navigate = useNavigate();

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <VoiceTestingConsole />
    </div>
  );
}
