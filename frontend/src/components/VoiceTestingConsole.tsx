import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Play,
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
  Phone,
  PhoneOff,
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

type CallStage = "idle" | "listening" | "thinking" | "speaking";

export default function VoiceTestingConsole() {
  const navigate = useNavigate();
  const [callStage, setCallStage] = useState<CallStage>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [showDebug, setShowDebug] = useState(true);
  const [knowledgeFile, setKnowledgeFile] = useState("narayana.json");
  const [detectedLanguage, setDetectedLanguage] = useState("English");
  const [silenceTimer, setSilenceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const conversationId = useRef(`test_${Date.now()}`);
  
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
        
        // Handle voice interruption
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
  
  const startCall = () => {
    // Navigate to active call page with knowledge file as parameter
    navigate(`/active-call?knowledge=${knowledgeFile}`);
  };
  
  const endCall = async () => {
    stopListening();
    setCallStage("idle");
    setMessages([]);
    setDebugInfo(null);
    setInputText("");
    
    try {
      await fetch(`/api/conversation/end?conversation_id=${conversationId.current}`, {
        method: "POST",
      });
    } catch (error) {
      console.error("Error ending conversation:", error);
    }
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
  
  if (callStage === "idle") {
    return (
      <div className="h-screen w-screen bg-gradient-to-br from-slate-950 via-purple-950/50 to-slate-950 flex items-center justify-center">
        <div className="max-w-4xl w-full mx-auto p-8">
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => navigate("/")}
            className="mb-8 flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Home
          </motion.button>
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-2xl rounded-3xl border border-white/10 p-12 shadow-2xl"
          >
            <div className="text-center space-y-8">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 150 }}
                className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center mx-auto border-2 border-purple-500/50 shadow-xl shadow-purple-500/30"
              >
                <Bot className="w-12 h-12 text-purple-300" />
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
                  Testing Console
                </h1>
                <p className="text-slate-400 text-lg">Developer mode with hardcoded knowledge</p>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="max-w-md mx-auto"
              >
                <label className="block text-sm text-slate-400 mb-2 text-left">Select Knowledge File</label>
                <select
                  value={knowledgeFile}
                  onChange={(e) => setKnowledgeFile(e.target.value)}
                  className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-xl text-base focus:outline-none focus:border-purple-500/50 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <option value="narayana.json">Narayana College</option>
                  <option value="services.json">Venixa Services</option>
                </select>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <button
                  onClick={startCall}
                  className="px-12 py-5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl font-semibold text-lg hover:opacity-90 transition-all hover:scale-105 flex items-center justify-center gap-3 mx-auto shadow-xl shadow-purple-500/30"
                >
                  <Phone className="w-6 h-6" />
                  Start Voice Agent
                </button>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="flex items-center justify-center gap-8 text-sm text-slate-500 pt-4"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span>Continuous voice</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400" />
                  <span>Auto language detection</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-400" />
                  <span>Real-time STT & TTS</span>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-950 via-purple-950/50 to-slate-950 flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        {/* Voice Agent (Center) */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => navigate("/")}
            className="absolute top-6 left-6 flex items-center gap-2 text-slate-400 hover:text-white transition-colors z-10"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </motion.button>
          
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative mb-8"
          >
            <div className={`w-48 h-48 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border-2 border-purple-500/50 shadow-2xl shadow-purple-500/30 ${
              callStage === "listening" ? "animate-pulse" : ""
            }`}>
              {callStage === "listening" && <Mic className="w-24 h-24 text-purple-300" />}
              {callStage === "thinking" && <Loader2 className="w-24 h-24 text-blue-400 animate-spin" />}
              {callStage === "speaking" && <Volume2 className="w-24 h-24 text-green-400" />}
            </div>
            
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full text-sm font-medium backdrop-blur-xl border border-white/20 bg-black/30"
            >
              {callStage === "listening" && (
                <span className="text-green-400">Listening</span>
              )}
              {callStage === "thinking" && (
                <span className="text-blue-400">Thinking</span>
              )}
              {callStage === "speaking" && (
                <span className="text-purple-400">Speaking</span>
              )}
            </motion.div>
          </motion.div>
          
          {callStage === "speaking" && (
            <div className="flex items-center gap-1 mb-8">
              {[...Array(9)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1.5 bg-gradient-to-t from-purple-500 to-blue-500 rounded-full"
                  animate={{
                    height: [15, 50, 15],
                  }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    delay: i * 0.06,
                  }}
                />
              ))}
            </div>
          )}
          
          <div className="w-full max-w-3xl space-y-4 overflow-y-auto max-h-64">
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`flex gap-3 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
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
                    <p className="text-base">{msg.content}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        
        {/* Developer Console (Right) */}
        <div className="w-[450px] border-l border-white/10 flex flex-col bg-black/30 backdrop-blur-2xl">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Developer Console</h3>
              <div className="flex items-center gap-2 text-sm bg-white/5 px-3 py-1.5 rounded-lg">
                <Globe className="w-4 h-4 text-slate-400" />
                <span className="text-slate-300">{detectedLanguage}</span>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={toggleListening}
                disabled={callStage !== "listening"}
                className={`p-4 rounded-xl transition-all ${
                  isListening
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                } disabled:opacity-50`}
              >
                <Mic className="w-6 h-6" />
              </button>
              
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type or use voice..."
                disabled={callStage !== "listening"}
                className="flex-1 px-5 py-4 bg-white/5 border border-white/10 rounded-xl text-base focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
              
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-6 py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-all disabled:opacity-50"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          {showDebug && debugInfo && (
            <div className="p-6 border-b border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-300">Pipeline Debug</span>
                <RefreshCw className="w-4 h-4 text-slate-400" />
              </div>
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs">Retrieval</div>
                  <div className="font-mono text-green-400 text-lg">{debugInfo.retrieval_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs">LLM</div>
                  <div className="font-mono text-blue-400 text-lg">{debugInfo.llm_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs">TTS</div>
                  <div className="font-mono text-purple-400 text-lg">{debugInfo.tts_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="text-slate-400 mb-2 text-xs">Total</div>
                  <div className="font-mono text-white text-lg">{debugInfo.total_time_ms}ms</div>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-sm bg-white/5 p-3 rounded-xl border border-white/10">
                <Brain className="w-4 h-4 text-purple-400" />
                <span className="text-slate-300">Chunks: {debugInfo.chunks_retrieved}</span>
              </div>
              
              <div className="flex items-center gap-2 text-sm bg-white/5 p-3 rounded-xl border border-white/10">
                <Zap className="w-4 h-4 text-blue-400" />
                <span className="text-slate-300">Source: {debugInfo.knowledge_source}</span>
              </div>
            </div>
          )}
          
          <div className="p-6 border-b border-white/10">
            <div className="text-sm font-medium text-slate-300 mb-3">Quick Commands</div>
            <div className="space-y-2 text-sm">
              <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded-xl">
                <div className="text-purple-400 font-mono text-base">/insert &lt;content&gt;</div>
                <div className="text-slate-400 mt-1 text-xs">Add knowledge without upload</div>
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            <div className="text-sm font-medium text-slate-300 mb-4 sticky top-0 bg-black/30 backdrop-blur-2xl py-2">Conversation Log</div>
            {messages.map((msg, idx) => (
              <div key={idx} className={`text-sm p-4 rounded-xl border ${
                msg.role === "user" 
                  ? "bg-purple-500/10 border-purple-500/30" 
                  : "bg-blue-500/10 border-blue-500/30"
              }`}>
                <div className="font-medium mb-2 text-slate-300">{msg.role === "user" ? "You" : "AI"}</div>
                <div className="text-slate-400">{msg.content}</div>
              </div>
            ))}
          </div>
          
          <div className="p-6 border-t border-white/10">
            <button
              onClick={endCall}
              className="w-full py-4 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl font-medium hover:bg-red-500/30 transition-all flex items-center justify-center gap-3"
            >
              <PhoneOff className="w-5 h-5" />
              End Call
            </button>
          </div>
        </div>
      </div>
      
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
