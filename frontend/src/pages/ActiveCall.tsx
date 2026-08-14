import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  RefreshCw,
  Zap,
  Brain,
  Volume2,
  User,
  Bot,
  ArrowLeft,
  Loader2,
  Mic,
  Send,
  Globe,
  PhoneOff,
  XCircle,
  CheckCircle2,
  Terminal,
} from "lucide-react";
import { useVoiceAgent } from "../hooks/useVoiceAgent";
import Markdown from "../components/Markdown";
import LanguageSwitcher from "../components/LanguageSwitcher";
import VoiceWaveform from "../components/VoiceWaveform";
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

export default function ActiveCall() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const knowledgeFile = searchParams.get("knowledge") || "institute.json";
  const { t, lang } = useTranslation();
  const [showDebug, setShowDebug] = React.useState(true);

  const startedAtRef = useRef(Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const {
    callStage,
    messages,
    inputText,
    setInputText,
    isListening,
    isProcessing,
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
  } = useVoiceAgent({ mode: "test", knowledgeFile, silenceTimeoutMs: 2000, initialLanguage: lang });

  // Start the call automatically on mount
  useEffect(() => {
    startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Free backend memory + stop audio if the user navigates away (Back button).
  useEffect(() => {
    return () => {
      endCall();
    };
  }, [endCall]);

  // Track when the call actually starts (for duration)
  useEffect(() => {
    if (callStage === "connecting") startedAtRef.current = Date.now();
  }, [callStage]);

  // Auto-scroll to the newest message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Save the completed call, then end + leave
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
    navigate("/testing-console");
  };

  if (callStage === "error") {
    return (
      <div className="h-screen w-screen bg-gradient-to-br from-red-950 via-slate-950 to-slate-950 flex items-center justify-center">
        <div className="max-w-md w-full mx-auto p-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gradient-to-br from-red-500/10 to-orange-500/10 backdrop-blur-2xl rounded-3xl border border-red-500/20 p-12 shadow-2xl text-center"
          >
            <XCircle className="w-20 h-20 text-red-400 mx-auto mb-6" />
            <h1 className="text-3xl font-bold mb-4 text-white">{t("error")}</h1>
            <p className="text-slate-400 mb-8">
              {error ||
                "Failed to connect to the voice agent. Is the backend running?"}
            </p>
            <div className="space-y-3">
              <button
                onClick={() => startCall()}
                className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-5 h-5" />
                {t("retry")}
              </button>
              <button
                onClick={() => navigate("/testing-console")}
                className="w-full py-4 bg-white/5 border border-white/10 rounded-xl font-medium hover:bg-white/10 transition-all"
              >
                {t("backToConsole")}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-950 via-purple-950/30 to-slate-950 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="h-16 border-b border-white/10 bg-black/20 backdrop-blur-2xl flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate("/testing-console")}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">{t("back")}</span>
          </motion.button>

          <div className="h-6 w-px bg-white/10" />

          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                callStage === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : callStage === "listening"
                  ? "bg-green-400"
                  : callStage === "thinking"
                  ? "bg-blue-400 animate-pulse"
                  : callStage === "speaking"
                  ? "bg-purple-400"
                  : "bg-slate-400"
              }`}
            />
            <span className="text-sm text-slate-300">
              {t(STAGE_LABEL_KEYS[callStage] || "idle")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl border border-white/10">
            <Globe className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300">{detectedLanguage}</span>
          </div>

          <LanguageSwitcher compact />

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleEnd}
            className="flex items-center gap-2 px-6 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/30 transition-all"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="text-sm font-medium">{t("endCall")}</span>
          </motion.button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Voice Agent (Center) */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative min-w-0">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative mb-12"
          >
            <div
              className={`absolute inset-0 rounded-full blur-3xl ${
                isUserSpeaking
                  ? "bg-green-500/30 animate-pulse"
                  : callStage === "listening"
                  ? "bg-purple-500/20 animate-pulse"
                  : callStage === "thinking"
                  ? "bg-blue-500/20 animate-pulse"
                  : callStage === "speaking"
                  ? "bg-green-500/20 animate-pulse"
                  : "bg-transparent"
              }`}
            />

            <div
              className={`relative w-56 h-56 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border-2 ${
                isUserSpeaking
                  ? "border-green-500/60 shadow-green-500/40"
                  : "border-purple-500/30"
              } shadow-2xl ${callStage === "listening" ? "animate-pulse" : ""}`}
            >
              {callStage === "connecting" && (
                <Loader2 className="w-28 h-28 text-yellow-400 animate-spin" />
              )}
              {callStage === "listening" &&
                (isUserSpeaking ? (
                  <Mic className="w-28 h-28 text-green-400 animate-pulse" />
                ) : (
                  <Mic className="w-28 h-28 text-purple-300" />
                ))}
              {callStage === "thinking" && (
                <Brain className="w-28 h-28 text-blue-400 animate-pulse" />
              )}
              {callStage === "speaking" && (
                <Volume2 className="w-28 h-28 text-green-400" />
              )}
            </div>

            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full text-sm font-medium backdrop-blur-xl border border-white/20 bg-black/40 whitespace-nowrap"
            >
              <span
                className={
                  callStage === "listening"
                    ? "text-green-400"
                    : callStage === "thinking"
                    ? "text-blue-400"
                    : callStage === "speaking"
                    ? "text-purple-400"
                    : "text-yellow-400"
                }
              >
                {t(STAGE_LABEL_KEYS[callStage] || "idle")}
              </span>
            </motion.div>
          </motion.div>

          {/* Real-time voice wave — reacts to ACTUAL sound (user's mic while
              listening, Mrs. D's audio while speaking). No fake animation. */}
          <div className="w-full max-w-xl mb-12">
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
              className="w-full h-16"
            />
            {callStage === "listening" && isUserSpeaking && (
              <div className="text-center text-xs font-medium text-green-400 mt-2">
                You're speaking… (any voice works — Telugu, Hindi, Tamil, English)
              </div>
            )}
          </div>

          {/* Messages — auto-scrolls to newest, full conversation retained */}
          <div
            ref={scrollRef}
            className="w-full max-w-4xl space-y-4 overflow-y-auto max-h-64 px-4 scroll-smooth"
          >
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`${msg.timestamp}-${idx}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={`flex gap-4 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`flex gap-4 max-w-[80%] ${
                      msg.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "user"
                          ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                          : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-6 h-6" />
                      ) : (
                        <Bot className="w-6 h-6" />
                      )}
                    </div>
                    <div
                      className={`p-5 rounded-2xl min-w-0 break-words ${
                        msg.role === "user"
                          ? "bg-purple-500/20 border border-purple-500/30"
                          : "bg-blue-500/20 border border-blue-500/30"
                      }`}
                    >
                      {msg.role === "ai" ? (
                        <Markdown text={msg.content} />
                      ) : (
                        <p className="text-base leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      )}
                      <div className="mt-2 text-[11px] text-slate-500 text-right">
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Developer Console (Right) */}
        <div className="w-[480px] border-l border-white/10 flex flex-col bg-black/30 backdrop-blur-2xl hidden lg:flex">
          {/* Input Section */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-semibold text-lg text-white">
                {t("developerConsole")}
              </h3>
              <div className="flex-1" />
              <button
                onClick={() => setShowDebug((s) => !s)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs px-3 py-2 rounded-lg mb-3">
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-3">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={toggleListening}
                disabled={callStage !== "listening"}
                className={`p-4 rounded-xl transition-all ${
                  isListening
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                } disabled:opacity-50`}
                title={isListening ? "Stop listening" : "Start listening"}
              >
                <Mic className="w-6 h-6" />
              </motion.button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder={t("typeMessage")}
                disabled={callStage !== "listening"}
                className="flex-1 px-5 py-4 bg-white/5 border border-white/10 rounded-xl text-base focus:outline-none focus:border-purple-500/50 disabled:opacity-50 placeholder:text-slate-500 min-w-0"
              />

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => sendMessage()}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-6 py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-all disabled:opacity-50"
              >
                <Send className="w-5 h-5" />
              </motion.button>
            </div>
          </div>

          {/* Debug Panel */}
          {showDebug && debugInfo && (
            <div className="p-6 border-b border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-300">
                  {t("pipelineDebug")}
                </span>
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{t("status")}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs uppercase tracking-wider">
                    {t("retrieval")}
                  </div>
                  <div className="font-mono text-green-400 text-xl font-bold">
                    {Math.round(debugInfo.retrieval_time_ms)}ms
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs uppercase tracking-wider">
                    {t("llm")}
                  </div>
                  <div className="font-mono text-blue-400 text-xl font-bold">
                    {Math.round(debugInfo.llm_time_ms)}ms
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs uppercase tracking-wider">
                    {t("tts")}
                  </div>
                  <div className="font-mono text-purple-400 text-xl font-bold">
                    {Math.round(debugInfo.tts_time_ms)}ms
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs uppercase tracking-wider">
                    {t("total")}
                  </div>
                  <div className="font-mono text-white text-xl font-bold">
                    {Math.round(debugInfo.total_time_ms)}ms
                  </div>
                </div>
              </div>

              {/* Time-to-first-audio — the metric that decides "feels human"
                  vs "feels robotic" (target: ~100-200ms after the LLM's first
                  tokens). The backend reports it per turn. */}
              <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <span className="text-amber-300 text-xs uppercase tracking-wider">
                  {t("firstAudio")}
                </span>
                <span className="font-mono text-amber-300 text-xl font-bold">
                  {Math.round(debugInfo.first_sentence_ms ?? 0)}ms
                </span>
              </div>
              {/* Frontend TTFA: speech-end → first audio heard (the metric the
                  caller actually perceives; target < 900ms, spec §27). */}
              {debugInfo.ttfa_ms != null && (
                <div className="flex items-center justify-between bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
                  <span className="text-orange-300 text-xs uppercase tracking-wider">
                    Frontend TTFA
                  </span>
                  <span className="font-mono text-orange-300 text-xl font-bold">
                    {Math.round(debugInfo.ttfa_ms)}ms
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm bg-white/5 p-4 rounded-xl border border-white/10">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-slate-300">
                  {t("chunksRetrieved")}:{" "}
                  <span className="text-white font-medium">
                    {debugInfo.chunks_retrieved}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm bg-white/5 p-4 rounded-xl border border-white/10">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-slate-300">
                  {t("knowledgeSource")}:{" "}
                  <span className="text-white font-medium">
                    {debugInfo.knowledge_source}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Commands */}
          <div className="p-6 border-b border-white/10">
            <div className="text-sm font-medium text-slate-300 mb-3">
              {t("quickCommands")}
            </div>
            <div className="space-y-2 text-sm">
              <div className="bg-purple-500/10 border border-purple-500/30 p-4 rounded-xl">
                <div className="text-purple-400 font-mono text-base mb-1">
                  /insert &lt;content&gt;
                </div>
                <div className="text-slate-400 text-xs">
                  {t("uploadKnowledge")}
                </div>
              </div>
            </div>
          </div>

          {/* Conversation Log */}
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            <div className="text-sm font-medium text-slate-300 mb-4 sticky top-0 bg-black/30 backdrop-blur-2xl py-2 border-b border-white/10 pb-4">
              {t("conversationLog")}
            </div>
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`log-${msg.timestamp}-${idx}`}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`text-sm p-4 rounded-xl border ${
                    msg.role === "user"
                      ? "bg-purple-500/10 border-purple-500/30"
                      : "bg-blue-500/10 border-blue-500/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        msg.role === "user" ? "bg-purple-400" : "bg-blue-400"
                      }`}
                    />
                    <span className="font-medium text-slate-300">
                      {msg.role === "user" ? t("you") : t("ai")}
                    </span>
                    <span className="ml-auto text-[11px] text-slate-500">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <div className="text-slate-400 leading-relaxed whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
