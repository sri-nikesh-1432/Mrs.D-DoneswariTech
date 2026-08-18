import { useCallback, useEffect, useRef, useState } from "react";
import { playBreath, playFiller, playThinkingPause, shouldInsertFiller } from "../lib/breath";
import { VoiceActivityDetector, isVADSupported } from "../lib/vad";
import { encodeWavPcm16 } from "../lib/wav";

export interface VoiceMessage {
  role: "user" | "ai";
  content: string;
  timestamp: string;
}

export interface VoiceDebugInfo {
  retrieval_time_ms: number;
  llm_time_ms: number;
  tts_time_ms: number;
  total_time_ms: number;
  /** Time-to-first-audio: ms from turn start until the first sentence plays. */
  first_sentence_ms?: number;
  /** Frontend-measured TTFA: ms from speech end until the first audio plays. */
  ttfa_ms?: number;
  chunks_retrieved: number;
  knowledge_source: string;
  /** Real backend error detail (shown in the debug panel, never faked). */
  stream_error?: string;
}

/**
 * Voice-engine analytics (spec §34 — engineering only, never spoken, never in
 * the conversation transcript). Counters accumulate for the whole session.
 */
export interface VoiceStats {
  /** Live STT partial transcripts produced this session. */
  partials: number;
  /** Confirmed barge-ins (caller took the floor while Mrs. D was speaking). */
  bargeIns: number;
  /** Utterances dropped by the phantom gates (noise/echo/backchannel/dup). */
  falseDetections: number;
  /** Final transcript differed from the last live partial. */
  corrections: number;
  /** Turns actually submitted to the LLM. */
  utterances: number;
}

export type CallStage =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/**
 * Internal conversation state machine (spec §4). The public `callStage` is a
 * UI projection of this machine — the machine itself is what gates behaviour:
 *
 *   IDLE → CONNECTING → LISTENING ⇄ USER_SPEAKING → PROCESSING → AI_SPEAKING
 *   AI_SPEAKING → INTERRUPTED → (backchannel) AI_SPEAKING | (genuine) PROCESSING
 *   any → RECOVERING → LISTENING; any → ENDING
 */
export type FsmState =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "processing"
  | "ai_speaking"
  | "interrupted"
  | "recovering"
  | "ending"
  | "error";

interface UseVoiceAgentOptions {
  /** Which backend pipeline to use: "test" (JSON knowledge) or "process" (FAISS) */
  mode?: "test" | "process";
  knowledgeFile?: string;
  instituteId?: number;
  /** Seconds of silence after which a pending utterance is submitted. */
  silenceTimeoutMs?: number;
  /** Language hint sent to the backend. */
  initialLanguage?: string;
  /**
   * Use the real-time Web Audio VAD + Groq Whisper pipeline instead of the
   * flaky webkitSpeechRecognition. Catches ANY voice in ANY language via raw
   * mic energy (default: true when the browser supports it).
   */
  useVAD?: boolean;
  onEnded?: () => void;
}

const LANGUAGE_VOICES: Record<string, string> = {
  English: "en-IN",
  Telugu: "te-IN",
  Hindi: "hi-IN",
  Tamil: "ta-IN",
  Kannada: "kn-IN",
  Malayalam: "ml-IN",
};

const SCRIPT_TO_LANGUAGE: Array<{ re: RegExp; lang: string }> = [
  { re: /[\u0C00-\u0C7F]/, lang: "Telugu" },
  { re: /[\u0900-\u097F]/, lang: "Hindi" },
  { re: /[\u0B80-\u0BFF]/, lang: "Tamil" },
  { re: /[\u0C80-\u0CFF]/, lang: "Kannada" },
  { re: /[\u0D00-\u0D7F]/, lang: "Malayalam" },
];

// High-frequency Roman Telugu words that let us detect Telugu typed in Latin
// letters ("idhi enti", "meeru ekkada unnaru"). STRONG words are unambiguous
// Roman-Telugu words; WEAK words are shared with English (fee, college, bus)
// and must never trigger a Telugu verdict on their own.
const ROMAN_TELUGU_STRONG = new Set([
  "idhi", "idi", "adi", "ivi", "enti", "endhi", "endi", "meeru", "maa",
  "naku", "naaku", "nee", "nuvvu", "eppudu", "ekkada", "enduku", "ela",
  "entha", "undi", "unna", "unnaru", "unnay", "unnayi", "kavali", "kaavali",
  "cheppandi", "cheppu", "isthara", "isthunnaru", "avutundi", "avuthundi",
  "padutundi", "paduthundi", "chestharu", "raavali", "koncham", "konchem",
  "chaala", "chala", "telsa", "telusa", "manchi", "appudu", "alage",
  "inkem", "inkemi", "baagundi", "bagundi", "ante", "antava", "raandi",
  "raandru", "tarandi", "chesoccha", "raavoccha", "undachu", "undach",
]);

const ROMAN_TELUGU_WEAK = new Set([
  "campus", "college", "colleji", "hostel", "bus", "cluster", "fee", "fees",
]);

function detectLanguage(text: string): string {
  // Real regional script first
  for (const { re, lang } of SCRIPT_TO_LANGUAGE) {
    if (re.test(text)) return lang;
  }
  // Roman Telugu (Latin script): "idhi enti" → Telugu so the AI speaks Telugu
  const tokens = text.toLowerCase().match(/[a-z]+/g) || [];
  let strongHits = 0;
  let weakHits = 0;
  for (const tok of tokens) {
    if (ROMAN_TELUGU_STRONG.has(tok)) strongHits++;
    else if (ROMAN_TELUGU_WEAK.has(tok)) weakHits++;
  }
  // At least one unambiguous Telugu word, or a heavy accumulation of shared
  // words — a single "college" or "bus" alone is not enough.
  if (strongHits >= 1 || weakHits >= 3) {
    return "Telugu";
  }
  return "English";
}

