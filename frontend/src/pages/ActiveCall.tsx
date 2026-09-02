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
      <div className="h-screen w-screen bg-[#08080c] flex items-center justify-center">
        <div className="max-w-sm w-full mx-auto p-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="glass-card-static p-10 text-center"
          >
            <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-3 text-white">{t("error")}</h1>
            <p className="text-sm text-white/40 mb-6">
              {error || "Failed to connect to the voice agent. Is the backend running?"}
            </p>
            <div className="space-y-2">
              <button onClick={() => startCall()} className="btn-glow w-full">
                <RefreshCw className="w-4 h-4 relative z-10" />
                <span className="relative z-10">{t("retry")}</span>
              </button>
              <button
                onClick={() => navigate("/testing-console")}
                className="w-full h-10 rounded-xl text-sm font-medium text-white/40 hover:text-white/60 hover:bg-white/[0.04] transition-all border border-white/[0.04]"
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
    <div className="h-screen w-screen bg-[#08080c] flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="h-12 shrink-0 border-b border-white/[0.04] bg-[#08080c]/80 backdrop-blur-xl flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/testing-console")}
            className="flex items-center gap-1.5 text-white/30 hover:text-white/60 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-medium">{t("back")}</span>
          </motion.button>

          <div className="h-4 w-px bg-white/[0.06]" />

          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                callStage === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : callStage === "listening"
                  ? "bg-emerald-400"
                  : callStage === "thinking"
                  ? "bg-blue-400 animate-pulse"
                  : callStage === "speaking"
                  ? "bg-indigo-400"
                  : "bg-white/20"
              }`}
            />
            <span className="text-xs text-white/50">
              {t(STAGE_LABEL_KEYS[callStage] || "idle")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.03] rounded-lg border border-white/[0.04]">
            <Globe className="w-3 h-3 text-white/25" />
            <span className="text-[11px] text-white/40">{detectedLanguage}</span>
          </div>

          <LanguageSwitcher compact />

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleEnd}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/15 transition-all text-xs font-medium"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>{t("endCall")}</span>
          </motion.button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Voice Agent (Center) */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative min-w-0">
          {/* Orb — ElevenLabs-style */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="relative mb-10"
          >
            {/* Glow behind orb */}
            <div
              className={`absolute inset-0 rounded-full blur-3xl transition-all duration-700 ${
                isUserSpeaking
                  ? "bg-emerald-500/15"
                  : callStage === "listening"
                  ? "bg-indigo-500/10"
                  : callStage === "thinking"
                  ? "bg-blue-500/10"
                  : callStage === "speaking"
                  ? "bg-indigo-500/15"
                  : "bg-transparent"
              }`}
            />

            {/* Orb core */}
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
            >
              {callStage === "connecting" && (
                <Loader2 className="w-16 h-16 text-amber-400 animate-spin" />
              )}
              {callStage === "listening" &&
                (isUserSpeaking ? (
                  <Mic className="w-16 h-16 text-emerald-400 animate-pulse" />
                ) : (
                  <Mic className="w-16 h-16 text-white/30" />
                ))}
              {callStage === "thinking" && (
                <Brain className="w-16 h-16 text-blue-400 animate-pulse" />
              )}
              {callStage === "speaking" && (
                <Volume2 className="w-16 h-16 text-indigo-400" />
              )}
            </div>

            {/* Ripple rings */}
            {(callStage === "listening" || callStage === "speaking") && (
              <>
                <div className="orb-ripple" />
                <div className="orb-ripple" />
                <div className="orb-ripple" />
              </>
            )}

            {/* Stage label below orb */}
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[11px] font-medium backdrop-blur-xl border border-white/[0.06] bg-[#0a0a0f]/60 whitespace-nowrap"
            >
              <span
                className={
                  callStage === "listening"
                    ? "text-emerald-400"
                    : callStage === "thinking"
                    ? "text-blue-400"
                    : callStage === "speaking"
                    ? "text-indigo-400"
                    : "text-amber-400"
                }
              >
                {t(STAGE_LABEL_KEYS[callStage] || "idle")}
              </span>
            </motion.div>
          </motion.div>

          {/* Waveform */}
          <div className="w-full max-w-lg mb-8">
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
              <div className="text-center text-[10px] font-medium text-emerald-400/60 mt-1.5">
                You're speaking… (any voice works — Telugu, Hindi, Tamil, English)
              </div>
            )}
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="w-full max-w-2xl space-y-3 overflow-y-auto max-h-56 px-4 scroll-smooth"
          >
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`${msg.timestamp}-${idx}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className={`flex gap-3 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`flex gap-3 max-w-[80%] ${
                      msg.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "user"
                          ? "bg-indigo-500/10 text-indigo-400/60 border border-indigo-500/10"
                          : "bg-violet-500/10 text-violet-400/60 border border-violet-500/10"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-4 h-4" />
                      ) : (
                        <Bot className="w-4 h-4" />
                      )}
                    </div>
                    <div
                      className={`px-4 py-3 rounded-2xl min-w-0 break-words ${
                        msg.role === "user"
                          ? "bg-indigo-500/8 border border-indigo-500/10"
                          : "bg-white/[0.03] border border-white/[0.04]"
                      }`}
                    >
                      {msg.role === "ai" ? (
                        <Markdown text={msg.content} />
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      )}
                      <div className="mt-1.5 text-[10px] text-white/15 text-right">
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
        <div className="w-[420px] border-l border-white/[0.04] flex flex-col bg-[#0a0a0f]/60 backdrop-blur-2xl hidden lg:flex">
          {/* Input Section */}
          <div className="p-5 border-b border-white/[0.04]">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-white/80">
                {t("developerConsole")}
              </h3>
              <div className="flex-1" />
              <button
                onClick={() => setShowDebug((s) => !s)}
                className="text-white/20 hover:text-white/40 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-amber-500/5 border border-amber-500/10 text-amber-300/80 text-[11px] px-3 py-2 rounded-lg mb-3">
                <Terminal className="w-3 h-3 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-2">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={toggleListening}
                disabled={callStage !== "listening"}
                className={`p-3 rounded-xl transition-all ${
                  isListening
                    ? "bg-red-500/10 text-red-400 border border-red-500/20"
                    : "bg-white/[0.03] text-white/30 border border-white/[0.04] hover:bg-white/[0.05]"
                } disabled:opacity-30`}
                title={isListening ? "Stop listening" : "Start listening"}
              >
                <Mic className="w-5 h-5" />
              </motion.button>

              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder={t("typeMessage")}
                disabled={callStage !== "listening"}
                className="flex-1 px-4 py-3 bg-white/[0.03] border border-white/[0.04] rounded-xl text-sm focus:outline-none focus:border-indigo-500/30 disabled:opacity-30 placeholder:text-white/15 min-w-0"
              />

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => sendMessage()}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-4 py-3 bg-indigo-500 rounded-xl text-white hover:bg-indigo-600 transition-all disabled:opacity-30"
              >
                <Send className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          {/* Debug Panel */}
          {showDebug && debugInfo && (
            <div className="p-5 border-b border-white/[0.04] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/50">
                  {t("pipelineDebug")}
                </span>
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/60">
                  <div className="w-1 h-1 rounded-full bg-emerald-400" />
                  <span>{t("status")}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.03]">
                  <div className="text-white/20 mb-1 text-[10px] uppercase tracking-wider">
                    {t("retrieval")}
                  </div>
                  <div className="font-mono text-emerald-400 text-lg font-semibold">
                    {Math.round(debugInfo.retrieval_time_ms)}ms
                  </div>
                </div>
                <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.03]">
                  <div className="text-white/20 mb-1 text-[10px] uppercase tracking-wider">
                    {t("llm")}
                  </div>
                  <div className="font-mono text-blue-400 text-lg font-semibold">
                    {Math.round(debugInfo.llm_time_ms)}ms
                  </div>
                </div>
                <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.03]">
                  <div className="text-white/20 mb-1 text-[10px] uppercase tracking-wider">
                    {t("tts")}
                  </div>
                  <div className="font-mono text-indigo-400 text-lg font-semibold">
                    {Math.round(debugInfo.tts_time_ms)}ms
                  </div>
                </div>
                <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.03]">
                  <div className="text-white/20 mb-1 text-[10px] uppercase tracking-wider">
                    {t("total")}
                  </div>
                  <div className="font-mono text-white/80 text-lg font-semibold">
                    {Math.round(debugInfo.total_time_ms)}ms
                  </div>
                </div>
              </div>

              {/* TTFA */}
              <div className="flex items-center justify-between bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
                <span className="text-amber-300/60 text-[10px] uppercase tracking-wider">
                  {t("firstAudio")}
                </span>
                <span className="font-mono text-amber-300 text-lg font-semibold">
                  {Math.round(debugInfo.first_sentence_ms ?? 0)}ms
                </span>
              </div>
              {debugInfo.ttfa_ms != null && (
                <div className="flex items-center justify-between bg-orange-500/5 border border-orange-500/10 rounded-xl p-3">
                  <span className="text-orange-300/60 text-[10px] uppercase tracking-wider">
                    Frontend TTFA
                  </span>
                  <span className="font-mono text-orange-300 text-lg font-semibold">
                    {Math.round(debugInfo.ttfa_ms)}ms
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs bg-white/[0.02] p-3 rounded-xl border border-white/[0.03]">
                <Brain className="w-3.5 h-3.5 text-indigo-400/50" />
                <span className="text-white/40">
                  {t("chunksRetrieved")}:{" "}
                  <span className="text-white/70 font-medium">
                    {debugInfo.chunks_retrieved}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs bg-white/[0.02] p-3 rounded-xl border border-white/[0.03]">
                <Zap className="w-3.5 h-3.5 text-blue-400/50" />
                <span className="text-white/40">
                  {t("knowledgeSource")}:{" "}
                  <span className="text-white/70 font-medium">
                    {debugInfo.knowledge_source}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Commands */}
          <div className="p-5 border-b border-white/[0.04]">
            <div className="text-xs font-medium text-white/40 mb-2">
              {t("quickCommands")}
            </div>
            <div className="bg-indigo-500/5 border border-indigo-500/10 p-3 rounded-xl">
              <div className="text-indigo-400/80 font-mono text-xs mb-0.5">
                /insert &lt;content&gt;
              </div>
              <div className="text-white/25 text-[10px]">
                {t("uploadKnowledge")}
              </div>
            </div>
          </div>

          {/* Conversation Log */}
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            <div className="text-xs font-medium text-white/40 mb-3 sticky top-0 bg-[#0a0a0f]/60 backdrop-blur-xl py-2 border-b border-white/[0.04] pb-3">
              {t("conversationLog")}
            </div>
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`log-${msg.timestamp}-${idx}`}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`text-xs p-3 rounded-xl border ${
                    msg.role === "user"
                      ? "bg-indigo-500/5 border-indigo-500/10"
                      : "bg-white/[0.02] border-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        msg.role === "user" ? "bg-indigo-400" : "bg-violet-400"
                      }`}
                    />
                    <span className="font-medium text-white/50">
                      {msg.role === "user" ? t("you") : t("ai")}
                    </span>
                    <span className="ml-auto text-[10px] text-white/15">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <div className="text-white/35 leading-relaxed whitespace-pre-wrap break-words">
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
