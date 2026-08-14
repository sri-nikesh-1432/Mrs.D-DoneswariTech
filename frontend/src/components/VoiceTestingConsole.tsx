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

  // THE MOST IMPORTANT RULE: the Testing Console uses backend/knowledge/institute.json ONLY.
  // Hardcoded, for developers, and completely isolated from the uploaded-PDF FAISS knowledge.
  const KNOWLEDGE_FILE = "institute.json";

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef(Date.now());

  const {
    callStage,
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
    micLevelsRef,
    aiLevelsRef,
  } = useVoiceAgent({ mode: "test", knowledgeFile: KNOWLEDGE_FILE, initialLanguage: lang });

  // Auto-scroll to newest message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = logScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Track when the call starts (for duration)
  useEffect(() => {
    if (callStage === "connecting") startedAtRef.current = Date.now();
  }, [callStage]);

  // Free backend memory if the user navigates away
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

  if (callStage === "error") {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-br from-red-500/10 to-orange-500/10 backdrop-blur-2xl rounded-3xl border border-red-500/20 p-10 shadow-2xl max-w-md w-full text-center"
        >
          <PhoneOff className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-3 text-white">{t("error")}</h1>
          <p className="text-slate-400 text-sm mb-6">
            {error ||
              "Is the backend running? Please retry or go back to the console."}
          </p>
          <div className="space-y-2.5">
            <button
              onClick={() => startCall()}
              className="w-full py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl text-sm font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              {t("retry")}
            </button>
            <button
              onClick={() => navigate("/testing-console")}
              className="w-full py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-medium hover:bg-white/10 transition-all"
            >
              {t("backToConsole")}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (callStage === "idle") {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-2xl rounded-3xl border border-white/10 p-8 shadow-2xl max-w-xl w-full"
        >
          <div className="text-center space-y-5">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15, type: "spring", stiffness: 150 }}
              className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center mx-auto border-2 border-purple-500/50 shadow-xl shadow-purple-500/30"
            >
              <Bot className="w-10 h-10 text-purple-300" />
            </motion.div>

            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                {t("testingConsole")}
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                Developer mode with hardcoded knowledge
              </p>
            </div>

            <div className="bg-white/5 border border-purple-500/30 rounded-xl px-4 py-3 max-w-md mx-auto">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5 text-left">
                {t("knowledgeSource")}
              </div>
              <div className="font-mono text-purple-300 text-xs text-left break-all">
                backend/knowledge/institute.json
              </div>
              <div className="text-[11px] text-slate-500 mt-1 text-left">
                Hardcoded · for developers only · never merged with uploaded PDFs
              </div>
            </div>

            <button
              onClick={() => startCall()}
              className="px-10 py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl font-semibold hover:opacity-90 transition-all hover:scale-[1.03] flex items-center justify-center gap-2.5 mx-auto shadow-xl shadow-purple-500/30"
            >
              <Phone className="w-5 h-5" />
              {t("startVoiceAgent")}
            </button>

            <div className="flex items-center justify-center gap-5 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                Continuous voice
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                Auto language detection
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                Real-time STT &amp; TTS
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const stageColor =
    callStage === "listening"
      ? "text-green-400"
      : callStage === "thinking"
      ? "text-blue-400"
      : callStage === "speaking"
      ? "text-purple-400"
      : "text-yellow-400";

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-purple-950/40 to-slate-950">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="h-14 shrink-0 border-b border-white/10 bg-black/20 backdrop-blur-2xl flex items-center gap-3 px-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-xs font-medium">{t("back")}</span>
        </button>

        <div className="h-5 w-px bg-white/10" />

        <div className="flex items-center gap-2 font-mono text-purple-300 text-xs truncate">
          <Terminal className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{KNOWLEDGE_FILE}</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
          <span
            className={`w-2 h-2 rounded-full ${
              callStage === "listening"
                ? "bg-green-400"
                : callStage === "thinking"
                ? "bg-blue-400 animate-pulse"
                : callStage === "speaking"
                ? "bg-purple-400"
                : "bg-yellow-400 animate-pulse"
            }`}
          />
          <span className={`text-xs font-medium ${stageColor}`}>
            {t(STAGE_LABEL_KEYS[callStage] || "idle")}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
          <Globe className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-300">{detectedLanguage}</span>
        </div>

        <LanguageSwitcher compact />

        <button
          onClick={handleEnd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-all shrink-0"
        >
          <PhoneOff className="w-4 h-4" />
          <span className="text-xs font-medium">{t("endCall")}</span>
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Call UI */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Orb */}
          <div className="flex flex-col items-center pt-5 pb-3 shrink-0">
            <div className="relative">
              <div
                className={`absolute inset-0 rounded-full blur-2xl ${
                  callStage === "listening"
                    ? "bg-purple-500/25 animate-pulse"
                    : callStage === "thinking"
                    ? "bg-blue-500/25 animate-pulse"
                    : callStage === "speaking"
                    ? "bg-green-500/25 animate-pulse"
                    : "bg-transparent"
                }`}
              />
              <div
                className={`relative w-24 h-24 rounded-full bg-gradient-to-br from-purple-500/25 to-blue-500/25 flex items-center justify-center border-2 border-purple-500/40 shadow-2xl ${
                  callStage === "listening" ? "animate-pulse" : ""
                }`}
              >
                {callStage === "connecting" && (
                  <Loader2 className="w-10 h-10 text-yellow-400 animate-spin" />
                )}
                {callStage === "listening" && (
                  <Mic className="w-10 h-10 text-purple-300" />
                )}
                {callStage === "thinking" && (
                  <Brain className="w-10 h-10 text-blue-400 animate-pulse" />
                )}
                {callStage === "speaking" && (
                  <Volume2 className="w-10 h-10 text-green-400" />
                )}
              </div>
            </div>

            {/* Real-time voice wave — reacts to ACTUAL sound (user's mic while
                listening, Mrs. D's audio while speaking). No fake animation. */}
            <div className="w-full max-w-md mt-3">
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
                className="w-full h-12"
              />
              {callStage === "listening" && isUserSpeaking && (
                <div className="text-center text-[11px] font-medium text-green-400 mt-1">
                  You're speaking… (any voice — Telugu, Hindi, Tamil, English)
                </div>
              )}
            </div>
          </div>

          {/* Conversation */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto px-6 py-3 space-y-3 scroll-smooth"
          >
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`${msg.timestamp}-${idx}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-2.5 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`flex gap-2.5 max-w-[75%] min-w-0 ${
                      msg.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "user"
                          ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                          : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-4 h-4" />
                      ) : (
                        <Bot className="w-4 h-4" />
                      )}
                    </div>
                    <div
                      className={`px-4 py-3 rounded-2xl min-w-0 break-words text-sm ${
                        msg.role === "user"
                          ? "bg-purple-500/20 border border-purple-500/30"
                          : "bg-blue-500/20 border border-blue-500/30"
                      }`}
                    >
                      {msg.role === "ai" ? (
                        <Markdown text={msg.content} />
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      )}
                      <div className="mt-1 text-[10px] text-slate-500 text-right">
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Error banner — real reason, not a fake "backend down" screen */}
          {error && (
            <div className="shrink-0 px-3 pt-2">
              <div className="max-w-4xl mx-auto flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs px-3 py-2 rounded-lg">
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="shrink-0 border-t border-white/10 bg-black/20 backdrop-blur-2xl p-3">
            <div className="flex gap-2 max-w-4xl mx-auto">
              <button
                onClick={toggleListening}
                disabled={callStage !== "listening"}
                className={`p-3 rounded-xl transition-all shrink-0 ${
                  isListening
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                } disabled:opacity-50`}
                title={isListening ? "Stop listening" : "Start listening"}
              >
                <Mic className="w-5 h-5" />
              </button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder={t("typeMessage")}
                disabled={callStage !== "listening"}
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50 disabled:opacity-50 min-w-0"
              />

              <button
                onClick={() => sendMessage()}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-5 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-all disabled:opacity-50 shrink-0"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Developer Console */}
        <div className="w-[380px] shrink-0 border-l border-white/10 flex flex-col bg-black/30 backdrop-blur-2xl min-h-0">
          {/* Tabs */}
          <div className="shrink-0 flex items-center gap-1 px-3 pt-3 pb-2 border-b border-white/10">
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  consoleTab === id
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {consoleTab === "pipeline" && debugInfo && (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <div className="text-slate-400 mb-1 text-[10px] uppercase tracking-wider">
                      {t("retrieval")}
                    </div>
                    <div className="font-mono text-green-400 text-base font-bold">
                      {Math.round(debugInfo.retrieval_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <div className="text-slate-400 mb-1 text-[10px] uppercase tracking-wider">
                      {t("llm")}
                    </div>
                    <div className="font-mono text-blue-400 text-base font-bold">
                      {Math.round(debugInfo.llm_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <div className="text-slate-400 mb-1 text-[10px] uppercase tracking-wider">
                      {t("tts")}
                    </div>
                    <div className="font-mono text-purple-400 text-base font-bold">
                      {Math.round(debugInfo.tts_time_ms)}ms
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <div className="text-slate-400 mb-1 text-[10px] uppercase tracking-wider">
                      {t("total")}
                    </div>
                    <div className="font-mono text-white text-base font-bold">
                      {Math.round(debugInfo.total_time_ms)}ms
                    </div>
                  </div>
                </div>

                {/* Time-to-first-audio — the metric that decides "feels human"
                    vs "feels robotic" (target: ~100-200ms after the LLM's
                    first tokens). The backend reports it per turn. */}
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between">
                  <div className="text-amber-300 text-[10px] uppercase tracking-wider">
                    {t("firstAudio")}
                  </div>
                  <div className="font-mono text-amber-300 text-base font-bold">
                    {Math.round(debugInfo.first_sentence_ms ?? 0)}ms
                  </div>
                </div>

                {/* Frontend TTFA: speech-end → first audio heard (spec §27). */}
                {debugInfo.ttfa_ms != null && (
                  <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 flex items-center justify-between">
                    <div className="text-orange-300 text-[10px] uppercase tracking-wider">
                      Frontend TTFA
                    </div>
                    <div className="font-mono text-orange-300 text-base font-bold">
                      {Math.round(debugInfo.ttfa_ms)}ms
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs bg-white/5 p-2.5 rounded-xl border border-white/10">
                  <Brain className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="text-slate-300">
                    {t("chunksRetrieved")}:{" "}
                    <span className="text-white font-medium">
                      {debugInfo.chunks_retrieved}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs bg-white/5 p-2.5 rounded-xl border border-white/10">
                  <Zap className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-slate-300 min-w-0">
                    {t("knowledgeSource")}:{" "}
                    <span className="text-white font-medium break-all">
                      {debugInfo.knowledge_source}
                    </span>
                  </span>
                </div>
              </>
            )}

            {consoleTab === "log" && (
              <div className="space-y-2.5">
                {messages.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-6">
                    {t("noCalls")}
                  </p>
                )}
                <AnimatePresence>
                  {messages.map((msg, idx) => (
                    <motion.div
                      key={`log-${msg.timestamp}-${idx}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`text-xs p-3 rounded-xl border ${
                        msg.role === "user"
                          ? "bg-purple-500/10 border-purple-500/30"
                          : "bg-blue-500/10 border-blue-500/30"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-slate-300 font-medium">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            msg.role === "user"
                              ? "bg-purple-400"
                              : "bg-blue-400"
                          }`}
                        />
                        {msg.role === "user" ? t("you") : t("ai")}
                        <span className="ml-auto text-[10px] text-slate-500">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                      <div className="text-slate-400 whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {consoleTab === "commands" && (
              <div className="space-y-3">
                <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded-xl">
                  <div className="text-purple-400 font-mono text-sm">
                    /insert &lt;content&gt;
                  </div>
                  <div className="text-slate-400 mt-1 text-xs">
                    {t("uploadKnowledge")}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 p-3 border-t border-white/10 space-y-2">
            <button
              onClick={() =>
                navigate(`/active-call?knowledge=${KNOWLEDGE_FILE}`)
              }
              className="w-full py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-medium hover:bg-white/10 transition-all flex items-center justify-center gap-2 text-slate-300"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {t("openFullScreen")}
            </button>
            <button
              onClick={handleEnd}
              className="w-full py-2.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-xs font-medium hover:bg-red-500/30 transition-all flex items-center justify-center gap-2"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              {t("endCall")}
            </button>
          </div>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
