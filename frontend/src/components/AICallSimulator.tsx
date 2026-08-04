import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  Volume2,
  Send,
  Loader2,
  X,
  Phone,
  PhoneOff,
  Globe,
} from "lucide-react";

interface Message {
  speaker: "user" | "ai";
  text: string;
  timestamp: number;
}

type CallStage = "idle" | "listening" | "thinking" | "speaking";

export default function AICallSimulator({ instituteId = 1, onClose }: { instituteId?: number; onClose?: () => void }) {
  const [callStage, setCallStage] = useState<CallStage>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState("English");
  
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const conversationId = useRef(`call_${Date.now()}`);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Setup Web Speech API for continuous listening
  useEffect(() => {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = "en-IN";
      
      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = "";
        let interimTranscript = "";
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        
        // Handle voice interruption - if user speaks while AI is speaking
        if (callStage === "speaking" && (interimTranscript || finalTranscript)) {
          handleVoiceInterruption();
        }
        
        if (finalTranscript) {
          setInputText(finalTranscript);
          detectLanguage(finalTranscript);
          resetSilenceTimer();
        }
      };
      
      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === "not-allowed") {
          setCallStage("idle");
        }
      };
      
      recognitionRef.current.onend = () => {
        if (callStage === "listening") {
          // Restart if still supposed to be listening
          try {
            recognitionRef.current.start();
          } catch (e) {
            console.error("Failed to restart recognition:", e);
          }
        }
      };
    }
    
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [callStage]);
  
  const detectLanguage = (text: string) => {
    const teluguPattern = /[\u0C00-\u0C7F]/;
    const hindiPattern = /[\u0900-\u097F]/;
    const tamilPattern = /[\u0B80-\u0BFF]/;
    
    if (teluguPattern.test(text)) {
      setDetectedLanguage("Telugu");
      recognitionRef.current.lang = "te-IN";
    } else if (hindiPattern.test(text)) {
      setDetectedLanguage("Hindi");
      recognitionRef.current.lang = "hi-IN";
    } else if (tamilPattern.test(text)) {
      setDetectedLanguage("Tamil");
      recognitionRef.current.lang = "ta-IN";
    } else {
      setDetectedLanguage("English");
      recognitionRef.current.lang = "en-IN";
    }
  };
  
  const resetSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    silenceTimerRef.current = setTimeout(() => {
      if (callStage === "listening" && inputText.trim()) {
        processUserSpeech(inputText);
      }
    }, 2000); // 2 seconds of silence
  };
  
  const startCall = async () => {
    setCallStage("thinking");
    setMessages([]);
    setInputText("");
    
    try {
      const params = new URLSearchParams({
        institute_id: instituteId.toString(),
        user_input: "START_CALL",
        conversation_id: conversationId.current,
        include_audio: "true",
        is_greeting: "true",
        language: detectedLanguage,
      });
      
      const response = await fetch(`/api/conversation/process?${params}`, {
        method: "POST",
      });
      
      if (!response.ok) {
        throw new Error("Failed to generate greeting");
      }
      
      const data = await response.json();
      
      setMessages([{
        speaker: "ai",
        text: data.ai_response || "Hello! How can I help you today?",
        timestamp: Date.now()
      }]);
      
      // Play greeting audio
      if (data.audio_data && audioRef.current) {
        setCallStage("speaking");
        audioRef.current.src = `data:audio/wav;base64,${data.audio_data}`;
        audioRef.current.play();
        audioRef.current.onended = () => {
          setCallStage("listening");
          startListening();
        };
      } else {
        setCallStage("listening");
        startListening();
      }
      
    } catch (error) {
      console.error("Error starting call:", error);
      setCallStage("idle");
    }
  };
  
  const startListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        resetSilenceTimer();
      } catch (e) {
        console.error("Failed to start recognition:", e);
      }
    }
  };
  
  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
  };
  
  const processUserSpeech = async (text: string) => {
    stopListening();
    setInputText("");
    
    // Add user message
    setMessages(prev => [...prev, {
      speaker: "user",
      text: text,
      timestamp: Date.now()
    }]);
    
    setCallStage("thinking");
    
    try {
      const params = new URLSearchParams({
        institute_id: instituteId.toString(),
        user_input: text,
        conversation_id: conversationId.current,
        include_audio: "true",
        language: detectedLanguage,
      });
      
      const response = await fetch(`/api/conversation/process?${params}`, {
        method: "POST",
      });
      
      if (!response.ok) {
        throw new Error("Failed to get response");
      }
      
      const data = await response.json();
      
      // Add AI message
      setMessages(prev => [...prev, {
        speaker: "ai",
        text: data.ai_response || "I apologize, I couldn't generate a response.",
        timestamp: Date.now()
      }]);
      
      setCallStage("speaking");
      
      // Play response audio
      if (data.audio_data && audioRef.current) {
        audioRef.current.src = `data:audio/wav;base64,${data.audio_data}`;
        audioRef.current.play();
        audioRef.current.onended = () => {
          setCallStage("listening");
          startListening();
        };
      } else {
        setTimeout(() => {
          setCallStage("listening");
          startListening();
        }, 500);
      }
      
    } catch (error) {
      console.error("Error processing speech:", error);
      setCallStage("listening");
      startListening();
    }
  };
  
  const handleVoiceInterruption = () => {
    if (callStage === "speaking" && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCallStage("listening");
      startListening();
    }
  };
  
  const endCall = async () => {
    stopListening();
    setCallStage("idle");
    setMessages([]);
    setInputText("");
    
    // Clear conversation memory on backend
    try {
      await fetch(`/api/conversation/end?conversation_id=${conversationId.current}`, {
        method: "POST",
      });
    } catch (error) {
      console.error("Error ending conversation:", error);
    }
  };
  
  const handleTextSubmit = () => {
    if (inputText.trim()) {
      processUserSpeech(inputText);
    }
  };
  
  if (callStage === "idle") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card rounded-3xl p-8 border border-white/10 backdrop-blur-xl bg-white/5 max-w-md w-full mx-4"
        >
          <div className="text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center mx-auto">
              <Phone className="w-10 h-10 text-purple-400" />
            </div>
            
            <div>
              <h2 className="text-2xl font-bold mb-2">AI Voice Agent</h2>
              <p className="text-slate-400 text-sm">
                Real-time voice conversation with AI
              </p>
            </div>
            
            <button
              onClick={startCall}
              className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Phone className="w-5 h-5" />
              Start Call
            </button>
          </div>
        </motion.div>
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-4 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
              <Phone className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold">AI Voice Agent</h3>
              <p className="text-xs text-slate-400">Real-time conversation</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Globe className="w-4 h-4 text-slate-400" />
              <span>{detectedLanguage}</span>
            </div>
            <button
              onClick={endCall}
              className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center hover:bg-red-500/30 transition-colors"
            >
              <PhoneOff className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {/* Avatar */}
          <div className="relative mb-8">
            <div className={`w-32 h-32 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center ${
              callStage === "listening" ? "animate-pulse" : "bg-purple-500/20"
            }`}>
              {callStage === "listening" && <Mic className="w-16 h-16 text-purple-400" />}
              {callStage === "thinking" && <Loader2 className="w-16 h-16 text-blue-400 animate-spin" />}
              {callStage === "speaking" && <Volume2 className="w-16 h-16 text-green-400" />}
            </div>
            
            {/* Status */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-medium backdrop-blur-xl border border-white/10">
              {callStage === "listening" && <span className="text-green-400">Listening</span>}
              {callStage === "thinking" && <span className="text-blue-400">Thinking</span>}
              {callStage === "speaking" && <span className="text-purple-400">Speaking</span>}
            </div>
          </div>
          
          {/* Wave Animation */}
          {callStage === "speaking" && (
            <div className="flex items-center gap-1 mb-8">
              {[...Array(5)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-purple-400 rounded-full"
                  animate={{
                    height: [10, 30, 10],
                  }}
                  transition={{
                    duration: 0.5,
                    repeat: Infinity,
                    delay: i * 0.1,
                  }}
                />
              ))}
            </div>
          )}
          
          {/* Messages */}
          <div className="w-full max-w-2xl space-y-4 overflow-y-auto max-h-64">
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.speaker === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`flex gap-2 max-w-[80%] ${msg.speaker === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.speaker === "user"
                      ? "bg-purple-500/20 text-purple-400"
                      : "bg-blue-500/20 text-blue-400"
                  }`}>
                    {msg.speaker === "user" ? <Mic className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </div>
                  <div className={`p-3 rounded-xl ${
                    msg.speaker === "user"
                      ? "bg-purple-500/20 border border-purple-500/30"
                      : "bg-blue-500/20 border border-blue-500/30"
                  }`}>
                    <p className="text-sm">{msg.text}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
          
          {/* Text Input (fallback) */}
          <div className="w-full max-w-2xl mt-8">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
                placeholder="Type here if voice is not working..."
                disabled={callStage !== "listening"}
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
              <button
                onClick={handleTextSubmit}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-4 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
