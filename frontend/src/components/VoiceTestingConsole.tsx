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
      <div className="h-full w-full flex items-center justify-center p-6 bg-[#08080c]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card-static p-10 max-w-sm w-full text-center"
        >
          <PhoneOff className="w-10 h-10 text-red-400 mx-auto mb-4" />
          <h1 className="text-lg font-bold mb-2 text-white">{t("error")}</h1>
          <p className="text-sm text-white/40 mb-6">
            {error || "Is the backend running? Please retry or go back."}
          </p>
          <div className="space-y-2">
            <button onClick={() => startCall()} className="btn-glow w-full">
              <Play className="w-4 h-4 relative z-10" />
              <span className="relative z-10">{t("retry")}</span>
            </button>
            <button
              onClick={() => navigate("/testing-console")}
              className="w-full h-10 rounded-xl text-xs font-medium text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-all border border-white/[0.04]"
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
      <div className="h-full w-full flex items-center justify-center p-6 bg-[#08080c]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card-static p-8 max-w-md w-full"
        >
          <div className="text-center space-y-5">
            {/* Orb — ElevenLabs style */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 150 }}
              className="orb-container mx-auto"
            >
              <div className="orb-core">
                <Bot className="w-10 h-10 text-indigo-400/60" />
              </div>
              <div className="orb-ripple" />
            </motion.div>

            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                {t("testingConsole")}
              </h1>
              <p className="text-sm text-white/30 mt-1">
                Developer mode with hardcoded knowledge
              </p>
            </div>

            <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3 max-w-sm mx-auto">
              <div className="text-[10px] text-white/20 uppercase tracking-wider mb-0.5 text-left">
                {t("knowledgeSource")}
              </div>
              <div className="font-mono text-indigo-300/70 text-xs text-left break-all">
                backend/knowledge/institute.json
              </div>
              <div className="text-[10px] text-white/15 mt-1 text-left">
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

            <div className="flex items-center justify-center gap-4 text-[11px] text-white/20">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-emerald-400/50" />
                Continuous voice
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-blue-400/50" />
                Auto language
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-indigo-400/50" />
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
      ? "text-emerald-400"
      : callStage === "thinking"
      ? "text-blue-400"
      : callStage === "speaking"
      ? "text-indigo-400"
      : "text-amber-400";

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#08080c]">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="h-11 shrink-0 border-b border-white/[0.04] bg-[#08080c]/80 backdrop-blur-xl flex items-center gap-2 px-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 text-white/30 hover:text-white/60 transition-colors shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium">{t("back")}</span>
        </button>

        <div className="h-3.5 w-px bg-white/[0.06]" />

        <div className="flex items-center gap-1.5 font-mono text-indigo-400/50 text-[11px] truncate">
          <Terminal className="w-3 h-3 shrink-0" />
          <span className="truncate">{KNOWLEDGE_FILE}</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.04]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              callStage === "listening"
                ? "bg-emerald-400"
                : callStage === "thinking"
                ? "bg-blue-400 animate-pulse"
                : callStage === "speaking"
                ? "bg-indigo-400"
                : "bg-amber-400 animate-pulse"
            }`}
          />
          <span className={`text-[11px] font-medium ${stageColor}`}>
            {t(STAGE_LABEL_KEYS[callStage] || "idle")}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.04]">
          <Globe className="w-3 h-3 text-white/25" />
          <span className="text-[11px] text-white/40">{detectedLanguage}</span>
        </div>

        <LanguageSwitcher compact />

        <button
          onClick={handleEnd}
          className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/15 rounded-lg hover:bg-red-500/15 transition-all shrink-0"
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
                    ? "bg-indigo-500/15"
                    : callStage === "thinking"
                    ? "bg-blue-500/15"
                    : callStage === "speaking"
                    ? "bg-emerald-500/15"
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
                  <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
                )}
                {callStage === "listening" && (
                  <Mic className="w-8 h-8 text-indigo-400/60" />
                )}
                {callStage === "thinking" && (
                  <Brain className="w-8 h-8 text-blue-400 animate-pulse" />
                )}
                {callStage === "speaking" && (
                  <Volume2 className="w-8 h-8 text-emerald-400/60" />
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
                    : "idle"
                }
                className="w-full h-10"
              />
              {callStage === "listening" && isUserSpeaking && (
                <div className="text-center text-[10px] font-medium text-emerald-400/50 mt-1">
                  You're speaking… (any voice — Telugu, Hindi, Tamil, English)
                </div>
              )}
              {isUserSpeaking && partialTranscript && (
                <div className="text-center text-[11px] text-white/40 mt-1 px-3 py-1.5 bg-white/[0.02] border border-emerald-500/10 rounded-lg truncate">
                  <span className="text-emerald-400/50 mr-1">›</span>
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
                          ? "bg-indigo-500/10 text-indigo-400/50 border border-indigo-500/10"
                          : "bg-violet-500/10 text-violet-400/50 border border-violet-500/10"
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
                          ? "bg-indigo-500/8 border border-indigo-500/10"
                          : "bg-white/[0.03] border border-white/[0.04]"
                      }`}
                    >
                      {msg.role === "ai" ? (
                        <Markdown text={msg.content} />
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      )}
                      <div className="mt-1 text-[10px] text-white/15 text-right">
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
              <div className="max-w-4xl mx-auto flex items-center gap-2 bg-amber-500/5 border border-amber-500/10 text-amber-300/70 text-[11px] px-3 py-2 rounded-lg">
                <Terminal className="w-3 h-3 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="shrink-0 border-t border-white/[0.04] bg-[#0a0a0f]/40 backdrop-blur-xl p-3">
            <div className="flex gap-2 max-w-4xl mx-auto">
              <button
                onClick={toggleListening}
                disabled={callStage !== "listening"}
                className={`p-2.5 rounded-xl transition-all shrink-0 ${
                  isListening
                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                    : "bg-white/[0.03] text-white/30 border border-white/[0.04] hover:bg-white/[0.05]"
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
                className="flex-1 px-4 py-2.5 bg-white/[0.03] border border-white/[0.04] rounded-xl text-sm focus:outline-none focus:border-indigo-500/30 disabled:opacity-30 min-w-0 placeholder:text-white/15"
              />

              <button
                onClick={() => sendMessage()}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-4 py-2.5 bg-indigo-500 rounded-xl text-white hover:bg-indigo-600 transition-all disabled:opacity-30 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Developer Console */}
        <div className="w-[360px] shrink-0 border-l border-white/[0.04] flex flex-col bg-[#0a0a0f]/40 backdrop-blur-2xl min-h-0">
          {/* Tabs */}
          <div className="shrink-0 flex items-center gap-0.5 px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
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
                    ? "bg-indigo-500/10 text-indigo-300/80 border border-indigo-500/15"
                    : "text-white/25 hover:text-white/50 hover:bg-white/[0.03] border border-transparent"
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
                  <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.03]">
                    <div className="text-white/20 mb-1 text-[9px] uppercase tracking-wider">
                      {t("retrieval")}
                    </div>
                    <div className="font-mono text-emerald-400 text-base font-semibold">
                      {Math.round(debugInfo.retrieval_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.03]">
                    <div className="text-white/20 mb-1 text-[9px] uppercase tracking-wider">
                      {t("llm")}
                    </div>
                    <div className="font-mono text-blue-400 text-base font-semibold">
                      {Math.round(debugInfo.llm_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.03]">
                    <div className="text-white/20 mb-1 text-[9px] uppercase tracking-wider">
                      {t("tts")}
                    </div>
                    <div className="font-mono text-indigo-400 text-base font-semibold">
                      {Math.round(debugInfo.tts_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.03]">
                    <div className="text-white/20 mb-1 text-[9px] uppercase tracking-wider">
                      {t("total")}
                    </div>
                    <div className="font-mono text-white/80 text-base font-semibold">
                      {Math.round(debugInfo.total_time_ms)}ms
                    </div>
                  </div>
                </div>

                {/* TTFA */}
                <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 flex items-center justify-between">
                  <div className="text-amber-300/50 text-[9px] uppercase tracking-wider">
                    {t("firstAudio")}
                  </div>
                  <div className="font-mono text-amber-300/80 text-base font-semibold">
                    {Math.round(debugInfo.first_sentence_ms ?? 0)}ms
                  </div>
                </div>

                {debugInfo.ttfa_ms != null && (
                  <div className="bg-orange-500/5 border border-orange-500/10 rounded-xl p-3 flex items-center justify-between">
                    <div className="text-orange-300/50 text-[9px] uppercase tracking-wider">
                      Frontend TTFA
                    </div>
                    <div className="font-mono text-orange-300/80 text-base font-semibold">
                      {Math.round(debugInfo.ttfa_ms)}ms
                    </div>
                  </div>
                )}

                {/* Voice engine */}
                <div className="bg-white/[0.02] border border-white/[0.03] rounded-xl p-3">
                  <div className="text-cyan-400/40 text-[9px] uppercase tracking-wider mb-2">
                    Voice engine
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-white/25">FSM</span>
                      <span className="font-mono text-white/50">{fsmState}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/25">Turns</span>
                      <span className="font-mono text-white/50">{voiceStats.utterances}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/25">Partials</span>
                      <span className="font-mono text-white/50">{voiceStats.partials}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/25">Barge-ins</span>
                      <span className="font-mono text-white/50">{voiceStats.bargeIns}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/25">False det.</span>
                      <span className="font-mono text-white/50">{voiceStats.falseDetections}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/25">Corrections</span>
                      <span className="font-mono text-white/50">{voiceStats.corrections}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] bg-white/[0.02] p-2.5 rounded-xl border border-white/[0.03]">
                  <Brain className="w-3.5 h-3.5 text-indigo-400/40 shrink-0" />
                  <span className="text-white/35">
                    {t("chunksRetrieved")}:{" "}
                    <span className="text-white/60 font-medium">
                      {debugInfo.chunks_retrieved}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] bg-white/[0.02] p-2.5 rounded-xl border border-white/[0.03]">
                  <Zap className="w-3.5 h-3.5 text-blue-400/40 shrink-0" />
                  <span className="text-white/35 min-w-0">
                    {t("knowledgeSource")}:{" "}
                    <span className="text-white/60 font-medium break-all">
                      {debugInfo.knowledge_source}
                    </span>
                  </span>
                </div>
              </>
            )}

            {consoleTab === "log" && (
              <div className="space-y-2">
                {messages.length === 0 && (
                  <p className="text-[11px] text-white/20 text-center py-6">
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
                          ? "bg-indigo-500/5 border-indigo-500/10"
                          : "bg-white/[0.02] border-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-white/40 font-medium">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            msg.role === "user" ? "bg-indigo-400" : "bg-violet-400"
                          }`}
                        />
                        {msg.role === "user" ? t("you") : t("ai")}
                        <span className="ml-auto text-[9px] text-white/15">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                      <div className="text-white/30 whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {consoleTab === "commands" && (
              <div className="space-y-2">
                <div className="bg-indigo-500/5 border border-indigo-500/10 p-3 rounded-xl">
                  <div className="text-indigo-400/60 font-mono text-xs">
                    /insert &lt;content&gt;
                  </div>
                  <div className="text-white/25 mt-1 text-[10px]">
                    {t("uploadKnowledge")}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 p-2.5 border-t border-white/[0.04] space-y-1.5">
            <button
              onClick={() =>
                navigate(`/active-call?knowledge=${KNOWLEDGE_FILE}`)
              }
              className="w-full py-2 bg-white/[0.03] border border-white/[0.04] rounded-xl text-[11px] font-medium hover:bg-white/[0.05] transition-all flex items-center justify-center gap-1.5 text-white/40"
            >
              <Maximize2 className="w-3 h-3" />
              {t("openFullScreen")}
            </button>
            <button
              onClick={handleEnd}
              className="w-full py-2 bg-red-500/10 text-red-400/70 border border-red-500/15 rounded-xl text-[11px] font-medium hover:bg-red-500/15 transition-all flex items-center justify-center gap-1.5"
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
