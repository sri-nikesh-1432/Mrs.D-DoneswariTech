import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Play,
  Zap,
  Brain,
  Volume2,
  User,
  Bot,
  Loader2,
  Mic,
  Send,
  Globe,
  Phone,
  PhoneOff,
  Maximize2,
  Activity,
  MessageSquare,
  Terminal,
  ArrowLeft,
} from "lucide-react";
import { useVoiceAgent } from "../hooks/useVoiceAgent";
import Markdown from "./Markdown";
import LanguageSwitcher from "./LanguageSwitcher";
import VoiceWaveform from "./VoiceWaveform";
import { useTranslation } from "../i18n";
import { saveSimulatorCall } from "../services/api";

const STAGE_LABEL_KEYS: Record<string, string> = {
  connecting: "connecting",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  idle: "idle",
  error: "error",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type ConsoleTab = "pipeline" | "log" | "commands";

export default function VoiceTestingConsole() {
  const navigate = useNavigate();
  const { t, lang } = useTranslation();
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("pipeline");

  const KNOWLEDGE_FILE = "institute.json";

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef(Date.now());

  const {
    callStage,
    fsmState,
    messages,
    inputText,
    setInputText,
    isListening,
    debugInfo,
    detectedLanguage,
    error,
    conversationId,
    startCall,
    endCall,
    sendMessage,
    toggleListening,
    audioRef,
    isUserSpeaking,
    partialTranscript,
    voiceStats,
    micLevelsRef,
    aiLevelsRef,
  } = useVoiceAgent({ mode: "test", knowledgeFile: KNOWLEDGE_FILE, initialLanguage: lang });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = logScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (callStage === "connecting") startedAtRef.current = Date.now();
  }, [callStage]);

  useEffect(() => {
    return () => {
      endCall();
    };
  }, [endCall]);

  const handleEnd = async () => {
    const transcript = messages.map((m) => ({
      speaker: m.role === "user" ? "USER" : "AI",
      text: m.content,
    }));
    const duration = Math.max(
      1,
      Math.floor((Date.now() - startedAtRef.current) / 1000)
    );
    try {
      await saveSimulatorCall({
        call_id: conversationId.current,
        institute_id: 1,
        duration,
        language: detectedLanguage,
        status: "completed",
        transcript,
      });
    } catch (e) {
      console.error("Failed to save call:", e);
    }
    await endCall();
  };

  // ── Error State ──────────────────────────────────────────────────────────
  if (callStage === "error") {
    return (
      <div className="h-full w-full flex items-center justify-center p-6 bg-gradient-to-br from-[#fbf6ec] via-[#f5edde] to-[#fbf6ec]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card-static p-10 max-w-sm w-full text-center"
        >
          <PhoneOff className="w-10 h-10 text-[#b03a24] mx-auto mb-4" />
          <h1 className="text-lg font-bold mb-2 text-[#43301f]">{t("error")}</h1>
          <p className="text-sm text-[#8a7157] mb-6">
            {error || "Is the backend running? Please retry or go back."}
          </p>
          <div className="space-y-2">
            <button onClick={() => startCall()} className="btn-glow w-full">
              <Play className="w-4 h-4 relative z-10" />
              <span className="relative z-10">{t("retry")}</span>
            </button>
            <button
              onClick={() => navigate("/testing-console")}
              className="w-full h-10 rounded-xl text-xs font-medium text-[#8a7157] hover:text-[#43301f] hover:bg-[#8f4426]/[0.05] transition-all border border-[#8f4426]/[0.12]"
            >
              {t("backToConsole")}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Idle State ───────────────────────────────────────────────────────────
  if (callStage === "idle") {
    return (
      <div className="h-full w-full flex items-center justify-center p-6 bg-gradient-to-br from-[#fbf6ec] via-[#f5edde] to-[#fbf6ec]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card-static p-8 max-w-md w-full"
        >
          <div className="text-center space-y-5">
            {/* Orb — warm cognac style */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 150 }}
              className="orb-container mx-auto"
            >
              <div className="orb-core">
                <Bot className="w-10 h-10 text-[#a85a32]/60" />
              </div>
              <div className="orb-ripple" />
            </motion.div>

            <div>
              <h1 className="text-2xl font-bold text-[#43301f] tracking-tight">
                {t("testingConsole")}
              </h1>
              <p className="text-sm text-[#8a7157] mt-1">
                Developer mode with hardcoded knowledge
              </p>
            </div>

            <div className="bg-[#8f4426]/[0.03] border border-[#8f4426]/[0.08] rounded-xl px-4 py-3 max-w-sm mx-auto">
              <div className="text-[10px] text-[#9c8369] uppercase tracking-wider mb-0.5 text-left">
                {t("knowledgeSource")}
              </div>
              <div className="font-mono text-[#a85a32]/80 text-xs text-left break-all">
                backend/knowledge/institute.json
              </div>
              <div className="text-[10px] text-[#9c8369] mt-1 text-left">
                Hardcoded · for developers only · never merged with uploaded PDFs
              </div>
            </div>

            <button
              onClick={() => startCall()}
              className="btn-glow px-8 mx-auto"
            >
              <Phone className="w-4 h-4 relative z-10" />
              <span className="relative z-10">{t("startVoiceAgent")}</span>
            </button>

            <div className="flex items-center justify-center gap-4 text-[11px] text-[#8a7157]">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-[#3e9b6e]/60" />
                Continuous voice
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-[#3a9fd6]/60" />
                Auto language
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-[#a85a32]/60" />
                Real-time STT & TTS
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Active Call State ────────────────────────────────────────────────────
  const stageColor =
    callStage === "listening"
      ? "text-[#3a9fd6]"
      : callStage === "thinking"
      ? "text-[#a85a32]"
      : callStage === "speaking"
      ? "text-[#2b82b5]"
      : "text-[#d9822b]";

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-gradient-to-br from-[#fbf6ec] via-[#f5edde] to-[#fbf6ec]">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="h-11 shrink-0 border-b border-[#8f4426]/[0.08] bg-[#fbf6ec]/80 backdrop-blur-xl flex items-center gap-2 px-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 text-[#8a7157] hover:text-[#43301f] transition-colors shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium">{t("back")}</span>
        </button>

        <div className="h-3.5 w-px bg-[#8f4426]/[0.12]" />

        <div className="flex items-center gap-1.5 font-mono text-[#a85a32]/70 text-[11px] truncate">
          <Terminal className="w-3 h-3 shrink-0" />
          <span className="truncate">{KNOWLEDGE_FILE}</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#8f4426]/[0.04] border border-[#8f4426]/[0.08]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              callStage === "listening"
                ? "bg-[#3a9fd6]"
                : callStage === "thinking"
                ? "bg-[#a85a32] animate-pulse"
                : callStage === "speaking"
                ? "bg-[#2b82b5]"
                : "bg-[#d9822b] animate-pulse"
            }`}
          />
          <span className={`text-[11px] font-medium ${stageColor}`}>
            {t(STAGE_LABEL_KEYS[callStage] || "idle")}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#8f4426]/[0.04] border border-[#8f4426]/[0.08]">
          <Globe className="w-3 h-3 text-[#8a7157]" />
          <span className="text-[11px] text-[#5c4632]">{detectedLanguage}</span>
        </div>

        <LanguageSwitcher compact />

        <button
          onClick={handleEnd}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#c1442e]/10 text-[#b03a24] border border-[#c1442e]/20 rounded-lg hover:bg-[#c1442e]/15 transition-all shrink-0"
        >
          <PhoneOff className="w-3 h-3" />
          <span className="text-[11px] font-medium">{t("endCall")}</span>
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Call UI */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Orb */}
          <div className="flex flex-col items-center pt-4 pb-2 shrink-0">
            <div className="relative">
              <div
                className={`absolute inset-0 rounded-full blur-2xl transition-all duration-700 ${
                  callStage === "listening"
                    ? "bg-[#3a9fd6]/15"
                    : callStage === "thinking"
                    ? "bg-[#a85a32]/15"
                    : callStage === "speaking"
                    ? "bg-[#3a9fd6]/20"
                    : "bg-transparent"
                }`}
              />
              <div
                className={`orb-core ${
                  isUserSpeaking
                    ? "listening"
                    : callStage === "listening"
                    ? "listening"
                    : callStage === "thinking"
                    ? "thinking"
                    : callStage === "speaking"
                    ? "speaking"
                    : ""
                }`}
                style={{ width: 140, height: 140 }}
              >
                {callStage === "connecting" && (
                  <Loader2 className="w-8 h-8 text-[#d9822b] animate-spin" />
                )}
                {callStage === "listening" && (
                  <Mic className="w-8 h-8 text-[#3a9fd6]/70" />
                )}
                {callStage === "thinking" && (
                  <Brain className="w-8 h-8 text-[#a85a32] animate-pulse" />
                )}
                {callStage === "speaking" && (
                  <Volume2 className="w-8 h-8 text-[#3a9fd6]/70" />
                )}
              </div>
            </div>

            <div className="w-full max-w-sm mt-2">
              <VoiceWaveform
                levelsRef={callStage === "speaking" ? aiLevelsRef : micLevelsRef}
                active={callStage === "listening" || callStage === "speaking"}
              color={
                callStage === "speaking"
                  ? "ai"
                  : isUserSpeaking
                  ? "user"
                  : undefined
              }
                className="w-full h-10"
              />
              {callStage === "listening" && isUserSpeaking && (
                <div className="text-center text-[10px] font-medium text-[#a85a32]/70 mt-1">
                  You're speaking… (any voice — Telugu, Hindi, Tamil, English)
                </div>
              )}
              {isUserSpeaking && partialTranscript && (
                <div className="text-center text-[11px] text-[#5c4632] mt-1 px-3 py-1.5 bg-[#8f4426]/[0.03] border border-[#a85a32]/15 rounded-lg truncate">
                  <span className="text-[#a85a32]/70 mr-1">›</span>
                  {partialTranscript}
                </div>
              )}
            </div>
          </div>

          {/* Conversation */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-5 py-2 space-y-2.5 scroll-smooth"
          >
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`${msg.timestamp}-${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex gap-2 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`flex gap-2 max-w-[75%] min-w-0 ${
                      msg.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "user"
                          ? "bg-[#a85a32]/10 text-[#a85a32]/70 border border-[#a85a32]/15"
                          : "bg-[#3a9fd6]/10 text-[#3a9fd6]/70 border border-[#3a9fd6]/15"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-3.5 h-3.5" />
                      ) : (
                        <Bot className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div
                      className={`px-3.5 py-2.5 rounded-2xl min-w-0 break-words text-sm ${
                        msg.role === "user"
                          ? "bg-[#a85a32]/8 border border-[#a85a32]/15"
                          : "bg-[#faf4e8]/80 border border-[#8f4426]/[0.1]"
                      }`}
                    >
                      {msg.role === "ai" ? (
                        <Markdown text={msg.content} />
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap text-[#43301f]">
                          {msg.content}
                        </p>
                      )}
                      <div className="mt-1 text-[10px] text-[#9c8369] text-right">
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Error banner */}
          {error && (
            <div className="shrink-0 px-3 pt-2">
              <div className="max-w-4xl mx-auto flex items-center gap-2 bg-[#d9822b]/[0.06] border border-[#d9822b]/[0.15] text-[#b06a1f] text-[11px] px-3 py-2 rounded-lg">
                <Terminal className="w-3 h-3 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="shrink-0 border-t border-[#8f4426]/[0.08] bg-[#f5edde]/60 backdrop-blur-xl p-3">
            <div className="flex gap-2 max-w-4xl mx-auto">
              <button
                onClick={toggleListening}
                disabled={callStage !== "listening"}
                className={`p-2.5 rounded-xl transition-all shrink-0 ${
                  isListening
                    ? "bg-[#c1442e]/10 text-[#b03a24] border border-[#c1442e]/25"
                    : "bg-[#8f4426]/[0.05] text-[#8a7157] border border-[#8f4426]/[0.12] hover:bg-[#8f4426]/[0.08]"
                } disabled:opacity-30`}
                title={isListening ? "Stop listening" : "Start listening"}
              >
                <Mic className="w-4 h-4" />
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder={t("typeMessage")}
                disabled={callStage !== "listening"}
                className="flex-1 px-4 py-2.5 bg-[#8f4426]/[0.05] border border-[#8f4426]/[0.12] rounded-xl text-sm text-[#43301f] focus:outline-none focus:border-[#a85a32]/40 disabled:opacity-30 min-w-0 placeholder:text-[#9c8369]"
              />

              <button
                onClick={() => sendMessage()}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-4 py-2.5 bg-[#a85a32] rounded-xl text-[#fffaf2] hover:bg-[#8f4426] transition-all disabled:opacity-30 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Developer Console */}
        <div className="w-[360px] shrink-0 border-l border-[#8f4426]/[0.08] flex flex-col bg-[#f5edde]/50 backdrop-blur-2xl min-h-0">
          {/* Tabs */}
          <div className="shrink-0 flex items-center gap-0.5 px-3 pt-2.5 pb-2 border-b border-[#8f4426]/[0.08]">
            {(
              [
                { id: "pipeline", label: t("pipelineDebug"), icon: Activity },
                { id: "log", label: t("conversationLog"), icon: MessageSquare },
                { id: "commands", label: t("quickCommands"), icon: Terminal },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setConsoleTab(id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  consoleTab === id
                    ? "bg-[#a85a32]/10 text-[#a85a32] border border-[#a85a32]/20"
                    : "text-[#8a7157] hover:text-[#43301f] hover:bg-[#8f4426]/[0.04] border border-transparent"
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {consoleTab === "pipeline" && debugInfo && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#8f4426]/[0.03] rounded-xl p-3 border border-[#8f4426]/[0.06]">
                    <div className="text-[#9c8369] mb-1 text-[9px] uppercase tracking-wider">
                      {t("retrieval")}
                    </div>
                    <div className="font-mono text-[#3e9b6e] text-base font-semibold">
                      {Math.round(debugInfo.retrieval_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-[#8f4426]/[0.03] rounded-xl p-3 border border-[#8f4426]/[0.06]">
                    <div className="text-[#9c8369] mb-1 text-[9px] uppercase tracking-wider">
                      {t("llm")}
                    </div>
                    <div className="font-mono text-[#3a9fd6] text-base font-semibold">
                      {Math.round(debugInfo.llm_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-[#8f4426]/[0.03] rounded-xl p-3 border border-[#8f4426]/[0.06]">
                    <div className="text-[#9c8369] mb-1 text-[9px] uppercase tracking-wider">
                      {t("tts")}
                    </div>
                    <div className="font-mono text-[#a85a32] text-base font-semibold">
                      {Math.round(debugInfo.tts_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-[#8f4426]/[0.03] rounded-xl p-3 border border-[#8f4426]/[0.06]">
                    <div className="text-[#9c8369] mb-1 text-[9px] uppercase tracking-wider">
                      {t("total")}
                    </div>
                    <div className="font-mono text-[#43301f]/80 text-base font-semibold">
                      {Math.round(debugInfo.total_time_ms)}ms
                    </div>
                  </div>
                </div>

                {/* TTFA */}
                <div className="bg-[#d9822b]/[0.06] border border-[#d9822b]/[0.15] rounded-xl p-3 flex items-center justify-between">
                  <div className="text-[#b06a1f]/70 text-[9px] uppercase tracking-wider">
                    {t("firstAudio")}
                  </div>
                  <div className="font-mono text-[#b06a1f]/90 text-base font-semibold">
                    {Math.round(debugInfo.first_sentence_ms ?? 0)}ms
                  </div>
                </div>

                {debugInfo.ttfa_ms != null && (
                  <div className="bg-[#c1442e]/[0.06] border border-[#c1442e]/[0.15] rounded-xl p-3 flex items-center justify-between">
                    <div className="text-[#b03a24]/70 text-[9px] uppercase tracking-wider">
                      Frontend TTFA
                    </div>
                    <div className="font-mono text-[#b03a24]/90 text-base font-semibold">
                      {Math.round(debugInfo.ttfa_ms)}ms
                    </div>
                  </div>
                )}

                {/* Voice engine */}
                <div className="bg-[#8f4426]/[0.03] border border-[#8f4426]/[0.06] rounded-xl p-3">
                  <div className="text-[#3a9fd6]/70 text-[9px] uppercase tracking-wider mb-2">
                    Voice engine
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-[#8a7157]">FSM</span>
                      <span className="font-mono text-[#5c4632]">{fsmState}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a7157]">Turns</span>
                      <span className="font-mono text-[#5c4632]">{voiceStats.utterances}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a7157]">Partials</span>
                      <span className="font-mono text-[#5c4632]">{voiceStats.partials}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a7157]">Barge-ins</span>
                      <span className="font-mono text-[#5c4632]">{voiceStats.bargeIns}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a7157]">False det.</span>
                      <span className="font-mono text-[#5c4632]">{voiceStats.falseDetections}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8a7157]">Corrections</span>
                      <span className="font-mono text-[#5c4632]">{voiceStats.corrections}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] bg-[#8f4426]/[0.03] p-2.5 rounded-xl border border-[#8f4426]/[0.06]">
                  <Brain className="w-3.5 h-3.5 text-[#a85a32]/70 shrink-0" />
                  <span className="text-[#8a7157]">
                    {t("chunksRetrieved")}:{" "}
                    <span className="text-[#5c4632] font-medium">
                      {debugInfo.chunks_retrieved}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] bg-[#8f4426]/[0.03] p-2.5 rounded-xl border border-[#8f4426]/[0.06]">
                  <Zap className="w-3.5 h-3.5 text-[#3a9fd6]/70 shrink-0" />
                  <span className="text-[#8a7157] min-w-0">
                    {t("knowledgeSource")}:{" "}
                    <span className="text-[#5c4632] font-medium break-all">
                      {debugInfo.knowledge_source}
                    </span>
                  </span>
                </div>
              </>
            )}

            {consoleTab === "log" && (
              <div className="space-y-2">
                {messages.length === 0 && (
                  <p className="text-[11px] text-[#9c8369] text-center py-6">
                    {t("noCalls")}
                  </p>
                )}
                <AnimatePresence>
                  {messages.map((msg, idx) => (
                    <motion.div
                      key={`log-${msg.timestamp}-${idx}`}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`text-[11px] p-2.5 rounded-xl border ${
                        msg.role === "user"
                          ? "bg-[#a85a32]/5 border-[#a85a32]/15"
                          : "bg-[#8f4426]/[0.03] border-[#8f4426]/[0.08]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-[#8a7157] font-medium">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            msg.role === "user" ? "bg-[#a85a32]" : "bg-[#3a9fd6]"
                          }`}
                        />
                        {msg.role === "user" ? t("you") : t("ai")}
                        <span className="ml-auto text-[9px] text-[#9c8369]">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                      <div className="text-[#5c4632] whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {consoleTab === "commands" && (
              <div className="space-y-2">
                <div className="bg-[#a85a32]/5 border border-[#a85a32]/15 p-3 rounded-xl">
                  <div className="text-[#a85a32]/80 font-mono text-xs">
                    /insert &lt;content&gt;
                  </div>
                  <div className="text-[#8a7157] mt-1 text-[10px]">
                    {t("uploadKnowledge")}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 p-2.5 border-t border-[#8f4426]/[0.08] space-y-1.5">
            <button
              onClick={() =>
                navigate(`/active-call?knowledge=${KNOWLEDGE_FILE}`)
              }
              className="w-full py-2 bg-[#8f4426]/[0.04] border border-[#8f4426]/[0.1] rounded-xl text-[11px] font-medium hover:bg-[#8f4426]/[0.08] transition-all flex items-center justify-center gap-1.5 text-[#8a7157]"
            >
              <Maximize2 className="w-3 h-3" />
              {t("openFullScreen")}
            </button>
            <button
              onClick={handleEnd}
              className="w-full py-2 bg-[#c1442e]/10 text-[#b03a24]/80 border border-[#c1442e]/20 rounded-xl text-[11px] font-medium hover:bg-[#c1442e]/15 transition-all flex items-center justify-center gap-1.5"
            >
              <PhoneOff className="w-3 h-3" />
              {t("endCall")}
            </button>
          </div>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}