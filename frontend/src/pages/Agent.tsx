import React, { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AgentOrb from "../components/AgentOrb";
import ListeningPopup from "../components/ListeningPopup";
import VoiceWaveform from "../components/VoiceWaveform";
import { voiceWebSocket, VoiceWSState } from "../services/voiceWebSocket";
import { getInstitute } from "../services/api";

const VOICE_STATES: Record<VoiceWSState, "idle" | "connecting" | "listening" | "thinking" | "speaking" | "calling" | "connected" | "ended" | "error" | "greeting"> = {
  disconnected: "idle",
  connecting: "connecting",
  connected: "connected",
  greeting: "greeting",
  listening: "listening",
  processing: "thinking",
  speaking: "speaking",
  error: "error",
};

const MEMORY_FIELDS = [
  "Name",
  "Phone",
  "Student Name",
  "Class",
  "Course",
  "Location",
  "Budget",
  "Hostel",
  "Transport",
  "Interest",
  "Objections",
  "Preferred callback",
];

export default function Agent() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<VoiceWSState>("disconnected");
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string; timestamp: string }[]>([]);
  const [memory, setMemory] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [microOn, setMicroOn] = useState(false);
  const [amplitude, setAmplitude] = useState(0);
  const [lang, setLang] = useState("English");
  const [instituteName, setInstituteName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<ReturnType<typeof voiceWebSocket.connect> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const connect = useCallback(async () => {
    if (!agentId) return;
    setState("connecting");
    try {
      // Resolve the real institute config from the backend so the WS hello
      // carries the actual institute_id and we display the real business name.
      const institute = await getInstitute(agentId);
      setInstituteName(institute.name || "");
      setPhoneNumber(institute.phone_number || "");

      await voiceWebSocket.connect(
        {
          mode: "test",
          knowledgeFile: "institute.json",
          instituteId: Number(institute.id) || 1,
          language: lang,
        },
        {
          onStateChange: setState,
          onMessage: (m) => setMessages((prev) => [...prev, m]),
          onMessageUpdate: () => {},
          onSentence: () => {},
          onTranscript: (text, detectedLang) => {
            setMessages((prev) => [...prev, { role: "user", content: text, timestamp: new Date().toISOString() }]);
            setLang(detectedLang);
          },
          onTurnDone: (aiResponse, debugInfo) => {
            setMessages((prev) => [...prev, { role: "ai", content: aiResponse, timestamp: new Date().toISOString() }]);
            if (debugInfo) {
              setMemory((m) => {
                Object.entries(debugInfo as Record<string, string>).forEach(([k, v]) => {
                  if (MEMORY_FIELDS.some((f) => f.toLowerCase().includes(k.toLowerCase()))) {
                    m[k] = v;
                  }
                });
                return m;
              });
            }
          },
          onError: (detail) => {
            console.error(detail);
            setState("error");
          },
        }
      );
    } catch (e: any) {
      console.error("Agent connect failed:", e);
      setState("error");
    } finally {
      setLoading(false);
    }
  }, [agentId, lang]);

  useEffect(() => {
    connect();
    return () => {
      voiceWebSocket.disconnect();
    };
  }, [connect]);

  // Show a short loading state while we resolve the institute from the backend.
  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-2 border-neutral-300 border-t-transparent animate-spin mx-auto mb-3" />
          <p className="text-sm text-neutral-500">Loading Mrs.D…</p>
        </div>
      </div>
    );
  }

  const toggleMic = async () => {
    if (microOn) {
      voiceWebSocket.stopMicrophone();
      setMicroOn(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      setAmplitude(0);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        setAmplitude(avg);
        requestAnimationFrame(tick);
      };
      tick();
      setMicroOn(true);
      voiceWebSocket.startMicrophone();
    } catch (e) {
      console.error(e);
    }
  };

  const sendText = () => {
    if (!input.trim()) return;
    // For text input we emulate a microphone-less path by sending a silent PCM frame
    // Actually the WS expects PCM; for text fallback we just append a user message
    // and request a response via the existing REST pipeline (future enhancement).
    // For now: log and clear.
    console.log("Text input (future STT shortcut):", input.trim());
    setInput("");
  };

  const orbState = VOICE_STATES[state] ?? "idle";
  const isActive = state === "listening" || state === "speaking" || state === "processing" || state === "connected" || state === "greeting";

  return (
    <div className="h-screen w-full flex flex-col bg-neutral-50 overflow-hidden">
      {/* Top bar */}
      <header className="glass-nav px-4 py-3 flex items-center justify-between z-20 border-b border-neutral-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center shadow-sm">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-display text-lg text-neutral-900 leading-none">Mrs.D</div>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
              <span className="status-dot green" />
              <span>{instituteName || "Published"}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost-premium text-xs"
            onClick={() => navigate("/calls")}
          >
            Calls & Leads
          </button>
          <button
            className="btn-ghost-premium text-xs"
            onClick={() => navigate("/settings")}
          >
            Settings
          </button>
          <div className="w-7 h-7 rounded-full bg-neutral-200 text-neutral-700 text-xs font-medium flex items-center justify-center">
            U
          </div>
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Center voice area */}
        <div className="flex-1 flex flex-col items-center justify-center relative px-4">
          {/* Orb */}
          <div className="mb-6 flex flex-col items-center">
            <AgentOrb state={orbState} />
          </div>

          {/* Listening popup */}
          {microOn && state === "listening" && (
            <ListeningPopup amplitude={amplitude} lang={lang} />
          )}

          {/* Waveform display during speaking */}
          {(state === "speaking" || state === "listening") && (
            <div className="mt-4 flex items-center justify-center">
              <VoiceWaveform
                bars={28}
                color={state === "speaking" ? "ai" : "user"}
                active
                amplitude={amplitude}
                className="w-72"
              />
            </div>
          )}

          {/* Transcript area */}
          <div className="w-full max-w-lg mt-6 mx-auto flex flex-col gap-3 overflow-y-auto max-h-48">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "ai" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === "ai"
                    ? "bg-white/70 text-neutral-900 border border-neutral-100 shadow-sm"
                    : "bg-neutral-100 text-neutral-800"
                }`}>
                  {m.role === "ai" ? <span className="text-[10px] text-neutral-400 font-medium block mb-0.5">Mrs.D</span> : null}
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right memory panel */}
        <aside className="w-72 bg-white/70 border-l border-neutral-200 p-4 flex flex-col gap-4 overflow-y-auto hidden sm:flex">
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Caller Memory</div>
          <div className="flex flex-col gap-2.5">
            {MEMORY_FIELDS.map((f) => (
              <div key={f} className="flex justify-between text-sm">
                <span className="text-neutral-500">{f}</span>
                <span className="text-neutral-900 font-medium">{memory[f] || "—"}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 border-t border-neutral-200 bg-white/70 px-4 py-3 flex items-center gap-3 z-20">
        <button
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${microOn ? "bg-red-100 text-red-500 ring-2 ring-red-300" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
          onClick={toggleMic}
        >
          {microOn ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          )}
        </button>
        <input
          className="flex-1 glass-input text-sm py-2"
          placeholder="Type something..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
        />
        <button
          className="btn-glow text-sm py-2 px-4"
          onClick={sendText}
          disabled={!input.trim()}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 12 5.875c0 2.363 1.205 4.381 3.045 5.227a59.768 59.768 0 0 1 4.127-1.054M15.5 12a5.5 5.5 0 0 1-5.5-5.5 5.5 5.5 0 0 1 5.5-5.5 5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5Z" />
          </svg>
          Send
        </button>
      </div>
    </div>
  );
}
