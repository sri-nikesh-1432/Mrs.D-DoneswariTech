import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Play,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  Clock,
  Brain,
  Volume2,
  MessageSquare,
  User,
  Bot,
  X,
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
    }, 2000)); // 2 seconds of silence
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
  
  const startCall = async () => {
    setCallStage("thinking");
    setMessages([]);
    setDebugInfo(null);
    setInputText("");
    
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
        throw new Error("Failed to start call");
      }
      
      const data = await response.json();
      
      setMessages([{
        role: "ai",
        content: data.ai_response,
        timestamp: new Date().toISOString()
      }]);
      
      setDebugInfo(data.debug_info);
      
      // Play audio
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
  
  const endCall = async () => {
    stopListening();
    setCallStage("idle");
    setMessages([]);
    setDebugInfo(null);
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
  
  const processUserSpeech = async (text: string) => {
    stopListening();
    setInputText("");
    
    // Add user message
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
      
      // Add AI message
      setMessages(prev => [...prev, {
        role: "ai",
        content: data.ai_response,
        timestamp: new Date().toISOString()
      }]);
      
      setDebugInfo(data.debug_info);
      setCallStage("speaking");
      
      // Play audio
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
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center space-y-8 p-8"
        >
          {/* Avatar */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="w-32 h-32 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center mx-auto border-2 border-purple-500/50 shadow-lg shadow-purple-500/20"
          >
            <Bot className="w-16 h-16 text-purple-300" />
          </motion.div>
          
          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h2 className="text-3xl font-bold mb-2 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              Testing Console
            </h2>
            <p className="text-slate-400 text-sm">Developer mode with hardcoded knowledge</p>
          </motion.div>
          
          {/* Knowledge File Selector */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="flex items-center justify-center gap-4"
          >
            <select
              value={knowledgeFile}
              onChange={(e) => setKnowledgeFile(e.target.value)}
              className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <option value="narayana.json">Narayana College</option>
              <option value="services.json">Venixa Services</option>
            </select>
          </motion.div>
          
          {/* Start Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <button
              onClick={startCall}
              className="px-10 py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-all hover:scale-105 flex items-center justify-center gap-3 mx-auto shadow-lg shadow-purple-500/30"
            >
              <Phone className="w-5 h-5" />
              Start Voice Agent
            </button>
          </motion.div>
          
          {/* Info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-xs text-slate-500 space-y-1"
          >
            <p>• Continuous voice conversation</p>
            <p>• Auto language detection</p>
            <p>• Real-time STT & TTS</p>
          </motion.div>
        </motion.div>
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      {/* Header */}
      <div className="p-6 border-b border-white/10 bg-black/20 backdrop-blur-xl flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border border-purple-500/30">
            <Bot className="w-6 h-6 text-purple-300" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Testing Console</h3>
            <p className="text-xs text-slate-400">{knowledgeFile}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-sm bg-white/5 px-3 py-1.5 rounded-lg">
            <Globe className="w-4 h-4 text-slate-400" />
            <span className="text-slate-300">{detectedLanguage}</span>
          </div>
          
          <button
            onClick={endCall}
            className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center hover:bg-red-500/30 transition-all"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Voice Agent (Center) */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {/* Avatar */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative mb-8"
          >
            <div className={`w-40 h-40 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border-2 border-purple-500/50 shadow-2xl shadow-purple-500/20 ${
              callStage === "listening" ? "animate-pulse" : ""
            }`}>
              {callStage === "listening" && <Mic className="w-20 h-20 text-purple-300" />}
              {callStage === "thinking" && <Loader2 className="w-20 h-20 text-blue-400 animate-spin" />}
              {callStage === "speaking" && <Volume2 className="w-20 h-20 text-green-400" />}
            </div>
            
            {/* Status indicator */}
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-xs font-medium backdrop-blur-xl border border-white/20 bg-black/30"
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
          
          {/* Wave Animation */}
          {callStage === "speaking" && (
            <div className="flex items-center gap-1 mb-8">
              {[...Array(7)].map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-gradient-to-t from-purple-500 to-blue-500 rounded-full"
                  animate={{
                    height: [10, 40, 10],
                  }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    delay: i * 0.08,
                  }}
                />
              ))}
            </div>
          )}
          
          {/* Messages */}
          <div className="w-full max-w-2xl space-y-4 overflow-y-auto max-h-48">
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`flex gap-2 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === "user"
                      ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                      : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  }`}>
                    {msg.role === "user" ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                  </div>
                  <div className={`p-4 rounded-xl ${
                    msg.role === "user"
                      ? "bg-purple-500/20 border border-purple-500/30"
                      : "bg-blue-500/20 border border-blue-500/30"
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        
        {/* Developer Console (Right) */}
        <div className="w-[400px] border-l border-white/10 flex flex-col bg-black/20 backdrop-blur-xl">
          {/* Input */}
          <div className="p-4 border-b border-white/10">
            <div className="flex gap-2">
              <button
                onClick={toggleListening}
                disabled={callStage !== "listening"}
                className={`p-3 rounded-xl transition-all ${
                  isListening
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                } disabled:opacity-50`}
              >
                <Mic className="w-5 h-5" />
              </button>
              
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type or use voice..."
                disabled={callStage !== "listening"}
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
              
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || callStage !== "listening"}
                className="px-4 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl text-sm font-medium hover:opacity-90 transition-all disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Debug Panel */}
          {showDebug && debugInfo && (
            <div className="p-4 border-b border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Pipeline Debug</span>
                <RefreshCw className="w-3 h-3 text-slate-400" />
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-slate-400 mb-1">Retrieval</div>
                  <div className="font-mono text-green-400">{debugInfo.retrieval_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-slate-400 mb-1">LLM</div>
                  <div className="font-mono text-blue-400">{debugInfo.llm_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-slate-400 mb-1">TTS</div>
                  <div className="font-mono text-purple-400">{debugInfo.tts_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                  <div className="text-slate-400 mb-1">Total</div>
                  <div className="font-mono text-white">{debugInfo.total_time_ms}ms</div>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-xs bg-white/5 p-2 rounded-lg border border-white/10">
                <Brain className="w-3 h-3 text-purple-400" />
                <span className="text-slate-300">Chunks: {debugInfo.chunks_retrieved}</span>
              </div>
              
              <div className="flex items-center gap-2 text-xs bg-white/5 p-2 rounded-lg border border-white/10">
                <Zap className="w-3 h-3 text-blue-400" />
                <span className="text-slate-300">Source: {debugInfo.knowledge_source}</span>
              </div>
            </div>
          )}
          
          {/* Commands */}
          <div className="p-4 border-b border-white/10">
            <div className="text-xs font-medium text-slate-300 mb-2">Quick Commands</div>
            <div className="space-y-2 text-xs">
              <div className="bg-purple-500/10 border border-purple-500/30 p-2 rounded-lg">
                <div className="text-purple-400 font-mono">/insert &lt;content&gt;</div>
                <div className="text-slate-400 mt-1">Add knowledge without upload</div>
              </div>
            </div>
          </div>
          
          {/* Conversation Log */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <div className="text-xs font-medium text-slate-300 mb-3 sticky top-0 bg-black/20 backdrop-blur-xl py-2">Conversation Log</div>
            {messages.map((msg, idx) => (
              <div key={idx} className={`text-xs p-3 rounded-lg border ${
                msg.role === "user" 
                  ? "bg-purple-500/10 border-purple-500/30" 
                  : "bg-blue-500/10 border-blue-500/30"
              }`}>
                <div className="font-medium mb-1 text-slate-300">{msg.role === "user" ? "You" : "AI"}</div>
                <div className="text-slate-400">{msg.content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
