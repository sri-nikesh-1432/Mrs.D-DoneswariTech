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
  
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const conversationId = useRef(`test_${Date.now()}`);
  
  // Setup Web Speech API
  useEffect(() => {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = "en-IN";
      
      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setInputText(finalTranscript);
          detectLanguage(finalTranscript);
          setIsListening(false);
        }
      };
      
      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };
      
      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);
  
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
  
  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        console.error("Failed to start recognition:", e);
      }
    }
  };
  
  const startCall = async () => {
    setCallStage("thinking");
    setMessages([]);
    setDebugInfo(null);
    
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
        };
      } else {
        setCallStage("listening");
      }
      
    } catch (error) {
      console.error("Error starting call:", error);
      setCallStage("idle");
    }
  };
  
  const endCall = () => {
    setCallStage("idle");
    setMessages([]);
    setDebugInfo(null);
    setInputText("");
  };
  
  const sendMessage = async () => {
    if (!inputText.trim() || isProcessing) return;
    
    const userMessage = inputText.trim();
    setInputText("");
    setIsProcessing(true);
    setCallStage("thinking");
    
    // Add user message
    setMessages(prev => [...prev, {
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString()
    }]);
    
    try {
      const params = new URLSearchParams({
        knowledge_file: knowledgeFile,
        user_input: userMessage,
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
      
      // Play audio
      if (data.audio_data && audioRef.current) {
        setCallStage("speaking");
        audioRef.current.src = `data:audio/wav;base64,${data.audio_data}`;
        audioRef.current.play();
        audioRef.current.onended = () => {
          setCallStage("listening");
        };
      } else {
        setCallStage("listening");
      }
      
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages(prev => [...prev, {
        role: "ai",
        content: "Sorry, something went wrong. Please try again.",
        timestamp: new Date().toISOString()
      }]);
      setCallStage("listening");
    } finally {
      setIsProcessing(false);
    }
  };
  
  if (callStage === "idle") {
    return (
      <div className="h-full flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center space-y-6"
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center mx-auto">
            <Bot className="w-10 h-10 text-purple-400" />
          </div>
          
          <div>
            <h2 className="text-2xl font-bold mb-2">Testing Console</h2>
            <p className="text-slate-400 text-sm">Developer mode with hardcoded knowledge</p>
          </div>
          
          <div className="flex items-center justify-center gap-4">
            <select
              value={knowledgeFile}
              onChange={(e) => setKnowledgeFile(e.target.value)}
              className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50"
            >
              <option value="narayana.json">Narayana College</option>
              <option value="services.json">Venixa Services</option>
            </select>
          </div>
          
          <button
            onClick={startCall}
            className="px-8 py-4 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 mx-auto"
          >
            <Play className="w-5 h-5" />
            Start Voice Agent
          </button>
        </motion.div>
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold">Testing Console</h3>
            <p className="text-xs text-slate-400">{knowledgeFile}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Globe className="w-4 h-4 text-slate-400" />
            <span>{detectedLanguage}</span>
          </div>
          
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showDebug ? "rotate-180" : ""}`} />
          </button>
          
          <button
            onClick={endCall}
            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-red-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Voice Agent (Center) */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          {/* Avatar */}
          <div className="relative mb-8">
            <div className={`w-32 h-32 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center ${
              callStage === "listening" ? "animate-pulse" : ""
            }`}>
              <Bot className="w-16 h-16 text-purple-400" />
            </div>
            
            {/* Status indicator */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-xl border border-white/10">
              {callStage === "listening" && (
                <span className="text-green-400">Listening</span>
              )}
              {callStage === "thinking" && (
                <span className="text-blue-400">Thinking</span>
              )}
              {callStage === "speaking" && (
                <span className="text-purple-400">Speaking</span>
              )}
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
          <div className="w-full max-w-md space-y-4 overflow-y-auto max-h-64">
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`flex gap-2 max-w-[80%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === "user"
                      ? "bg-purple-500/20 text-purple-400"
                      : "bg-blue-500/20 text-blue-400"
                  }`}>
                    {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={`p-3 rounded-xl ${
                    msg.role === "user"
                      ? "bg-purple-500/20 border border-purple-500/30"
                      : "bg-blue-500/20 border border-blue-500/30"
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                </div>
              </motion.div>
            ))}
            
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="bg-blue-500/20 border border-blue-500/30 p-3 rounded-xl">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                </div>
              </motion.div>
            )}
          </div>
        </div>
        
        {/* Developer Console (Right) */}
        <div className="w-96 border-l border-white/10 flex flex-col">
          {/* Input */}
          <div className="p-4 border-b border-white/10">
            <div className="flex gap-2">
              <button
                onClick={toggleListening}
                disabled={isProcessing}
                className={`p-3 rounded-xl transition-colors ${
                  isListening
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                }`}
              >
                <Mic className="w-5 h-5" />
              </button>
              
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type or use voice..."
                disabled={isProcessing}
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-purple-500/50 disabled:opacity-50"
              />
              
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || isProcessing}
                className="px-4 py-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Debug Panel */}
          {showDebug && debugInfo && (
            <div className="p-4 border-b border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Pipeline Debug</span>
                <RefreshCw className="w-3 h-3 text-slate-400" />
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/5 rounded-lg p-2">
                  <div className="text-slate-400">Retrieval</div>
                  <div className="font-mono">{debugInfo.retrieval_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2">
                  <div className="text-slate-400">LLM</div>
                  <div className="font-mono">{debugInfo.llm_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2">
                  <div className="text-slate-400">TTS</div>
                  <div className="font-mono">{debugInfo.tts_time_ms}ms</div>
                </div>
                <div className="bg-white/5 rounded-lg p-2">
                  <div className="text-slate-400">Total</div>
                  <div className="font-mono">{debugInfo.total_time_ms}ms</div>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-xs">
                <Brain className="w-3 h-3 text-purple-400" />
                <span className="text-slate-400">Chunks: {debugInfo.chunks_retrieved}</span>
              </div>
              
              <div className="flex items-center gap-2 text-xs">
                <Zap className="w-3 h-3 text-blue-400" />
                <span className="text-slate-400">Source: {debugInfo.knowledge_source}</span>
              </div>
            </div>
          )}
          
          {/* Commands */}
          <div className="p-4 border-b border-white/10">
            <div className="text-xs text-slate-400 mb-2">Quick Commands</div>
            <div className="space-y-1 text-xs">
              <div className="text-purple-400">/insert &lt;content&gt;</div>
              <div className="text-slate-500">Add knowledge without upload</div>
            </div>
          </div>
          
          {/* Conversation Log */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <div className="text-xs text-slate-400 mb-2">Conversation Log</div>
            {messages.map((msg, idx) => (
              <div key={idx} className={`text-xs p-2 rounded ${
                msg.role === "user" ? "bg-purple-500/10" : "bg-blue-500/10"
              }`}>
                <div className="font-medium mb-1">{msg.role === "user" ? "You" : "AI"}</div>
                <div className="text-slate-300">{msg.content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
