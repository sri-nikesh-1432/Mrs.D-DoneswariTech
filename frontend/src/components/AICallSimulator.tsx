import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Volume2,
  Send,
  Loader2,
  Phone,
  PhoneOff,
  Globe,
  User,
  Bot,
} from "lucide-react";
import { useVoiceAgent } from "../hooks/useVoiceAgent";
import Markdown from "./Markdown";
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

export default function AICallSimulator({
  instituteId = 1,
  onClose,
}: {
  instituteId?: number;
  onClose?: () => void;
}) {
  const { t, lang } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedAtRef = useRef(Date.now());

  const {
    callStage,
    messages,
    inputText,
    setInputText,
    isListening,
    detectedLanguage,
    conversationId,
    startCall,
    endCall,
    sendMessage,
    toggleListening,
    audioRef,
    isUserSpeaking,
    micLevelsRef,
    aiLevelsRef,
  } = useVoiceAgent({ mode: "process", instituteId, silenceTimeoutMs: 2000, initialLanguage: lang });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Track when the call starts (for duration)
  useEffect(() => {
    if (callStage === "connecting") startedAtRef.current = Date.now();
  }, [callStage]);

  // Free backend memory if the modal is closed unexpectedly
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
        institute_id: instituteId,
        duration,
        language: detectedLanguage,
        status: "completed",
        transcript,
      });
    } catch (e) {
      console.error("Failed to save call:", e);
    }
    await endCall();
    onClose?.();
  };

  if (callStage === "idle") {
    return (
      <div className="fixed inset-0 bg-[#3e2f23]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-3xl p-8 border border-[#8f4426]/[0.15] backdrop-blur-xl bg-[#faf4e8]/95 max-w-md w-full mx-4"
        >
          <div className="text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#a85a32]/20 to-[#3a9fd6]/20 flex items-center justify-center mx-auto">
              <Phone className="w-10 h-10 text-[#a85a32]" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-[#43301f] mb-2">
                {t("aiCallSimulator")}
              </h2>
              <p className="text-[#8a7157] text-sm">
                Real-time voice conversation with AI
              </p>
            </div>

            <button
              onClick={() => startCall()}
              className="w-full py-4 bg-gradient-to-r from-[#a85a32] to-[#3a9fd6] rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-[#fffaf2]"
            >
              <Phone className="w-5 h-5" />
              {t("startCall")}
            </button>

            <button
              onClick={onClose}
              className="w-full py-3 bg-[#8f4426]/[0.06] border border-[#8f4426]/[0.15] rounded-xl font-medium hover:bg-[#8f4426]/[0.1] transition-colors text-[#43301f]"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#3e2f23]/60 backdrop-blur-sm z-50">
      <div className="h-full flex flex-col bg-gradient-to-br from-[#fbf6ec] via-[#f5edde] to-[#fbf6ec]">
        {/* Header */}
        <div className="p-4 flex items-center justify-between border-b border-[#8f4426]/[0.1]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#a85a32]/20 to-[#3a9fd6]/20 flex items-center justify-center">
              <Phone className="w-6 h-6 text-[#a85a32]" />
            </div>
            <div>
              <h3 className="font-semibold text-[#43301f]">{t("aiCallSimulator")}</h3>
              <p className="text-xs text-[#8a7157]">Real-time conversation</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-[#5c4632]">
              <Globe className="w-4 h-4 text-[#8a7157]" />
              <span>{detectedLanguage}</span>
            </div>
            <button
              onClick={handleEnd}
              className="w-12 h-12 rounded-full bg-[#c1442e]/15 text-[#b03a24] border border-[#c1442e]/30 flex items-center justify-center hover:bg-[#c1442e]/25 transition-colors"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 min-h-0">
          {/* Avatar */}
          <div className="relative mb-6">
            <div
              className={`w-32 h-32 rounded-full bg-gradient-to-br from-[#a85a32]/20 to-[#3a9fd6]/20 flex items-center justify-center ${
                callStage === "listening" ? "animate-pulse" : ""
              }`}
            >
              {callStage === "listening" && (
                <Mic className="w-16 h-16 text-[#3a9fd6]" />
              )}
              {callStage === "thinking" && (
                <Loader2 className="w-16 h-16 text-[#a85a32] animate-spin" />
              )}
              {callStage === "speaking" && (
                <Volume2 className="w-16 h-16 text-[#3a9fd6]" />
              )}
              {callStage === "connecting" && (
                <Loader2 className="w-16 h-16 text-[#d9822b] animate-spin" />
              )}
            </div>

            {/* Status */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-medium backdrop-blur-xl border border-[#8f4426]/[0.12] bg-[#faf4e8]/90 whitespace-nowrap">
              <span
                className={
                  callStage === "listening"
                    ? "text-[#3a9fd6]"
                    : callStage === "thinking"
                    ? "text-[#a85a32]"
                    : callStage === "speaking"
                    ? "text-[#2b82b5]"
                    : "text-[#d9822b]"
                }
              >
                {t(STAGE_LABEL_KEYS[callStage] || "idle")}
              </span>
            </div>
          </div>

          {/* Real-time voice wave — reacts to ACTUAL sound (user's mic while
              listening, Mrs. D's audio while speaking). No fake animation. */}
          <div className="w-full max-w-xl mb-6">
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
              className="w-full h-12"
            />
            {callStage === "listening" && isUserSpeaking && (
              <div className="text-center text-[11px] font-medium text-[#a85a32] mt-1">
                You're speaking… (any voice works)
              </div>
            )}
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="w-full max-w-2xl space-y-4 overflow-y-auto max-h-64 px-2 scroll-smooth"
          >
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`${msg.timestamp}-${idx}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`flex gap-2 max-w-[80%] min-w-0 ${
                      msg.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        msg.role === "user"
                          ? "bg-[#a85a32]/15 text-[#a85a32]"
                          : "bg-[#3a9fd6]/15 text-[#3a9fd6]"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <User className="w-5 h-5" />
                      ) : (
                        <Bot className="w-5 h-5" />
                      )}
                    </div>
                    <div
                      className={`p-4 rounded-2xl min-w-0 break-words ${
                        msg.role === "user"
                          ? "bg-[#a85a32]/10 border border-[#a85a32]/20"
                          : "bg-[#3a9fd6]/10 border border-[#3a9fd6]/20"
                      }`}
                    >
                      {msg.role === "ai" ? (
                        <Markdown text={msg.content} />
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap text-[#43301f]">
                          {msg.content}
                        </p>
                      )}
                      <div className="mt-1.5 text-[10px] text-[#9c8369] text-right">
                        {formatTime(msg.timestamp)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Input */}
          <div className="w-full max-w-2xl mt-6 flex gap-2">
            <button
              onClick={toggleListening}
              disabled={callStage !== "listening"}
              className={`p-4 rounded-xl transition-all ${
                isListening
                  ? "bg-[#c1442e]/15 text-[#b03a24] border border-[#c1442e]/25"
                  : "bg-[#8f4426]/[0.06] text-[#8a7157] border border-[#8f4426]/[0.15] hover:bg-[#8f4426]/[0.1]"
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
              className="flex-1 px-4 py-3 bg-[#8f4426]/[0.05] border border-[#8f4426]/[0.15] rounded-xl text-sm text-[#43301f] focus:outline-none focus:border-[#a85a32]/50 disabled:opacity-50 min-w-0 placeholder:text-[#9c8369]"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!inputText.trim() || callStage !== "listening"}
              className="px-5 py-3 bg-gradient-to-r from-[#a85a32] to-[#3a9fd6] rounded-xl font-medium hover:opacity-90 transition-all disabled:opacity-50 text-[#fffaf2]"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}