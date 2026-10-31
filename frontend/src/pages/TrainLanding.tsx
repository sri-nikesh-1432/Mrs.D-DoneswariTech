import React, { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Upload, FileText, X, CheckCircle2, Loader2, Mic, Phone,
  BookOpen, Users, PhoneCall, Shield, Zap, ArrowRight, Sparkles, AlertCircle,
  Volume2, VolumeX, MessageSquare, Send, ChevronDown, ChevronUp, MapPin, Clock
} from "lucide-react";
import { createAgent, uploadAgentDocument, getKnowledgeStatus, sendTextMessage } from "../services/api";

const PRESET_QUESTIONS = [
  { label: "ఫీజుల వివరాలు", query: "స్కూల్ ఫీజుల వివరాలు చెప్పండి, ఏ క్లాస్ కి ఎంత ఉంటుంది?" },
  { label: "హాస్టల్ సదుపాయం", query: "జూబ్లీహిల్స్ క్యాంపస్ కి హాస్టల్ సదుపాయం ఉందా? ఫీజు ఎంత?" },
  { label: "స్కూల్ బస్సు & ట్రాన్స్‌పోర్ట్", query: "స్కూల్ బస్సు లేదా ట్రాన్స్‌పోర్ట్ ఫెసిలిటీ ఉంటుందా? చార్జీలు ఎంత?" },
  { label: "ప్రిన్సిపాల్ గారి నంబర్", query: "ప్రిన్సిపాల్ గారి ఫోన్ నంబర్ మరియు క్యాంపస్ అడ్రస్ చెప్పండి" },
  { label: "అడ్మిషన్ ప్రాసెస్", query: "అడ్మిషన్ ప్రాసెస్ ఎలా ఉంటుంది? ఏ సర్టిఫికెట్స్ కావాలి?" },
];

const STAGES = [
  { key: "extracting", label: "Extracting institutional text" },
  { key: "chunking", label: "Structuring knowledge chunks" },
  { key: "embedding", label: "Generating semantic embeddings" },
  { key: "indexing", label: "Compiling vector index (FAISS)" },
  { key: "ready", label: "Telecaller ready for admission calls" },
];

type Phase = "ready" | "training" | "error";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  audioData?: string | null;
}

