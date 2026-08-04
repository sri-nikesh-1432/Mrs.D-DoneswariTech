import React, { useState, useRef, useEffect } from "react";
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
} from "lucide-react";

interface Message {
  role: "user" | "ai";
  content: string;
  timestamp: string;
}

interface DebugInfo {
  retrieval_time_ms: number;
  llm_time_ms: number;
  tts_time_ms: number;
  total_time_ms: number;
  chunks_retrieved: number;
  knowledge_source: string;
}

type CallStage = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export default function ActiveCall() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const knowledgeFile = searchParams.get("knowledge") || "narayana.json";
  
  const [callStage, setCallStage] = useState<CallStage>("connecting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [showDebug, setShowDebug] = useState(true);
  const [detectedLanguage, setDetectedLanguage] = useState("English");
  const [silenceTimer, setSilenceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");
  
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const conversationId = useRef(`call_${Date.now()}`);
  
  // Setup Web Speech API
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
          setError("Microphone access denied. Please allow microphone access.");
          setCallStage("error");
        }
      };
      
      recognitionRef.current.onend = () => {
        if (callStage === "listening") {
          try {
            recognitionRef.current.start();
          } catch (e) {
            console.error("Failed to restart recognition:", e);
          }
        }
      };
    }
    
    return () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [callStage]);
  
  // Start call on mount
  useEffect(() => {
    initializeCall();
  }, []);
  
  const initializeCall = async () => {
    setCallStage("connecting");
    setError("");
    
    try {
      const params = new URLSearchParams({
        knowledge_file: knowledgeFile,
        user_input: "",
        conversation_id: conversationId.current,
        include_audio: "true",
        is_greeting: "true",
        language: detectedLanguage,
      });
      
      const response = await fetch(`/api/conversation/test?${params}`, {
        method: "POST",
      });
      
      if (!response.ok) {
        throw new Error("Failed to connect to voice agent");
      }
      
      const data = await response.json();
      
      setMessages([{
        role: "ai",
        content: data.ai_response,
        timestamp: new Date().toISOString()
      }]);
      
      setDebugInfo(data.debug_info);
      setCallStage("speaking");
      
      if (data.audio_data && audioRef.current) {
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
      console.error("Error initializing call:", error);
      setError("Failed to connect to voice agent. Please check if the backend is running.");
      setCallStage("error");
    }
  };
  
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
    if (silenceTimer) {
      clearTimeout(silenceTimer);
    }
    setSilenceTimer(setTimeout(() => {
      if (callStage === "listening" && inputText.trim()) {
        processUserSpeech(inputText);
      }
    }, 2000));
  };
  
  const handleVoiceInterruption = () => {
    if (callStage === "speaking" && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCallStage("listening");
      startListening();
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
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      setSilenceTimer(null);
    }
  };
  
  const toggleListening = () => {
    if (isListening) {
      stopListening();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
        resetSilenceTimer();
      } catch (e) {
        console.error("Failed to start recognition:", e);
      }
    }
  };
  
  const endCall = async () => {
    stopListening();
    
    try {
      await fetch(`/api/conversation/end?conversation_id=${conversationId.current}`, {
        method: "POST",
      });
    } catch (error) {
      console.error("Error ending conversation:", error);
    }
    
    navigate("/testing-console");
  };
  
  const processUserSpeech = async (text: string) => {
    stopListening();
    setInputText("");
    
    setMessages(prev => [...prev, {
      role: "user",
      content: text,
      timestamp: new Date().toISOString()
    }]);
    
    setCallStage("thinking");
    
    try {
      const params = new URLSearchParams({
        knowledge_file: knowledgeFile,
        user_input: text,
        conversation_id: conversationId.current,
        include_audio: "true",
        language: detectedLanguage,
      });
      
      const response = await fetch(`/api/conversation/test?${params}`, {
        method: "POST",
      });
      
      if (!response.ok) {
        throw new Error("Failed to get response");
      }
      
      const data = await response.json();
      
      setMessages(prev => [...prev, {
        role: "ai",
        content: data.ai_response,
        timestamp: new Date().toISOString()
      }]);
      
      setDebugInfo(data.debug_info);
      setCallStage("speaking");
      
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
      setMessages(prev => [...prev, {
        role: "ai",
        content: "Sorry, something went wrong. Please try again.",
        timestamp: new Date().toISOString()
      }]);
      setCallStage("listening");
      startListening();
    }
  };
  
  const sendMessage = async () => {
    if (!inputText.trim() || isProcessing) return;
    await processUserSpeech(inputText.trim());
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
            <h1 className="text-3xl font-bold mb-4 text-white">Connection Error</h1>
            <p className="text-slate-400 mb-8">{error}</p>
            <div className="space-y-3">
              <button
                onClick={initializeCall}
                className="w-full py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-5 h-5" />
                Retry Connection
              </button>
              <button
                onClick={() => navigate("/testing-console")}
                className="w-full py-4 bg-white/5 border border-white/10 rounded-xl font-medium hover:bg-white/10 transition-all"
              >
                Back to Console
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
            <span className="text-sm font-medium">Back</span>
          </motion.button>
          
          <div className="h-6 w-px bg-white/10" />
          
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              callStage === "connecting" ? "bg-yellow-400 animate-pulse" :
              callStage === "listening" ? "bg-green-400" :
              callStage === "thinking" ? "bg-blue-400 animate-pulse" :
              callStage === "speaking" ? "bg-purple-400" :
              "bg-slate-400"
            }`} />
            <span className="text-sm text-slate-300">
              {callStage === "connecting" ? "Connecting..." :
               callStage === "listening" ? "Listening" :
               callStage === "thinking" ? "Thinking" :
               callStage === "speaking" ? "Speaking" :
               "Idle"}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl border border-white/10">
            <Globe className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300">{detectedLanguage}</span>
          </div>
          
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={endCall}
            className="flex items-center gap-2 px-6 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl hover:bg-red-500/30 transition-all"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="text-sm font-medium">End Call</span>
          </motion.button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Voice Agent (Center) */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative mb-12"
          >
            {/* Outer glow */}
            <div className={`absolute inset-0 rounded-full blur-3xl ${
              callStage === "listening" ? "bg-purple-500/20 animate-pulse" :
              callStage === "thinking" ? "bg-blue-500/20 animate-pulse" :
              callStage === "speaking" ? "bg-green-500/20 animate-pulse" :
              "bg-transparent"
            }`} />
            
            {/* Avatar circle */}
            <div className={`relative w-56 h-56 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border-2 border-purple-500/30 shadow-2xl ${
              callStage === "listening" ? "animate-pulse" : ""
            }`}>
              {callStage === "connecting" && <Loader2 className="w-28 h-28 text-yellow-400 animate-spin" />}
              {callStage === "listening" && <Mic className="w-28 h-28 text-purple-300" />}
              {callStage === "thinking" && <Brain className="w-28 h-28 text-blue-400 animate-pulse" />}
              {callStage === "speaking" && <Volume2 className="w-28 h-28 text-green-400" />}
            </div>
            
            {/* Status badge */}
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full text-sm font-medium backdrop-blur-xl border border-white/20 bg-black/40"
            >
              {callStage === "connecting" && <span className="text-yellow-400">Connecting...</span>}
              {callStage === "listening" && <span className="text-green-400">Listening</span>}
              {callStage === "thinking" && <span className="text-blue-400">Thinking</span>}
              {callStage === "speaking" && <span className="text-purple-400">Speaking</span>}
            </motion.div>
          </motion.div>
          
          {/* Wave Animation */}
          {callStage === "speaking" && (
            <div className="flex items-center gap-1.5 mb-12">
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-2 bg-gradient-to-t from-purple-500 to-blue-500 rounded-full"
                  animate={{
                    height: [20, 60, 20],
                  }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    delay: i * 0.05,
                  }}
                />
              ))}
            </div>
          )}
          
          {/* Messages */}
          <div className="w-full max-w-4xl space-y-4 overflow-y-auto max-h-64 px-4">
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex gap-4 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                      msg.role === "user"
                        ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                        : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    }`}>
                      {msg.role === "user" ? <User className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
                    </div>
                    <div className={`p-5 rounded-2xl ${
                      msg.role === "user"
                        ? "bg-purple-500/20 border border-purple-500/30"
                        : "bg-blue-500/20 border border-blue-500/30"
                    }`}>
                      <p className="text-base leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
        
        {/* Developer Console (Right) */}
        <div className="w-[500px] border-l border-white/10 flex flex-col bg-black/30 backdrop-blur-2xl">
          {/* Input Section */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-semibold text-lg text-white">Developer Console</h3>
              <div className="flex-1" />
              <button
                onClick={() => setShowDebug(!showDebug)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            
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
              >
                <Mic className="w-6 h-6" />
              </motion.button>
              
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type your message..."
                disabled={callStage !== "listening"}
                className="flex-1 px-5 py-4 bg-white/5 border border-white/10 rounded-xl text-base focus:outline-none focus:border-purple-500/50 disabled:opacity-50 placeholder:text-slate-500"
              />
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={sendMessage}
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
                <span className="text-sm font-medium text-slate-300">Pipeline Debug</span>
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Active</span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs uppercase tracking-wider">Retrieval</div>
                  <div className="font-mono text-green-400 text-xl font-bold">{debugInfo.retrieval_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs uppercase tracking-wider">LLM</div>
                  <div className="font-mono text-blue-400 text-xl font-bold">{debugInfo.llm_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs uppercase tracking-wider">TTS</div>
                  <div className="font-mono text-purple-400 text-xl font-bold">{debugInfo.tts_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs uppercase tracking-wider">Total</div>
                  <div className="font-mono text-white text-xl font-bold">{debugInfo.total_time_ms}ms</div>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-sm bg-white/5 p-4 rounded-xl border border-white/10">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-slate-300">Chunks Retrieved: <span className="text-white font-medium">{debugInfo.chunks_retrieved}</span></span>
              </div>
              
              <div className="flex items-center gap-2 text-sm bg-white/5 p-4 rounded-xl border border-white/10">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-slate-300">Knowledge Source: <span className="text-white font-medium">{debugInfo.knowledge_source}</span></span>
              </div>
            </div>
          )}
          
          {/* Commands */}
          <div className="p-6 border-b border-white/10">
            <div className="text-sm font-medium text-slate-300 mb-3">Quick Commands</div>
            <div className="space-y-2 text-sm">
              <div className="bg-purple-500/10 border border-purple-500/30 p-4 rounded-xl">
                <div className="text-purple-400 font-mono text-base mb-1">/insert &lt;content&gt;</div>
                <div className="text-slate-400 text-xs">Add knowledge without uploading PDF</div>
              </div>
            </div>
          </div>
          
          {/* Conversation Log */}
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            <div className="text-sm font-medium text-slate-300 mb-4 sticky top-0 bg-black/30 backdrop-blur-2xl py-2 border-b border-white/10 pb-4">
              Conversation Log
            </div>
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`text-sm p-4 rounded-xl border ${
                    msg.role === "user" 
                      ? "bg-purple-500/10 border-purple-500/30" 
                      : "bg-blue-500/10 border-blue-500/30"
                  }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${
                      msg.role === "user" ? "bg-purple-400" : "bg-blue-400"
                    }`} />
                    <span className="font-medium text-slate-300">{msg.role === "user" ? "You" : "AI"}</span>
                  </div>
                  <div className="text-slate-400 leading-relaxed">{msg.content}</div>
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