function normalizeTranscript(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * ── Utterance validation (spec §2, §20, §21, §47, §50, §53) ─────────────
 * A transcript only becomes a USER TURN when it passes ALL gates:
 *   VAD confidence (≥ min speech ms) + text quality + noise filter +
 *   backchannel filter + duplicate check + echo check.
 * Anything else is silently dropped — the agent NEVER responds to it.
 */

/**
 * Minimum GENUINE speech energy (ms above threshold) before Whisper is called.
 * Measured on real speech time, not wall-clock: a quick "Hi" is ~200-300ms of
 * actual voice, so this must stay low enough to catch short utterances while
 * still killing sub-speech blips (clicks, coughs < 200ms of energy).
 */
const MIN_SPEECH_MS = 200;

/** Hard cap for a single STT request — a hung backend must not wedge input. */
const STT_TIMEOUT_MS = 20000;

/** Minimum PCM window for a valid utterance (16 kHz × 200 ms of speech). */
const MIN_SPEECH_SAMPLES = 3200;

/** Max age of a transcript considered "recent" for duplicate detection (ms). */
const DUPLICATE_WINDOW_MS = 8000;

/**
 * Backchannels (spec §6, §50): sounds that mean "I'm listening, keep going"
 * — NOT a request to take the floor. When one of these is the whole
 * utterance, the AI keeps talking (or resumes) and nothing is sent to the LLM.
 */
const BACKCHANNEL_TOKENS = new Set([
  // English / roman
  "mm", "mhm", "mhmm", "hmm", "hm", "uh", "um", "umm", "aah", "ah",
  "oh", "ok", "okay", "okayyy", "right", "yes", "yeah", "yep", "yup",
  "haa", "ha", "aha", "haan", "huh", "haanji", "accha", "achha",
  "okie", "k", "kk", "cool", "fine", "got it", "alright", "sure",
  // Telugu backchannels (roman)
  "avunu", "avuna", "avn", "alage", "alaga", "sare", "sar", "sari",
  "sarle", "parledu", "parledhu", "parled", "baane", "bavundi",
  // Telugu script backchannels
  "సరే", "అవును", "అలాగే", "సర్లే", "పర్లేదు", "ఓహ్", "అవునా", "హ్మ్",
  // Hindi / other
  "theek", "theek hai", "theekhai", "hmm hmm", "haanji",
]);

/**
 * Genuine interruption words (spec §6): these mean "stop, I want the floor".
 * If an utterance contains ANY of these, it is a real barge-in, never a
 * backchannel — even alongside filler words.
 */
const INTERRUPTION_TOKENS = new Set([
  "wait", "waitwait", "stop", "hold", "minute", "min", "ledu", "ledhu",
  "no", "na", "actually", "listen", "sorry", "aa", "ఆగండి", "లేదు",
  "ఒక్క నిమిషం", "నిమిషం", "చెప్పండి", "అడగనా", "మధ్యలో", "mundu",
  "mundhu", "malli", "okk", "okkanimisham", "adaganu", "adagana",
]);

/** Non-speech tokens that carry no conversational content (spec §52). */
const NOISE_TOKENS = new Set([
  "a", "aa", "aaa", "e", "ee", "eee", "u", "uu", "o", "oo", "er",
  "eh", "huh", "huhh", "tch", "tsk", "psst", "click", "clk", "beep",
  // Whisper's bracket/annotation tokens for background audio — never speech.
  "music", "song", "applause", "silence", "background", "noise",
  "[music]", "[noise]", "[silence]", "[applause]", "[laughter]",
  "(music)", "(noise)", "(silence)", "(applause)", "(laughter)",
]);

/**
 * True when the whole utterance is just backchannel filler — the caller is
 * acknowledging, not taking the floor. "Hmm okay" → true; "wait fee entha?"
 * → false (contains an interruption token).
 */
export function isBackchannelUtterance(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  const tokens = text
    .toLowerCase()
    .replace(/[.,!?…\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return false;
  // Any genuine interruption word → definitely NOT a backchannel.
  if (tokens.some((t) => INTERRUPTION_TOKENS.has(t))) return false;
  return tokens.every((t) => BACKCHANNEL_TOKENS.has(t));
}

/**
 * True when the text is empty, pure punctuation, a single repeated character,
 * or one of the known non-speech noise tokens — never a user turn.
 */
export function isNoiseUtterance(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length < 2) return true; // "a", ".", "!"
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    const t = tokens[0].replace(/[.,!?…]/g, "");
    // single repeated char: "aaaaa", "hhhh"
    if (/^(.)\1{2,}$/.test(t)) return true;
    if (NOISE_TOKENS.has(t)) return true;
  }
  return false;
}

/**
 * True when the transcript is an echo of the AI's own last spoken words
 * (spec §48): TTS leakage back through the mic. Whisper sometimes hears the
 * AI's voice and repeats a chunk of it verbatim ("...తప్పకుండా...") — that
 * is NOT a user turn.
 *
 * Deliberately STRICT: only near-verbatim repetition is an echo. A genuine
 * follow-up like "hostel fee entha?" shares common words (hostel, fee) with
 * the AI's previous answer and must NEVER be dropped (spec §30, §54).
 */
export function isEchoOfLastAI(text: string, lastAIText: string): boolean {
  const t = normalizeTranscript(text);
  const ai = normalizeTranscript(lastAIText);
  if (!t || !ai || t.length < 10) return false;
  const tWords = t.split(/\s+/).filter(Boolean);
  const aiWordSet = new Set(ai.split(/\s+/).filter(Boolean));
  if (tWords.length < 4) return false;
  // Heavy overlap (≥ 3 of every 4 words identical to the AI's last words)
  // = Whisper heard Mrs. D, not a new question.
  let hits = 0;
  for (const w of tWords) if (aiWordSet.has(w)) hits++;
  const overlap = hits / tWords.length;
  if (overlap >= 0.75) return true;
  // A long verbatim tail of the AI's last sentence (≥ 5 words) is an echo.
  if (tWords.length >= 5 && ai.includes(t)) return true;
  return false;
}

/**
 * Stable language tracking (spec §18, §51): one noisy English-looking
 * transcript must NOT flip a Telugu conversation to English. Only switch when
 * a majority of the last few utterances agree on the new language.
 */
export function stableLanguage(
  detected: string,
  history: string[]
): { lang: string; history: string[] } {
  const hist = [...history, detected].slice(-3);
  const counts: Record<string, number> = {};
  for (const l of hist) counts[l] = (counts[l] || 0) + 1;
  let best = hist[hist.length - 1];
  let bestCount = 0;
  for (const [l, c] of Object.entries(counts)) {
    if (c > bestCount) {
      best = l;
      bestCount = c;
    }
  }
  return { lang: best, history: hist };
}

/** Whisper ISO-639-1 codes → UI language names (auto-detected per utterance). */
const LANG_CODE_TO_NAME: Record<string, string> = {
  te: "Telugu",
  hi: "Hindi",
  ta: "Tamil",
  kn: "Kannada",
  ml: "Malayalam",
  en: "English",
};

/**
 * useVoiceAgent — the ONE conversation state machine for the whole voice UI.
 *
 * Pipeline guarantees (ChatGPT-Voice-style):
 *   Listen → speech ends (~1.3s silence) → thinking → speaking (sentence
 *   audio queue) → clear buffers + fresh STT session → listen
 *
 *  - Exactly ONE active SpeechRecognition session at a time.
 *  - Previously processed audio is never re-processed: identical consecutive
 *    transcripts are ignored, and the STT session is restarted after every
 *    AI turn so the AI's own voice can never be fed back as user speech.
 *  - Transcripts arriving while "thinking" are ignored.
 *  - Barge-in: if the user speaks (final result, decent confidence) while the
 *    AI is speaking, the audio queue stops immediately and the new speech is
 *    submitted once they pause.
 *  - Listening resumes only after the TTS queue has completely finished.
 */
export function useVoiceAgent({
  mode = "test",
  knowledgeFile = "institute.json",
  instituteId = 1,
  silenceTimeoutMs = 900,
  initialLanguage = "English",
  useVAD = true,
  onEnded,
}: UseVoiceAgentOptions = {}) {
  const [callStage, setCallStage] = useState<CallStage>("idle");
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [debugInfo, setDebugInfo] = useState<VoiceDebugInfo | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState(initialLanguage);
  const [error, setError] = useState("");
  // Real-time indicator: the caller is currently speaking (VAD caught their
  // voice) — drives the live waveform colour and orb glow.
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  /** Live STT partial of the caller's in-progress utterance (streaming STT). */
  const [partialTranscript, setPartialTranscript] = useState("");
  /** The RAW FSM state (spec §4) — INTERRUPTED/RECOVERING visible to the UI. */
  const [fsmState, setFsmState] = useState<FsmState>("idle");
  /** Voice-engine analytics counters (spec §34). */
  const [voiceStats, setVoiceStats] = useState<VoiceStats>({
    partials: 0,
    bargeIns: 0,
    falseDetections: 0,
    corrections: 0,
    utterances: 0,
  });

  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const conversationId = useRef(`voice_${Date.now()}`);

  // ── Mutable pipeline state (refs avoid stale closures) ─────────────────────
  // The REAL conversation state machine (spec §4) lives in fsmRef; callStage
  // is only its UI projection. Behaviour gates on fsmRef — never on the UI
  // label. Transitions: IDLE→CONNECTING→LISTENING⇄USER_SPEAKING→PROCESSING→
  // AI_SPEAKING→(INTERRUPTED)→LISTENING; every failure path → RECOVERING→
  // LISTENING; ENDING on hang-up.
  // stageRef mirrors the UI projection for the few places that still read it.
  const stageRef = useRef<CallStage>("idle");
  const fsmRef = useRef<FsmState>("idle");
  const setFsm = useCallback((next: FsmState) => {
    fsmRef.current = next;
    setFsmState(next);
    // Project the machine onto the UI label set the components already render.
    let stage: CallStage;
    switch (next) {
      case "connecting":
        stage = "connecting";
        break;
      case "processing":
        stage = "thinking";
        break;
      case "ai_speaking":
        stage = "speaking";
        break;
      case "error":
        stage = "error";
        break;
      case "ending":
      case "idle":
        stage = "idle";
        break;
      default: // listening, user_speaking, interrupted, recovering
        stage = "listening";
    }
    stageRef.current = stage;
    setCallStage(stage);
    // While Mrs. D is speaking, the mic hears her own voice — raise the
    // Silero speech-probability threshold so only the CALLER's clear voice
    // (never her echo) can trigger a barge-in (spec §5, §38).
    vadRef.current?.setAISpeaking(next === "ai_speaking");
  }, []);

  const processingRef = useRef(false); // true while STT→LLM→TTS is running
  const pendingTranscriptRef = useRef(""); // accumulated new speech
  const lastProcessedRef = useRef(""); // last text already sent to the LLM
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningRef = useRef(false);
  const endedRef = useRef(false); // endCall idempotency guard

  // ── Real-time VAD (Silero ML) — the PRIMARY input path ───────────────────
  // Silero VAD returns a neural speech-probability per frame, so keyboard,
  // fan, chair noise, coughs and the AI's own echo can never start a turn
  // (spec §6: amplitude alone is not speech). Speech is captured into a
  // continuous 16 kHz PCM window inside the detector; streaming STT partials
  // and the final transcription both come from that window — the mic itself
  // NEVER restarts between turns.
  const vadSupported = useVAD && isVADSupported();
  const vadRef = useRef<VoiceActivityDetector | null>(null);
  const micLevelsRef = useRef<Float32Array>(new Float32Array(48)); // caller wave
  const aiLevelsRef = useRef<Float32Array>(new Float32Array(48)); // Mrs. D wave
  const aiRmsRef = useRef(0); // Mrs. D's output level (barge-in threshold anchor)
  const aiRafRef = useRef(0);
  // True once the current turn's PCM capture has started (first speech onset).
  const captureActiveRef = useRef(false);
  // Genuine ML-detected speech ms accumulated for the CURRENT merged turn —
  // drives the min-duration gate AND the adaptive merge grace (long thoughts
  // get more patience before the turn is finalized).
  const turnSpeechMsRef = useRef(0);
  const transcribingRef = useRef(false); // one STT request at a time
  // A finalize arrived while an STT request was in flight — re-run it as soon
  // as the in-flight request finishes (the final must always see the COMPLETE
  // utterance window; a stale partial must never become the turn).
  const finalizeQueuedRef = useRef(false);
  const finalizingRef = useRef(false); // re-entrancy guard for finalizeTurn
  // The utterance window parked while waiting for the STT lock — a retry
  // consumes the SAME snapshot, so the final can never be truncated.
  const finalizeWindowRef = useRef<Float32Array | null>(null);
  // Adaptive merge grace: fires when the caller has been quiet long enough to
  // own the floor. Delays finalizing so mid-thought pauses ("Naaku ... kavali...
  // fee kuda cheppandi") stay ONE turn (spec §8, §40).
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Streaming-STT partial cadence: while the caller speaks, a best-effort
  // partial transcript is requested on this cadence to update the live text.
  const partialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The most recent partial transcript (+when) — finalize reuses it when fresh
  // (no wasted Whisper call) and counts corrections when it changed.
  const lastPartialRef = useRef<{ text: string; norm: string; at: number } | null>(null);
  const handleVadStartRef = useRef<() => void>(() => {});
  const handleVadEndRef = useRef<() => void>(() => {});

  // ── Voice-engine analytics counters (spec §34) ───────────────────────────
  const partialCountRef = useRef(0);
  const bargeInCountRef = useRef(0);
  const falseDetectionRef = useRef(0);
  const sttCorrectionsRef = useRef(0);
  const utteranceIdRef = useRef(0); // monotonic per-turn id (spec §35)

  const bumpStats = useCallback((patch: Partial<VoiceStats>) => {
    setVoiceStats((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── Phantom-suppression state (spec §2, §20, §21, §48) ──────────────────
  // lastAITextRef: the AI's most recent spoken text — used to reject Whisper
  // echoes of Mrs. D's own voice as user turns (AI must never hear itself).
  const lastAITextRef = useRef("");
  // Ring of recent processed transcripts (normalized) with timestamps — the
  // same utterance arriving twice (stale STT stream, double VAD fire) is
  // dropped, never processed twice.
  const recentTranscriptsRef = useRef<Array<{ norm: string; at: number }>>([]);
  // Recent per-utterance language detections → stable conversation language.
  const langHistoryRef = useRef<string[]>([]);
  // True while the AI's audio is PAUSED awaiting barge-in classification
  // (the queue is held, not destroyed — a backchannel lets Mrs. D continue).
  const bargeInPausedRef = useRef(false);
  // Monotonic response id (spec §59, §60): only the LATEST active response
  // may enqueue/play audio. A stale stream's sentences are discarded even if
  // its abort races with a new turn.
  const activeResponseIdRef = useRef(0);
  // Frontend TTFA (spec §27): when the user's speech ended → first AI audio.
  const ttfaStartRef = useRef(0);
  const ttfaRef = useRef<number | null>(null);

  // ── Sentence audio queue (ONE queue per conversation) ─────────────────────
  // Responses arrive as sentence-level audio chunks. They are played strictly
  // one at a time so the caller always hears a COMPLETE sentence and no two
  // TTS streams ever overlap. A new response or a barge-in clears the queue.
  const audioQueueRef = useRef<Array<{ text: string; audioData: string }>>([]);
  const queueActiveRef = useRef(false);
  const aiSpeakStartedAtRef = useRef(0); // barge-in cooldown anchor
  const aiFinishedAtRef = useRef(0); // when AI finished speaking (post-TTS grace)

  // ── Streaming (SSE) state ────────────────────────────────────────────────
  // The /stream endpoint delivers each sentence's audio as soon as it is
  // ready, so playback of sentence 1 can begin while the reply is still being
  // generated/synthesized. One in-flight stream per conversation; aborting it
  // (barge-in / end call / new turn) cancels the fetch immediately.
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamActiveRef = useRef(false);

  // ── Silence / VAD: fire after no new speech for a while ────────────────────
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // ── Merged-utterance finalize timer (spec §8, §40) ───────────────────────
  // Speech END does not finalize the turn: the caller may pause mid-thought
  // ("Naaku sixth class admission kavali... fee details kuda cheppandi" is ONE
  // turn). We wait an adaptive grace; if they resume, the timer is cancelled
  // and the same PCM window keeps growing. Only when the grace expires does
  // the utterance get transcribed + submitted.
  const clearFinalizeTimer = useCallback(() => {
    if (finalizeTimerRef.current) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
  }, []);

  const stopPartialLoop = useCallback(() => {
    if (partialTimerRef.current) {
      clearTimeout(partialTimerRef.current);
      partialTimerRef.current = null;
    }
  }, []);

  // ── ADAPTIVE TURN-TAKING ───────────────────────────────────────────────────
  // A FIXED silence timeout is exactly what makes a voice agent feel robotic:
  // it cuts people off mid-thought on long answers and feels sluggish on short
  // ones. Humans pause mid-sentence, take breaths, say "um" while they think —
  // so the wait must scale with what has been said so far:
  //   - one-word acknowledgements ("Avunu", "Ok")  → brisk, ~0.75×
  //   - a typical short question                        → base
  //   - long, complex utterances (details, lists)       → patient, up to 1.35×
  // plus ±10% organic jitter so no two pauses are ever identical. Clamped to a
  // sane range so the caller is never cut off mid-word NOR left hanging.
  const adaptiveSilenceTimeout = useCallback(
    (pending: string): number => {
      const len = pending.trim().length;
      let scale = 1;
      if (len < 15) scale = 0.7;  // brisk: "Avunu..." "Okay"
      else if (len > 80) scale = 1.2; // patient: long detailed thought
      else if (len > 40) scale = 1.05; // a little patience mid-length
      const jitter = 0.9 + Math.random() * 0.2;
      return Math.min(Math.max(silenceTimeoutMs * scale * jitter, 500), 2200);
    },
    [silenceTimeoutMs]
  );

  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      const pending = pendingTranscriptRef.current;
      if (
        pending.trim() &&
        stageRef.current === "listening" &&
        !processingRef.current
      ) {
        pendingTranscriptRef.current = "";
        submitSpeechRef.current(pending);
      }
    }, adaptiveSilenceTimeout(pendingTranscriptRef.current));
  }, [adaptiveSilenceTimeout, clearSilenceTimer]);

  // ── VAD lifecycle (Silero ML — the PRIMARY input) ────────────────────────
  const startVAD = useCallback(async () => {
    if (!vadRef.current) return;
    const ok = await vadRef.current.start();
    if (!ok && listeningRef.current && !endedRef.current) {
      // Mic denied / hardware failure — this is NOT a backend outage. Keep the
      // conversation usable in text mode and tell the user the real reason.
      listeningRef.current = false;
      setIsListening(false);
      setError(
        "Microphone access is blocked. Allow the microphone for this site " +
          "in the browser, or type your message below to continue the call."
      );
    }
  }, []);

  const stopVAD = useCallback(() => {
    vadRef.current?.stop();
    setIsUserSpeaking(false);
    setPartialTranscript("");
    captureActiveRef.current = false;
    stopPartialLoop();
    clearFinalizeTimer();
  }, [clearFinalizeTimer, stopPartialLoop]);

  // ── Recognition lifecycle: exactly ONE active session ─────────────────────
  const stopListening = useCallback(() => {
    listeningRef.current = false;
    setIsListening(false);
    clearSilenceTimer();
    if (vadSupported) {
      stopVAD();
      return;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
  }, [clearSilenceTimer, stopVAD, vadSupported]);

  const startListening = useCallback(() => {
    if (listeningRef.current) return; // never start a second session
    listeningRef.current = true;
    setIsListening(true);
    if (vadSupported) {
      void startVAD();
      return;
    }
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
    } catch {
      /* may throw if already started */
    }
  }, [startVAD, vadSupported]);

  // ── Stop the audio queue immediately (barge-in, new response, end call) ───
  const stopAudioQueue = useCallback(() => {
    bargeInPausedRef.current = false;
    queueActiveRef.current = false;
    audioQueueRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.onended = null;
    }
  }, []);

  // ── Semantic barge-in: PAUSE (don't destroy) the queue ───────────────────
  // When VAD hears speech while Mrs. D is talking, we stop her audio fast
  // (spec §7: interruption must be immediate) but HOLD the remaining queue.
  // The utterance is transcribed; if it is a backchannel ("haa", "okay",
  // "hmm") the AI simply CONTINUES from where it paused (spec §50); only a
  // genuine question clears the queue.
  const pauseAudioQueue = useCallback(() => {
    bargeInPausedRef.current = true;
    audioRef.current?.pause();
  }, []);

  const resumeAudioQueue = useCallback(() => {
    if (!bargeInPausedRef.current) return;
    bargeInPausedRef.current = false;
    // Resume the paused sentence if it is still loaded, else continue the
    // queue from the next sentence. If there was nothing to resume (the
    // barge-in happened while THINKING, before any audio), go back to
    // LISTENING cleanly.
    const el = audioRef.current;
    if (el && el.src && el.currentTime > 0 && el.currentTime < el.duration) {
      setFsm("ai_speaking");
      el.play().catch(() => playNextInQueueRef.current());
    } else if (queueActiveRef.current || audioQueueRef.current.length > 0) {
      // Sentences may have accumulated while paused — activate the queue so
      // they actually play (a backchannel while THINKING must not lose them).
      queueActiveRef.current = true;
      setFsm("ai_speaking");
      playNextInQueueRef.current();
    } else {
      setFsm("listening");
    }
  }, [setFsm]);

  // ── Cancel any in-flight streaming fetch (barge-in, end call, new turn) ──
  const stopStreaming = useCallback(() => {
    streamActiveRef.current = false;
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
  }, []);

  // Forward ref so resumeAudioQueue (defined before playNextInQueue) can
  // continue the queue after a backchannel pause.
  const playNextInQueueRef = useRef<() => void>(() => {});

  // ── Turn end: clear buffers, THEN listen for new audio only ───────────────
  const handleTurnEnd = useCallback(() => {
    processingRef.current = false;
    setIsProcessing(false);
    queueActiveRef.current = false;
    audioQueueRef.current = [];
    bargeInPausedRef.current = false;
    aiFinishedAtRef.current = Date.now();
    // Reset the TTFA clock so the next turn measures fresh from its own
    // speech end (spec §27).
    ttfaStartRef.current = 0;
    ttfaRef.current = null;
    stopPartialLoop();
    clearFinalizeTimer();
    captureActiveRef.current = false;
    setPartialTranscript("");
    lastPartialRef.current = null;
    setFsm("listening");
    const pending = pendingTranscriptRef.current;
    pendingTranscriptRef.current = "";
    setInputText("");
    if (pending.trim() && pending.trim() !== lastProcessedRef.current) {
      // Speech captured during the turn (barge-in) — submit it now.
      submitSpeechRef.current(pending);
    } else if (vadSupported) {
      // The VAD session keeps running continuously across turns — just reset
      // its speech state so the AI's own trailing audio in the mic buffer can
      // NEVER be recorded as the next user query (spec: reset STT after TTS).
      vadRef.current?.reset();
      listeningRef.current = true;
      setIsListening(true);
      if (!endedRef.current) {
        // Ensure the mic is live (first listening starts here after greeting)
        // and re-arm cleanly: short delay lets the AI's last syllables drain.
        void startVAD();
        setTimeout(() => vadRef.current?.reset(), 120);
      }
    } else {
      // Fresh STT session: stop the old (continuous) recognition and start a
      // brand-new one so the AI's own trailing audio in the old mic buffer can
      // NEVER be fed back as the next user query (spec: reset STT after TTS).
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      listeningRef.current = false;
      setIsListening(false);
      if (!endedRef.current) {
        setTimeout(() => startListening(), 120);
      }
    }
  }, [
    clearFinalizeTimer,
    setFsm,
    startListening,
    startVAD,
    stopPartialLoop,
    vadSupported,
  ]);

  // Natural inter-sentence pause (the "breathing" cadence). Humans do NOT
  // pause the same length after every sentence — uniform gaps are exactly
  // what makes TTS sound robotic. Questions get a thinking beat, a long
  // thought a deeper breath, short acknowledgements flow fast.
  const pauseAfterSentence = useCallback((sentence: string): number => {
    const s = sentence.trim();
    let base: number;
    if (s.endsWith("?")) base = 560;
    else if (s.endsWith("!")) base = 460;
    else if (s.length > 140) base = 620;
    else if (s.length < 20) base = 300;
    else base = 380;
    // ±12% organic jitter — real people never pause for exactly the same
    // length; identical gaps are precisely what reads as mechanical.
    return Math.round(base * (0.88 + Math.random() * 0.24));
  }, []);

  // How deep the breath before the next sentence should be. Questions and
  // long thoughts get a real inhale; quick acknowledgements barely breathe.
  const breathIntensity = useCallback((sentence: string): number => {
    const s = sentence.trim();
    if (s.endsWith("?")) return 0.5; // thinking beat → deeper inhale
    if (s.length > 140) return 0.55; // long thought → real breath
    if (s.length < 20) return 0.2; // brisk ack → tiny breath
    return 0.35;
  }, []);

  // ── Play the next sentence in the queue. Each sentence is a COMPLETE
  //    utterance — never cut in the middle. When the queue is empty the turn
  //    is finished and we return to LISTENING. ───────────────────────────────
  const playNextInQueue = useCallback(async () => {
    if (endedRef.current || !queueActiveRef.current) return;
    // While a barge-in is being classified the queue is PAUSED — never play
    // over the caller until we know whether they backchanneled or interrupted.
    if (bargeInPausedRef.current) return;
    const next = audioQueueRef.current.shift();
    if (!next) {
      queueActiveRef.current = false;
      // While the stream is still delivering sentences, wait for the rest —
      // never close the turn mid-stream. Otherwise playback is complete.
      if (!streamActiveRef.current) handleTurnEnd();
      return;
    }
    if (!audioRef.current) {
      // No audio element (text-only mode) — fast-forward through the queue.
      playNextInQueue();
      return;
    }
    // Reset the barge-in cooldown per sentence so the caller can interrupt
    // between sentences, but the AI's own first few syllables can't trigger it.
    aiSpeakStartedAtRef.current = Date.now();
    setFsm("ai_speaking");
    const el = audioRef.current;
    el.src = `data:audio/mp3;base64,${next.audioData}`;
    el.onended = () => {
      // Vary the gap by sentence type — one continuous speaker with natural
      // rhythm, never a clipped machine-gun of clips. While the reply is
      // STILL TALKING (more sentences queued), insert a natural pause:
      //   - Filler sounds ("hmm", "uhh") simulate thinking between sentences
      //   - Breath sounds simulate natural inhales
      //   - ~35% of gaps are completely silent (varied, never mechanical)
      // Never after the last sentence: trailing silence belongs to the caller.
      const gap = pauseAfterSentence(next.text);
      const sentenceIndex = audioQueueRef.current.length;
      const hasMore = audioQueueRef.current.length > 0;
      if (hasMore) {
        // 65% chance of an audio cue (filler or breath), 35% silent
        if (Math.random() < 0.65) {
          const isFirstSentence = sentenceIndex >= (audioQueueRef.current.length);
          if (shouldInsertFiller(next.text, isFirstSentence, sentenceIndex)) {
            // Vocalized hesitation: "hmm...", "uhh..."
            playFiller({
              context: next.text.endsWith("?") ? "acknowledging" : "thinking",
              language: detectedLanguage,
            });
          } else {
            // Soft breath between sentences
            playBreath({
              durationMs: gap,
              intensity: breathIntensity(next.text),
            });
          }
        }
      }
      setTimeout(() => playNextInQueue(), gap);
    };
    try {
      await el.play();
    } catch {
      // Autoplay blocked or aborted — skip to the next sentence.
      setTimeout(() => playNextInQueue(), pauseAfterSentence(next.text));
    }
  }, [handleTurnEnd, pauseAfterSentence, breathIntensity, setFsm]);
  playNextInQueueRef.current = playNextInQueue;

  // ── Enqueue one streamed sentence for immediate playback ─────────────────
  // Each sentence's audio is queued the moment it arrives from the SSE
  // stream; if nothing is playing yet, playback begins right away so the
  // caller hears a live response instead of a 30-second wait. Sentences from
  // a STALE response (spec §60) are discarded — only the active response id
  // may own the audio output.
  const enqueueStreamedSentence = useCallback(
    (s: { text: string; audioData: string }, responseId: number) => {
      if (endedRef.current) return;
      if (responseId !== activeResponseIdRef.current) return; // stale response
      // While a barge-in is being classified, Mrs. D is PAUSED — hold the
      // sentence without touching the FSM so the INTERRUPTED state survives
      // until the transcript decides (backchannel → resume, genuine → clear).
      if (bargeInPausedRef.current) {
        audioQueueRef.current.push(s);
        queueActiveRef.current = true; // a resume must play these
        return;
      }
      if (!queueActiveRef.current) {
        audioQueueRef.current = [s];
        queueActiveRef.current = true;
        setFsm("ai_speaking");
        playNextInQueue();
      } else {
        audioQueueRef.current.push(s);
      }
    },
    [playNextInQueue, setFsm]
  );

  // ── Consume the /stream SSE endpoint ─────────────────────────────────────
  // Events: `sentence` (audio ready → enqueue + play as soon as possible),
  // `done` (full reply + debug info), `error`. Aborting the fetch (barge-in /
  // end call) cancels both the network request and further playback.
  const streamConversation = useCallback(
    async (
      params: URLSearchParams,
      onSentence: (text: string) => void,
      onDone: (aiResponse: string, debugInfo: any) => void,
      onTurn?: (detectedLanguage: string) => void
    ) => {
      const controller = new AbortController();
      streamAbortRef.current = controller;
      streamActiveRef.current = true;
      // Each stream is one RESPONSE (spec §59). Only the latest response may
      // enqueue audio; a barge-in/new turn bumps the id so a late sentence
      // from the old stream can never play over the new one.
      const responseId = ++activeResponseIdRef.current;
      try {
        const response = await fetch(`/api/conversation/stream?${params}`, {
          method: "POST",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error("Failed to get response");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const eventName = (frame.match(/^event:\s*(.+)$/m) || [])[1]?.trim();
            const dataLine = (frame.match(/^data:\s*(.+)$/m) || [])[1];
            if (eventName && dataLine) {
              let data: any = null;
              try {
                data = JSON.parse(dataLine);
              } catch {
                /* skip malformed frame */
              }
              if (data) {
                if (eventName === "turn") {
                  onTurn?.(data.detected_language || "");
                } else if (eventName === "sentence") {
                  onSentence(data.text || "");
                  if (data.audio_data) {
                    // First playable sentence of this response → frontend TTFA.
                    if (ttfaRef.current === null && ttfaStartRef.current) {
                      ttfaRef.current = Date.now() - ttfaStartRef.current;
                    }
                    enqueueStreamedSentence(
                      {
                        text: data.text || "",
                        audioData: data.audio_data,
                      },
                      responseId
                    );
                  }
                } else if (eventName === "done") {
                  onDone(data.ai_response || "", data.debug_info || null);
                } else if (eventName === "error") {
                  throw new Error(data.detail || "Stream error");
                }
              }
            }
            sep = buffer.indexOf("\n\n");
          }
        }
      } finally {
        // Only the ACTIVE response may touch shared stream state. A stale
        // stream's finally (aborted by a barge-in/new turn) must never clear
        // streamActiveRef or abort the NEW controller (spec §59, §60).
        if (responseId === activeResponseIdRef.current) {
          streamActiveRef.current = false;
          if (streamAbortRef.current === controller) {
            streamAbortRef.current = null;
          }
        }
        // The stream ended but produced no playable audio → close the turn so
        // the mic returns to LISTENING instead of hanging on THINKING. Skipped
        // when the call ended (endCall owns that transition), when this stream
        // is no longer the ACTIVE response (a barge-in/new turn superseded it —
        // that flow owns the transition, spec §59/§60), or when a barge-in
        // already moved to LISTENING (there the silence timer owns the
        // re-submit — never submit a half-spoken interruption).
        if (
          !endedRef.current &&
          responseId === activeResponseIdRef.current &&
          stageRef.current !== "listening" &&
          !queueActiveRef.current
        ) {
          handleTurnEnd();
        }
      }
    },
    [enqueueStreamedSentence, handleTurnEnd]
  );

  // ── Barge-in (recognition-fallback path): user talks while AI is speaking
  //    → stop TTS, queue speech. (The VAD path uses pauseAudioQueue + semantic
  //    classification instead — see handleVadSpeechStart/finalizeTurn.)
  const handleBargeIn = useCallback(
    (text: string) => {
      // Semantic gate (spec §50): a pure backchannel is NOT a barge-in — the
      // AI keeps talking.
      if (isBackchannelUtterance(text) || isNoiseUtterance(text)) {
        return;
      }
      stopAudioQueue();
      stopStreaming();
      clearSilenceTimer();
      processingRef.current = false;
      setIsProcessing(false);
      pendingTranscriptRef.current = text;
      setInputText(text);
      const { lang, history } = stableLanguage(
        detectLanguage(text),
        langHistoryRef.current
      );
      langHistoryRef.current = history;
      setDetectedLanguage(lang);
      setFsm("listening");
      // Submit after the user pauses — same silence logic as normal turns.
      armSilenceTimer();
    },
    [armSilenceTimer, clearSilenceTimer, setFsm, stopAudioQueue, stopStreaming]
  );

  // ── Submit an utterance through the chosen pipeline ───────────────────────
  const submitSpeech = useCallback(
    async (text: string) => {
      const normalized = normalizeTranscript(text);
      if (!normalized) return;
      // Stop any live voice-capture timers — this turn is now official.
      stopPartialLoop();
      clearFinalizeTimer();
      // State machine gate (spec §2): a NEW turn may only start from
      // LISTENING / USER_SPEAKING / INTERRUPTED. Never while processing or
      // while the AI is mid-sentence (a barge-in first moves to INTERRUPTED).
      const fsmNow = fsmRef.current;
      if (
        fsmNow === "processing" ||
        fsmNow === "ai_speaking" ||
        fsmNow === "connecting"
      ) {
        return;
      }

      // ── VALIDATION GATES (spec §20, §21): only a NEW, VALID user utterance
      //    reaches the LLM. The VAD path already filtered (duration, noise,
      //    backchannel, echo) — this is the final guard shared by all inputs.
      if (isNoiseUtterance(text)) {
        console.log("[VoiceAgent] Noise utterance ignored:", text);
        return;
      }
      if (isBackchannelUtterance(text)) {
        console.log("[VoiceAgent] Backchannel ignored:", text);
        return;
      }
      if (isEchoOfLastAI(text, lastAITextRef.current)) {
        console.log("[VoiceAgent] Echo of AI's own voice ignored:", text);
        return;
      }
      // Duplicate within the recent window (stale STT stream / double fire).
      const now = Date.now();
      recentTranscriptsRef.current = recentTranscriptsRef.current.filter(
        (t) => now - t.at < DUPLICATE_WINDOW_MS
      );
      if (recentTranscriptsRef.current.some((t) => t.norm === normalized)) {
        console.log("[VoiceAgent] Recent duplicate ignored:", text);
        return;
      }
      // Duplicate filter: never re-send the same transcript twice in a row.
      if (normalized === lastProcessedRef.current) {
        console.log("[VoiceAgent] Duplicate transcript ignored:", text);
        return;
      }
      lastProcessedRef.current = normalized;
      recentTranscriptsRef.current.push({ norm: normalized, at: now });
      // Every utterance gets a unique id (spec §35) + counts toward analytics.
      utteranceIdRef.current++;
      bumpStats({ utterances: utteranceIdRef.current });
      processingRef.current = true;
      setIsProcessing(true);
      clearSilenceTimer();
      setInputText("");
      pendingTranscriptRef.current = "";

      // Frontend TTFA (spec §27): start at the user's last word if the VAD
      // path already stamped it; text input falls back to now.
      if (!ttfaStartRef.current) ttfaStartRef.current = Date.now();
      ttfaRef.current = null;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, timestamp: new Date().toISOString() },
      ]);
      setFsm("processing");

      try {
        // Stable language (spec §18): one noisy "Thank you" must not flip a
        // Telugu conversation to English — only a majority of recent turns.
        const { lang, history } = stableLanguage(
          detectLanguage(text),
          langHistoryRef.current
        );
        langHistoryRef.current = history;
        setDetectedLanguage(lang);

        const params = new URLSearchParams({
          mode,
          user_input: text,
          conversation_id: conversationId.current,
          language: lang,
          ...(mode === "test"
            ? { knowledge_file: knowledgeFile }
            : { institute_id: String(instituteId) }),
        });

        // SSE streaming: each sentence's audio is delivered as soon as it is
        // ready and playback begins immediately — the caller hears one live,
        // continuous speaker instead of waiting for a 30-second blob.
        let aiAccumulated = "";
        await streamConversation(
          params,
          (sentenceText) => {
            aiAccumulated += sentenceText;
            // Progressively reveal the reply while it is being spoken.
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "ai") {
                return [...prev.slice(0, -1), { ...last, content: aiAccumulated }];
              }
              return [
                ...prev,
                {
                  role: "ai",
                  content: aiAccumulated,
                  timestamp: new Date().toISOString(),
                },
              ];
            });
          },
          (fullText, debug) => {
            if (fullText) aiAccumulated = fullText;
            if (debug) {
              // Merge the frontend-measured TTFA into the backend debug info.
              setDebugInfo({ ...debug, ttfa_ms: ttfaRef.current ?? undefined });
            }
          },
          (lang) => {
            if (lang) setDetectedLanguage(lang);
          }
        );

        // Finalize the AI message with the canonical response text.
        const aiText = aiAccumulated || "I'm sorry, I couldn't respond.";
        // Remember what Mrs. D last said — used to reject echoes of her own
        // voice as user turns (spec §48: AI must never hear itself).
        if (aiText.trim()) lastAITextRef.current = aiText;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "ai") {
            return [...prev.slice(0, -1), { ...last, content: aiText }];
          }
          return [
            ...prev,
            { role: "ai", content: aiText, timestamp: new Date().toISOString() },
          ];
        });
      } catch (e: any) {
        // Barge-in / end call aborts the stream — the pipeline was already
        // reset by handleBargeIn/endCall, so this is expected and silent.
        if (e && e.name === "AbortError") {
          return;
        }
        // The user sees a friendly message; the REAL exception is logged to
        // the console and surfaced in the debug panel (never silently hidden).
        const detail = e && e.message ? String(e.message) : String(e);
        console.error("Voice pipeline error:", e);
        setDebugInfo((prev) =>
          prev
            ? { ...prev, stream_error: detail }
            : {
                retrieval_time_ms: 0,
                llm_time_ms: 0,
                tts_time_ms: 0,
                total_time_ms: 0,
                chunks_retrieved: 0,
                knowledge_source: "",
                stream_error: detail,
              }
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            content: "Sorry, something went wrong. Please try again.",
            timestamp: new Date().toISOString(),
          },
        ]);
        lastProcessedRef.current = ""; // allow retrying the same text
        processingRef.current = false;
        setIsProcessing(false);
        pendingTranscriptRef.current = "";
        // Full recovery: stop any queued AI audio and reset the STT session
        // so Mrs. D's trailing voice in the old mic buffer can NEVER become
        // the next user query — same guarantee as handleTurnEnd, on the
        // error path too (spec: AI must never hear itself).
        stopAudioQueue();
        setFsm("recovering");
        stopListening();
        if (!endedRef.current) {
          setTimeout(() => startListening(), 150);
        }
      }
    },
    [
      bumpStats,
      clearFinalizeTimer,
      instituteId,
      knowledgeFile,
      mode,
      setFsm,
      startListening,
      stopListening,
      stopAudioQueue,
      clearSilenceTimer,
      stopPartialLoop,
      streamConversation,
    ]
  );

  // Forward refs so earlier callbacks (silence timer, turn end) can submit.
  const submitSpeechRef = useRef(submitSpeech);
  submitSpeechRef.current = submitSpeech;

  // Forward ref so finalizeTurn (defined after resumeAudioQueue) can resume
  // the AI after a backchannel / too-short barge-in attempt.
  const resumeAudioQueueRef = useRef<() => void>(() => {});

  // ── Capture: start the current turn's PCM window (one continuous stream) ──
  // The detector's 16 kHz window grows from the caller's FIRST speech onset
  // until finalize — mid-thought pauses merge into the same window (spec §8).
  const ensureCapture = useCallback(() => {
    if (captureActiveRef.current) return;
    captureActiveRef.current = true;
    turnSpeechMsRef.current = 0;
    // Fresh window: any stale audio (e.g. the AI's trailing voice) is gone.
    vadRef.current?.reset();
  }, []);

  // How long to wait after speech END before finalizing the turn. Scales with
  // how much the caller has said: a one-word "Avunu" is brisk, a long detailed
  // thought gets real patience (humans pause mid-sentence, spec §8/§40).
  const adaptiveMergeSilence = useCallback((): number => {
    const spoken = turnSpeechMsRef.current;
    let base = 650;  // Faster base: 600-700ms target TTFA
    if (spoken > 4000) base = 1000;
    else if (spoken > 1800) base = 800;
    else if (spoken > 800) base = 700;
    const jitter = 0.9 + Math.random() * 0.2;
    return Math.min(Math.max(base * jitter, 450), 1800);
  }, []);

  const armFinalizeTimer = useCallback(() => {
    clearFinalizeTimer();
    finalizeTimerRef.current = setTimeout(() => {
      void finalizeTurnRef.current();
    }, adaptiveMergeSilence());
  }, [adaptiveMergeSilence, clearFinalizeTimer]);

  // ── VAD speech events ─────────────────────────────────────────────────────
  // Speech START (spec §5, §6, §7): while Mrs. D is talking this is a POTENTIAL
  // barge-in. We pause her audio FAST (spec §7 — never wait for the sentence
  // to finish) and capture the caller; the transcript then decides (semantic
  // classification) whether it was a backchannel (resume AI) or a genuine
  // interruption (clear + process).
  const handleVadSpeechStart = useCallback(() => {
    const fsm = fsmRef.current;
    if (endedRef.current) return;
    // Post-TTS grace: ignore anything within ~350ms of the AI finishing —
    // the AI's own trailing audio in the mic must never start a capture.
    if (Date.now() - aiFinishedAtRef.current < 350) return;
    if (fsm === "ai_speaking" || fsm === "processing") {
      // Barge-in cooldown: ignore audio during the first ~400ms of a sentence
      // so the AI's own voice (or echo) can never trigger an interruption.
      if (
        fsm === "ai_speaking" &&
        Date.now() - aiSpeakStartedAtRef.current < 300
      ) {
        return;
      }
      // The caller resumed during a pause — keep merging, don't finalize.
      clearFinalizeTimer();
      // INTERRUPTED: pause Mrs. D immediately (fast stop), hold her queue,
      // cancel the stream only at classification — a backchannel must let
      // her continue. (Interrupting during THINKING cancels nothing yet;
      // the partial/final classification will discard unplayed LLM output.)
      pauseAudioQueue();
      processingRef.current = false;
      setIsProcessing(false);
      setFsm("interrupted");
      setIsUserSpeaking(true);
      ensureCapture();
      startPartialLoopRef.current();
      return;
    }
    if (fsm === "listening" || fsm === "user_speaking" || fsm === "interrupted") {
      // User resumed mid-thought → cancel the finalize timer, keep the SAME
      // PCM window (one merged turn, spec §40). While INTERRUPTED the AI
      // stays paused until the transcript classifies this as backchannel
      // (resume) or a genuine question (process).
      clearFinalizeTimer();
      if (fsm === "listening") setFsm("user_speaking");
      setIsUserSpeaking(true);
      ensureCapture();
      startPartialLoopRef.current();
    }
  }, [clearFinalizeTimer, ensureCapture, pauseAudioQueue, setFsm]);

  const handleVadSpeechEnd = useCallback(() => {
    // Accumulate genuine ML-detected speech for the CURRENT merged turn
    // (the detector resets its own counter right after this callback).
    turnSpeechMsRef.current += vadRef.current?.activeSpeechMs ?? 0;
    setIsUserSpeaking(false);
    // Frontend TTFA (spec §27) starts at the user's LAST WORD (speech end),
    // not at LLM submission — the perceived latency the caller feels.
    ttfaStartRef.current = Date.now();
    // USER_SPEAKING/INTERRUPTED → the caller yielded. Do NOT finalize yet:
    // arm the adaptive merge grace so a mid-thought pause isn't cut off.
    if (fsmRef.current === "user_speaking") setFsm("listening");
    if (captureActiveRef.current) armFinalizeTimer();
  }, [armFinalizeTimer, setFsm]);

  // Keep the detector's callbacks pointed at the LATEST closures.
  handleVadStartRef.current = handleVadSpeechStart;
  handleVadEndRef.current = handleVadSpeechEnd;
  resumeAudioQueueRef.current = resumeAudioQueue;

  // ── Semantic barge-in classification (spec §6, §50) ──────────────────────
  // After the AI was paused for a possible barge-in, this decides what the
  // captured speech actually was:
  //   backchannel / noise / echo / duplicate  → resume Mrs. D (allow continue)
  //   anything else                           → genuine interruption: discard
  //     her held queue + cancel the stream, then process the new turn.
  // Returns true when the utterance should proceed to the pipeline.
  const classifyBargeIn = useCallback((): boolean => {
    if (!bargeInPausedRef.current) return true; // not a barge-in context
    stopStreaming();
    stopAudioQueue();
    setFsm("listening"); // submitSpeech will move to PROCESSING
    return false;
  }, [setFsm, stopAudioQueue, stopStreaming]);

  // ── ONE STT call site (partial + final), with a shared in-flight lock ────
  // The 16 kHz PCM window is encoded as WAV and posted to the existing
  // /api/conversation/transcribe endpoint (Groq Whisper, auto language).
  //   - A partial that finds the lock busy is DROPPED (best-effort, spec §7).
  //   - A final that finds the lock busy marks finalizeQueued — the in-flight
  //     request re-runs finalizeTurn when it finishes, so the final ALWAYS
  //     sees the complete utterance window (never a stale partial).
  const requestTranscription = useCallback(
    async (
      samples: Float32Array,
      kind: "partial" | "final"
    ): Promise<{ text: string; language?: string } | null> => {
      if (transcribingRef.current) {
        if (kind === "final") finalizeQueuedRef.current = true;
        return null;
      }
      transcribingRef.current = true;
      try {
        const wav = encodeWavPcm16(samples, 16000);
        const form = new FormData();
        form.append(
          "audio",
          new Blob([wav], { type: "audio/wav" }),
          "utterance.wav"
        );
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch("/api/conversation/transcribe", {
            method: "POST",
            body: form,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) throw new Error(`STT ${res.status}`);
        const data = await res.json();
        return { text: (data.text || "").trim(), language: data.language };
      } catch (e) {
        console.error(`[VoiceAgent] STT ${kind} failed:`, e);
        return null;
      } finally {
        transcribingRef.current = false;
        // A finalize arrived while this request was in flight — re-run it now
        // that the lock is free (the window has the complete utterance).
        if (finalizeQueuedRef.current && !endedRef.current) {
          finalizeQueuedRef.current = false;
          void finalizeTurnRef.current();
        }
      }
    },
    []
  );

  // ── Live partial transcript (streaming STT feel, spec §7) ────────────────
  // Partials update the UI as the caller speaks ("naku... naku mee college...")
  // and — while the AI is paused for a barge-in — classify the interruption
  // EARLY from the partial text: a genuine question stops Mrs. D immediately
  // (spec §9); a backchannel/echo keeps her paused until finalize resumes her.
  // Partials are NEVER sent to the LLM (spec §7).
  const handlePartialText = useCallback(
    (text: string, lang?: string) => {
      void lang;
      const norm = normalizeTranscript(text);
      lastPartialRef.current = { text, norm, at: Date.now() };
      setPartialTranscript(text);
      setInputText(text);
      partialCountRef.current++;
      bumpStats({ partials: partialCountRef.current });

      // Echo suppression (spec §5): while Mrs. D's audio is paused for a
      // possible barge-in, a partial that is purely her own words is HER
      // voice through the mic — not the caller taking the floor.
      if (bargeInPausedRef.current) {
        if (
          isNoiseUtterance(text) ||
          isBackchannelUtterance(text) ||
          isEchoOfLastAI(text, lastAITextRef.current)
        ) {
          return; // finalize will resume Mrs. D
        }
        // GENUINE interruption — stop her NOW (spec §9: do not finish the
        // sentence, do not keep the old stream/queue).
        bargeInCountRef.current++;
        bumpStats({ bargeIns: bargeInCountRef.current });
        stopStreaming();
        stopAudioQueue();
        setFsm("listening");
      }
    },
    [bumpStats, setFsm, stopAudioQueue, stopStreaming]
  );

  // ── Streaming-STT partial loop (best-effort cadence) ─────────────────────
  const PARTIAL_INTERVAL_MS = 2500; // min NEW speech between partial requests (faster feedback)
  const PARTIAL_TICK_MS = 700;
  const startPartialLoop = useCallback(() => {
    if (partialTimerRef.current) return;
    const tick = () => {
      partialTimerRef.current = null;
      if (endedRef.current || !captureActiveRef.current) return;
      const vad = vadRef.current;
      if (!vad) return;
      const window = vad.getPcmWindow();
      // Only worthwhile once real speech has accumulated AND enough NEW speech
      // arrived since the last partial (rate-limit friendly: ~1 partial per
      // 3.5s of talking on the free Groq tier).
      if (
        window.length >= MIN_SPEECH_SAMPLES &&
        Date.now() - (lastPartialRef.current?.at || 0) >= PARTIAL_INTERVAL_MS &&
        !transcribingRef.current
      ) {
        void requestTranscription(vad.getPcmWindow(), "partial").then((r) => {
          if (r && r.text) handlePartialText(r.text, r.language);
        });
      }
      partialTimerRef.current = setTimeout(tick, PARTIAL_TICK_MS);
    };
    partialTimerRef.current = setTimeout(tick, PARTIAL_TICK_MS);
  }, [requestTranscription, handlePartialText]);
  const startPartialLoopRef = useRef(startPartialLoop);
  startPartialLoopRef.current = startPartialLoop;

  // ── Finalize the merged utterance (speech end + adaptive grace) ───────────
  // The ONLY path where recorded speech becomes a user turn; every phantom
  // (noise, backchannel, echo, duplicate, silence) is dropped right here.
  const finalizeTurn = useCallback(async () => {
    if (endedRef.current) return;
    clearFinalizeTimer();
    stopPartialLoop();
    const vad = vadRef.current;
    if (!vad) return;
    const fsm = fsmRef.current;
    // Never finalize while the AI is mid-speech or mid-thought — a barge-in
    // that is still being classified owns this window. Retry shortly.
    if (fsm === "ai_speaking" || fsm === "processing") {
      armFinalizeTimer();
      return;
    }
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    try {
      // Snapshot the utterance window ONCE. A queued retry (STT was busy)
      // consumes the SAME parked snapshot — the final can never be truncated
      // by a mid-request clear.
      const window = finalizeWindowRef.current ?? vad.getPcmWindow();
      // Read the fresh-partial BEFORE clearing (the fast path reuses it).
      const lastPartial = lastPartialRef.current;
      if (!window.length) {
        finalizeWindowRef.current = null;
        return;
      }
      finalizeWindowRef.current = null;
      // Free the window + flags NOW (single-shot per turn) — but only after
      // the snapshot, so the final always sees the complete utterance.
      captureActiveRef.current = false;
      vad.reset();
      setPartialTranscript("");
      setInputText("");
      lastPartialRef.current = null;

      // Minimum genuine speech (200ms) — silence / sub-speech blips produce
      // NO transcript, NO LLM call, NO audio (spec §37).
      if (
        window.length < MIN_SPEECH_SAMPLES ||
        turnSpeechMsRef.current < MIN_SPEECH_MS
      ) {
        turnSpeechMsRef.current = 0;
        resumeAudioQueueRef.current(); // backchannel/noise → Mrs. D continues
        return;
      }
      turnSpeechMsRef.current = 0;

      // Fresh partial within the last 1.5s? Reuse it (no wasted Whisper call).
      let text = "";
      let lang: string | undefined;
      if (lastPartial && Date.now() - lastPartial.at < 1500) {
        text = lastPartial.text;
      } else {
        // STT is busy with a partial — park the window and let the in-flight
        // request re-run us when the lock frees (never drop the utterance).
        if (transcribingRef.current) {
          finalizeWindowRef.current = window;
          finalizeQueuedRef.current = true;
          return;
        }
        const r = await requestTranscription(window, "final");
        if (!r || !r.text) {
          // STT failure is NOT a user turn — resume a paused AI, stay silent
          // otherwise (spec §47: never fake a transcript).
          resumeAudioQueueRef.current();
          return;
        }
        text = r.text;
        lang = r.language;
        // The final differed from the last partial → STT correction (spec §34).
        if (lastPartial && lastPartial.norm !== normalizeTranscript(text)) {
          sttCorrectionsRef.current++;
          bumpStats({ corrections: sttCorrectionsRef.current });
        }
      }

      // ── VALIDATION GATES (defense in depth — Silero already filtered) ────
      if (!text) {
        resumeAudioQueueRef.current();
        return;
      }
      if (isNoiseUtterance(text)) {
        falseDetectionRef.current++;
        bumpStats({ falseDetections: falseDetectionRef.current });
        console.log("[VoiceAgent] STT noise dropped:", text);
        resumeAudioQueueRef.current();
        return;
      }
      if (isEchoOfLastAI(text, lastAITextRef.current)) {
        falseDetectionRef.current++;
        bumpStats({ falseDetections: falseDetectionRef.current });
        console.log("[VoiceAgent] STT echo of AI dropped:", text);
        resumeAudioQueueRef.current();
        return;
      }
      // Duplicate within the window (stale buffer / double STT fire).
      const norm = normalizeTranscript(text);
      const now = Date.now();
      recentTranscriptsRef.current = recentTranscriptsRef.current.filter(
        (t) => now - t.at < DUPLICATE_WINDOW_MS
      );
      if (recentTranscriptsRef.current.some((t) => t.norm === norm)) {
        falseDetectionRef.current++;
        bumpStats({ falseDetections: falseDetectionRef.current });
        console.log("[VoiceAgent] STT duplicate dropped:", text);
        resumeAudioQueueRef.current();
        return;
      }
      if (isBackchannelUtterance(text)) {
        falseDetectionRef.current++;
        bumpStats({ falseDetections: falseDetectionRef.current });
        console.log("[VoiceAgent] STT backchannel dropped:", text);
        resumeAudioQueueRef.current();
        return;
      }

      // Genuine utterance: if this started as a barge-in, discard the held AI
      // queue + cancel her stream NOW (spec §7: fast, complete stop).
      classifyBargeIn();

      // Stable language (spec §18): majority of recent detections — a lone
      // noisy partial must never flip the conversation language.
      const langName = LANG_CODE_TO_NAME[lang as string] || detectLanguage(text);
      const { lang: stable, history } = stableLanguage(
        langName,
        langHistoryRef.current
      );
      langHistoryRef.current = history;
      setDetectedLanguage(stable);
      submitSpeechRef.current(text);
    } finally {
      // The queued retry is owned by requestTranscription's finally (it fires
      // only when the STT lock actually frees) — re-running from here would
      // busy-loop while the lock is still held.
      finalizingRef.current = false;
    }
  }, [
    armFinalizeTimer,
    bumpStats,
    classifyBargeIn,
    clearFinalizeTimer,
    requestTranscription,
    stopPartialLoop,
  ]);
  const finalizeTurnRef = useRef(finalizeTurn);
  finalizeTurnRef.current = finalizeTurn;

  // ── Input setup (once per mount) ──────────────────────────────────────────
  useEffect(() => {
    // Real-time VAD is the PRIMARY input: Silero ML speech detection (a neural
    // speech probability per frame) catches ANY human voice in ANY language
    // while ignoring fans, keyboards, coughs and the AI's own echo. The
    // utterance is captured into a 16 kHz PCM window and transcribed by Groq
    // Whisper (auto language). Only fall back to the browser speech API when
    // the Silero pipeline can't run.
    if (vadSupported) {
      const vad = new VoiceActivityDetector(
        {
          // ML end-of-speech patience: ~850ms of below-threshold audio ends a
          // segment. Shorter = faster TTFA (target 600-700ms). The hook's
          // adaptive merge grace extends it for long thoughts.
          redemptionMs: 850,
          minSpeechMs: 300,
          preSpeechPadMs: 400,
          positiveThreshold: 0.3,
          negativeThreshold: 0.25,
          buckets: 48,
        },
        {
          onSpeechStart: () => handleVadStartRef.current(),
          onSpeechEnd: () => handleVadEndRef.current(),
          // Too-short segment (cough/click/fan): the ML already judged it
          // noise — nothing is transcribed. If Mrs. D was paused for a
          // possible barge-in, let her continue. NEVER touch the current
          // merge window: a real utterance may still be in progress.
          onVADMisfire: () => {
            setIsUserSpeaking(false);
            resumeAudioQueueRef.current();
          },
        }
      );
      vadRef.current = vad;
      micLevelsRef.current = vad.levels;
      return () => {
        vad.stop();
        vadRef.current = null;
      };
    }

    if (
      !("webkitSpeechRecognition" in window) &&
      !("SpeechRecognition" in window)
    ) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";
      const confidences: number[] = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalTranscript += transcript;
          confidences.push(result[0].confidence || 0);
        } else {
          interimTranscript += transcript;
        }
      }

      const stage = stageRef.current;

      // Barge-in: user speaks while the AI is talking → stop TTS immediately.
      // Cooldown: ignore audio during the first ~400ms of a sentence so the
      // AI's own voice (or echo of it) can never trigger an interruption.
      if (stage === "speaking") {
        if (finalTranscript.trim().length >= 2) {
          const avgConf = confidences.length
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length
            : 0;
          const aiJustSpoke = Date.now() - aiSpeakStartedAtRef.current < 400;
          if (!aiJustSpoke && avgConf >= 0.5) {
            handleBargeIn(finalTranscript);
          }
        }
        return;
      }

      // Ignore everything while processing/thinking — never re-feed old audio.
      if (processingRef.current || stage !== "listening") {
        return;
      }

      // Post-TTS grace window: ignore any final transcript arriving right
      // after the AI stopped speaking (echo/trailing audio) — real new speech
      // will arrive a moment later and be captured by the fresh session.
      if (Date.now() - aiFinishedAtRef.current < 350) {
        return;
      }

      if (interimTranscript) {
        setInputText(interimTranscript);
      }
      if (finalTranscript) {
        pendingTranscriptRef.current = finalTranscript;
        setInputText(finalTranscript);
        // Stable language (spec §18): one noisy utterance must not flip the
        // whole conversation. The final language is decided by the majority
        // of recent turns, so a lone "Thank you" never switches Telugu → En.
        const { lang, history } = stableLanguage(
          detectLanguage(finalTranscript),
          langHistoryRef.current
        );
        langHistoryRef.current = history;
        setDetectedLanguage(lang);
        try {
          recognition.lang = LANGUAGE_VOICES[lang] || "en-IN";
        } catch {
          /* ignore */
        }
        armSilenceTimer();
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        // The microphone is blocked — this is NOT a backend failure. Do NOT
        // flip the call into the "connection error" screen (whose hardcoded
        // message would claim the backend is down while it is actually fine):
        // keep the conversation usable in text mode and tell the user the
        // REAL reason instead.
        listeningRef.current = false;
        setIsListening(false);
        setError(
          "Microphone access is blocked. Allow the microphone for this site " +
            "in the browser, or type your message below to continue the call."
        );
      }
    };

    recognition.onend = () => {
      // Recognition stopped. Only auto-restart while still wanted AND idle.
      if (
        listeningRef.current &&
        stageRef.current === "listening" &&
        !processingRef.current
      ) {
        try {
          recognition.start();
        } catch {
          /* ignore */
        }
      }
    };

    return () => {
      clearSilenceTimer();
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [armSilenceTimer, clearSilenceTimer, handleBargeIn, setFsm, silenceTimeoutMs, vadSupported]);

  // ── Mrs. D's live waveform (AI audio analyser) ────────────────────────────
  // captureStream() on the <audio> element gives us her actual output without
  // rerouting it through a MediaElementSource (which can only be created once
  // per element — captureStream has no such restriction, so it survives
  // React StrictMode's double-mount cleanly). The analyser feeds aiLevelsRef
  // (waveform) + aiRmsRef (used to raise the VAD barge-in threshold above
  // her own voice so the AI can never interrupt herself).
  useEffect(() => {
    const el = audioRef.current as (HTMLAudioElement & { captureStream?: () => MediaStream }) | null;
    if (!el || typeof el.captureStream !== "function") return;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new Ctor();
      const stream = el.captureStream!();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.25;
      src.connect(analyser);
    } catch (e) {
      console.warn("AI audio analyser unavailable:", e);
      return;
    }
    if (!analyser) return;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const levels = aiLevelsRef.current;
    const N = levels.length;
    const per = Math.max(1, Math.floor(freq.length / N));
    const loop = () => {
      aiRafRef.current = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      for (let b = 0; b < N; b++) {
        let peak = 0;
        const start = b * per;
        const end = Math.min(freq.length, start + per);
        for (let i = start; i < end; i++) {
          if (freq[i] > peak) peak = freq[i];
        }
        levels[b] = peak / 255;
        sum += peak;
      }
      aiRmsRef.current = sum / (N * 255);
    };
    aiRafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(aiRafRef.current);
      ctx?.close().catch(() => {});
    };
  }, [audioRef]);

  // ── Greeting on mount ──────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    endedRef.current = false;
    setError("");
    setMessages([]);
    setDebugInfo(null);
    pendingTranscriptRef.current = "";
    lastProcessedRef.current = "";
    recentTranscriptsRef.current = [];
    langHistoryRef.current = [];
    // Fresh session analytics (spec §34).
    partialCountRef.current = 0;
    bargeInCountRef.current = 0;
    falseDetectionRef.current = 0;
    sttCorrectionsRef.current = 0;
    utteranceIdRef.current = 0;
    setVoiceStats({
      partials: 0,
      bargeIns: 0,
      falseDetections: 0,
      corrections: 0,
      utterances: 0,
    });
    setPartialTranscript("");
    captureActiveRef.current = false;
    lastPartialRef.current = null;
    stopPartialLoop();
    clearFinalizeTimer();
    setFsm("connecting");

    try {
      const params = new URLSearchParams({
        mode,
        user_input: mode === "process" ? "START_CALL" : "",
        conversation_id: conversationId.current,
        is_greeting: "true",
        language: detectedLanguage,
        ...(mode === "test"
          ? { knowledge_file: knowledgeFile }
          : { institute_id: String(instituteId) }),
      });

      // The greeting streams through the same SSE pipeline: sentence audio
      // starts playing the moment it is ready. When the queue drains,
      // handleTurnEnd transitions to LISTENING and starts a FRESH recognition
      // session (old mic buffer discarded → the AI can never hear itself).
      let greetingAccum = "";
      await streamConversation(
        params,
        (sentenceText) => {
          greetingAccum += sentenceText;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "ai") {
              return [...prev.slice(0, -1), { ...last, content: greetingAccum }];
            }
            return [
              ...prev,
              {
                role: "ai",
                content: greetingAccum,
                timestamp: new Date().toISOString(),
              },
            ];
          });
        },
        (fullText, debug) => {
          if (fullText) greetingAccum = fullText;
          if (debug) {
            setDebugInfo({ ...debug, ttfa_ms: ttfaRef.current ?? undefined });
          }
        },
        (lang) => {
          if (lang) setDetectedLanguage(lang);
        }
      );
      // Remember what Mrs. D greeted with — her own words must never be
      // replayed back to her as a user turn (spec §48).
      if (greetingAccum.trim()) lastAITextRef.current = greetingAccum;
      // Safety net: if the greeting produced no sentences at all, keep the
      // transcript from being blank.
      setMessages((prev) =>
        prev.length === 0
          ? [
              {
                role: "ai",
                content: greetingAccum || "Hi! How can I help you today?",
                timestamp: new Date().toISOString(),
              },
            ]
          : prev
      );
    } catch (e: any) {
      if (e && e.name === "AbortError") return;
      console.error("Error starting call:", e);
      setError("Failed to connect to the voice agent. Is the backend running?");
      setFsm("error");
    }
  }, [
    clearFinalizeTimer,
    detectedLanguage,
    instituteId,
    knowledgeFile,
    mode,
    setFsm,
    stopPartialLoop,
    streamConversation,
  ]);

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text ?? inputText).trim();
      if (!content || processingRef.current) return;
      pendingTranscriptRef.current = "";
      await submitSpeechRef.current(content);
    },
    [inputText]
  );

  const toggleListening = useCallback(() => {
    if (listeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  const endCall = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopListening();
    stopAudioQueue();
    stopStreaming();
    stopPartialLoop();
    clearFinalizeTimer();
    captureActiveRef.current = false;
    setPartialTranscript("");
    processingRef.current = false;
    pendingTranscriptRef.current = "";
    setMessages([]);
    setDebugInfo(null);
    setInputText("");
    setFsm("ending");
    try {
      await fetch(
        `/api/conversation/end?conversation_id=${conversationId.current}`,
        { method: "POST" }
      );
    } catch {
      /* ignore */
    }
    onEnded?.();
  }, [
    clearFinalizeTimer,
    onEnded,
    setFsm,
    stopListening,
    stopAudioQueue,
    stopPartialLoop,
    stopStreaming,
  ]);

  return {
    callStage,
    fsmState,
    messages,
    inputText,
    setInputText,
    isListening,
    isProcessing,
    debugInfo,
    detectedLanguage,
    error,
    setError,
    recognitionRef,
    audioRef,
    conversationId,
    startCall,
    endCall,
    sendMessage,
    toggleListening,
    startListening,
    stopListening,
    // Real-time voice UX
    vadSupported,
    isUserSpeaking,
    partialTranscript,
    voiceStats,
    micLevelsRef, // live caller waveform (0..1 per bar)
    aiLevelsRef, // live Mrs. D waveform (0..1 per bar)
  };
}