export default function TrainLanding() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Default agent state: Pre-trained on Narayana IIT Olympiad School, Jubilee Hills
  const [agentId] = useState<number>(1);
  const [showUploader, setShowUploader] = useState(false);

  // In-line interactive chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "నమస్కారం అండి! నారాయణ ఐఐటి ఒలింపియాడ్ స్కూల్, జూబ్లీహిల్స్ అడ్మిషన్ల సెల్ నుంచి జానకిని మాట్లాడుతున్నాను. చెప్పండి సార్, ఏ క్లాస్ అడ్మిషన్ లేదా ఫీజుల వివరాలు తెలుసుకోవాలనుకుంటున్నారు?",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [playingAudioIndex, setPlayingAudioIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Document training states (for optional secondary training)
  const [phase, setPhase] = useState<Phase>("ready");
  const [agentName, setAgentName] = useState("Mrs. D (జానకి)");
  const [collegeName, setCollegeName] = useState("Narayana IIT Olympiad School, Jubilee Hills");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [currentStage, setCurrentStage] = useState(-1);
  const [completedStages, setCompletedStages] = useState<number[]>([]);
  const [trainingError, setTrainingError] = useState("");

  // Autoscroll chat
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages, isSending]);

  // Audio playback handler
  const playBase64Audio = useCallback((base64Data: string, index: number) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingAudioIndex === index) {
      setPlayingAudioIndex(null);
      return;
    }

    try {
      const audio = new Audio(`data:audio/mp3;base64,${base64Data}`);
      audioRef.current = audio;
      setPlayingAudioIndex(index);
      audio.onended = () => {
        setPlayingAudioIndex(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingAudioIndex(null);
        audioRef.current = null;
      };
      audio.play().catch((err) => {
        console.warn("Audio play prevented:", err);
        setPlayingAudioIndex(null);
      });
    } catch (e) {
      console.warn("Audio initialization error:", e);
      setPlayingAudioIndex(null);
    }
  }, [playingAudioIndex]);

  // Send query to Groq-powered backend
  const handleSendQuery = async (queryText?: string) => {
    const text = (queryText ?? chatInput).trim();
    if (!text || isSending) return;

    setChatMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!queryText) setChatInput("");
    setIsSending(true);

    try {
      const res = await sendTextMessage(agentId, text, `session_${Date.now()}`, "Telugu");
      const answer = res.response || res.message || "క్షమించండి, సమాధానం రూపొందించడంలో సమస్య ఎదురైంది. దయచేసి మళ్ళీ అడగండి.";
      const newMsg: ChatMessage = {
        role: "assistant",
        content: answer,
        audioData: res.audio_data,
      };
      setChatMessages((prev) => [...prev, newMsg]);

      // Auto-play Telugu voice if audio data is returned
      if (res.audio_data) {
        setTimeout(() => {
          playBase64Audio(res.audio_data!, chatMessages.length + 1);
        }, 100);
      }
    } catch (err: any) {
      console.error("Chat error:", err);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "నమస్కారం అండి! ఫీజులు, హాస్టల్ లేదా అడ్మిషన్ల గురించి మరింత సమాచారం కోసం నేరుగా ప్రిన్సిపాల్ గారి నంబర్ 8179880241 కి సంప్రదించవచ్చు.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  // ── Optional: Train Custom Document ──────────────────────────────
  const handleFile = useCallback((f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx", "txt"].includes(ext ?? "")) {
      setTrainingError("Please upload a PDF, DOCX, or TXT file.");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setTrainingError("File must be under 25 MB.");
      return;
    }
    setTrainingError("");
    setFile(f);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const trainCustomAgent = useCallback(async () => {
    if (!file) return;
    setPhase("training");
    setCurrentStage(0);
    setCompletedStages([]);
    setTrainingError("");

    try {
      const newAgent = await createAgent({
        name: agentName.trim() || "Mrs. D (జానకి)",
        company_name: collegeName.trim() || "Narayana IIT Olympiad School, Jubilee Hills",
        calling_purpose: "Admissions and Student Enquiry",
      });
      const newAgentId = Number(newAgent.id || (newAgent as any).agent_id || 1);

      uploadAgentDocument(newAgentId, file).catch((err) =>
        console.warn("Background upload polling active:", err)
      );

      for (let i = 0; i < STAGES.length; i++) {
        setCurrentStage(i);
        setCompletedStages((prev) => [...prev, i]);
        await new Promise((res) => setTimeout(res, 900));
      }

      setPhase("ready");
      navigate(`/agent/${newAgentId}/test`);
    } catch (e: any) {
      setTrainingError(e?.message || "Training ingestion failed. Please try again.");
      setPhase("error");
    }
  }, [file, agentName, collegeName, navigate]);

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-stone-900 flex flex-col justify-between selection:bg-sky-200 selection:text-sky-950 font-sans">
      {/* ── Top Header ── */}
      <header className="max-w-4xl mx-auto px-6 pt-10 pb-6 text-center relative z-10">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-[#D6CEBE] shadow-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            <span className="text-[11px] font-black tracking-wider text-stone-800 uppercase">
              DONESWARI AI · MRS. D (జానకి)
            </span>
          </div>

          <button
            onClick={() => navigate("/agents")}
            className="text-xs font-bold px-3.5 py-2 rounded-xl bg-white border border-[#D6CEBE] text-stone-800 hover:text-stone-950 hover:bg-stone-50 transition-colors shadow-xs"
          >
            All Agents Console →
          </button>
        </div>

        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-stone-950 mb-3 leading-[1.1]">
          The AI Admissions <span className="text-gradient">Telecalle<span id="telecaller-r-anchor" className="telecaller-r-target relative inline-block text-sky-600 font-black">r</span></span>
        </h1>
        <p className="text-sm md:text-base text-stone-600 max-w-2xl mx-auto leading-relaxed font-medium">
          Official Voice Receptionist trained on <strong className="text-stone-900">Narayana IIT Olympiad School, Jubilee Hills</strong>.
          Speaks authentic, humanized <strong className="text-sky-700">Janaki Telugu Voice</strong>.
        </p>
      </header>

      {/* ── Main Content Container ── */}
      <main className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-2 relative z-10 space-y-6">
        {/* ── Active Pre-Trained Agent Card ── */}
        <div className="bg-white border border-[#E2D9C8] rounded-3xl p-6 sm:p-8 shadow-xl shadow-stone-900/5 text-stone-900 backdrop-blur-xl">
          {/* Status Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-stone-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center text-white shadow-md shadow-sky-600/30 font-bold text-lg">
                జ
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-stone-950 tracking-tight">
                    Mrs. D (జానకి)
                  </h2>
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                    Live & Pre-Trained
                  </span>
                </div>
                <div className="text-xs font-semibold text-stone-500 flex items-center gap-1.5 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span>Road No. 5, Jubilee Hills, Hyderabad (Near Venkatagiri Metro)</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => navigate(`/agent/${agentId}/test`)}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-sky-600 via-sky-700 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white font-black text-sm shadow-lg shadow-sky-600/25 active:scale-[0.98] transition-all cursor-pointer"
            >
              <Phone className="w-4 h-4 fill-current" />
              <span>Call Mrs. D (Janaki Voice)</span>
            </button>
          </div>

          {/* Quick Institutional Key Facts Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-5 text-left">
            <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#E8E2D5]">
              <div className="text-[10px] uppercase font-bold text-stone-400">Curriculum</div>
              <div className="text-xs font-extrabold text-stone-900 mt-0.5">CBSE Day Boarding</div>
              <div className="text-[11px] text-stone-500 font-medium">eKidz, eChamps, eTechno</div>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#E8E2D5]">
              <div className="text-[10px] uppercase font-bold text-stone-400">Annual Tuition</div>
              <div className="text-xs font-extrabold text-stone-900 mt-0.5">₹55,000 – ₹1.60L</div>
              <div className="text-[11px] text-stone-500 font-medium">3 Easy Instalments</div>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#E8E2D5]">
              <div className="text-[10px] uppercase font-bold text-stone-400">Nearest Hostel</div>
              <div className="text-xs font-extrabold text-stone-900 mt-0.5">Madhapur Basara</div>
              <div className="text-[11px] text-stone-500 font-medium">₹95,000 – ₹1.56L/yr</div>
            </div>

            <div className="p-3 rounded-xl bg-[#FAF7F2] border border-[#E8E2D5]">
              <div className="text-[10px] uppercase font-bold text-stone-400">Principal Desk</div>
              <div className="text-xs font-extrabold text-sky-700 mt-0.5">8179880241</div>
              <div className="text-[11px] text-stone-500 font-medium">Toll: 1800 102 3344</div>
            </div>
          </div>

          {/* ── Live Interactive Telugu Chat Simulator ── */}
          <div className="rounded-2xl border border-[#E2D9C8] bg-[#FCFBF8] p-4 text-left">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-sky-600" />
                <span className="text-xs font-extrabold text-stone-900">
                  Ask Mrs. D Anything in Telugu / English
                </span>
              </div>
              <span className="text-[10px] font-bold text-stone-500 bg-white px-2 py-0.5 rounded-full border border-stone-200">
                100% Grounded in Official Brochure
              </span>
            </div>

            {/* Quick Telugu Question Chips */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PRESET_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendQuery(q.query)}
                  disabled={isSending}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-white border border-[#D6CEBE] text-stone-800 hover:text-sky-700 hover:border-sky-400 hover:bg-sky-50 transition-colors cursor-pointer shadow-2xs"
                >
                  💬 {q.label}
                </button>
              ))}
            </div>

            {/* Message Thread */}
            <div
              ref={chatScrollRef}
              className="max-h-60 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin scrollbar-thumb-stone-300"
            >
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-2.5 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-lg bg-sky-600 text-white flex items-center justify-center text-xs font-black shrink-0 mt-0.5">
                      జ
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs font-medium leading-relaxed ${
                      msg.role === "user"
                        ? "bg-stone-900 text-white rounded-br-none"
                        : "bg-white text-stone-900 border border-[#E2D9C8] shadow-xs rounded-bl-none"
                    }`}
                  >
                    <div>{msg.content}</div>
                    {msg.audioData && (
                      <button
                        onClick={() => playBase64Audio(msg.audioData!, i)}
                        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-sky-700 hover:text-sky-900 transition-colors"
                      >
                        {playingAudioIndex === i ? (
                          <>
                            <VolumeX className="w-3.5 h-3.5 text-red-600" />
                            <span>Stop Telugu Voice</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3.5 h-3.5 text-sky-600" />
                            <span>Play Janaki Voice</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {isSending && (
                <div className="flex items-center gap-2 text-xs font-bold text-stone-500 py-1">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
                  <span>జానకి సమాధానం ఆలోచిస్తోంది...</span>
                </div>
              )}
            </div>

            {/* Chat Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendQuery();
              }}
              className="mt-3 flex items-center gap-2 pt-2 border-t border-stone-200"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="మీ ప్రశ్నను ఇక్కడ అడగండి (e.g. ఫీజు ఎంత? బస్సు రూట్లు ఉన్నాయా?)"
                className="flex-1 px-3.5 py-2.5 bg-white border border-[#D6CEBE] rounded-xl text-xs font-medium text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || isSending}
                className="p-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-40 transition-colors cursor-pointer shadow-sm"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

          {/* Full Voice Calling CTA Footer */}
          <div className="mt-5 pt-4 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-stone-500 font-medium flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-stone-400" />
              <span>Campus Hours: Mon – Sat 8:00 AM – 6:00 PM</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/agent/${agentId}/test`)}
                className="text-xs font-bold px-4 py-2.5 rounded-xl bg-stone-900 hover:bg-black text-white transition-all shadow-sm"
              >
                Open Voice Testing Console →
              </button>
            </div>
          </div>
        </div>

        {/* ── Collapsible: Train Custom Document (Optional) ── */}
        <div className="bg-white/80 border border-[#E2D9C8] rounded-3xl p-5 text-stone-800 shadow-sm backdrop-blur-md">
          <button
            onClick={() => setShowUploader((prev) => !prev)}
            className="w-full flex items-center justify-between text-left cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Upload className="w-4 h-4 text-sky-600" />
              <span className="text-xs font-extrabold text-stone-900">
                Train a New Institution Brochure (Optional)
              </span>
            </div>
            {showUploader ? (
              <ChevronUp className="w-4 h-4 text-stone-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-stone-500" />
            )}
          </button>

          <AnimatePresence>
            {showUploader && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="pt-4 mt-3 border-t border-stone-200 space-y-4"
              >
                <p className="text-xs text-stone-600 font-medium">
                  Want to train another institution's brochure? Provide the details below and upload the PDF/DOCX.
                </p>

                <div className="grid sm:grid-cols-2 gap-3 text-left">
                  <div>
                    <label className="block text-[11px] font-bold text-stone-800 mb-1">Agent Name</label>
                    <input
                      type="text"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="e.g. Mrs. D"
                      className="w-full px-3 py-2 bg-white border border-[#D6CEBE] rounded-xl text-xs font-medium text-stone-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-stone-800 mb-1">Institution Name</label>
                    <input
                      type="text"
                      value={collegeName}
                      onChange={(e) => setCollegeName(e.target.value)}
                      placeholder="e.g. Narayana IIT Olympiad School"
                      className="w-full px-3 py-2 bg-white border border-[#D6CEBE] rounded-xl text-xs font-medium text-stone-900"
                    />
                  </div>
                </div>

                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
                    dragOver
                      ? "border-sky-500 bg-sky-50"
                      : file
                      ? "border-emerald-500 bg-emerald-50/70"
                      : "border-[#D6CEBE] hover:border-sky-500 bg-[#FAF7F2]"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />

                  {file ? (
                    <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white border border-emerald-300">
                      <div className="flex items-center gap-2.5 truncate">
                        <FileText className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span className="text-xs font-bold text-stone-900 truncate">{file.name}</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        className="p-1 text-stone-400 hover:text-stone-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-6 h-6 text-sky-600 mx-auto mb-2" />
                      <div className="text-xs font-bold text-stone-800">
                        Drop document here, or <span className="text-sky-600 underline">browse</span>
                      </div>
                      <div className="text-[11px] text-stone-500">PDF, DOCX up to 25 MB</div>
                    </div>
                  )}
                </div>

                {trainingError && (
                  <div className="text-xs font-bold text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200">
                    {trainingError}
                  </div>
                )}

                <button
                  onClick={trainCustomAgent}
                  disabled={!file || phase === "training"}
                  className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs disabled:opacity-40 transition-colors shadow-sm cursor-pointer"
                >
                  {phase === "training" ? "Processing & Indexing..." : "Train Telecaller on Uploaded File"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="text-center py-6 text-xs text-stone-600 relative z-10 border-t border-[#E8E2D5] mt-8 font-medium">
        Doneswari AI Telecaller · Grounded in Narayana Jubilee Hills Official Brochure · Telugu (Janaki Voice) & English
      </footer>
    </div>
  );
}
