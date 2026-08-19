/**
 * VoiceWebSocket - Retell AI-level persistent WebSocket voice agent.
 *
 * Connects to the backend's /ws/voice endpoint and provides a simple
 * interface for streaming microphone PCM audio and receiving sentence-level
 * TTS audio in return.
 *
 * This is the WebSocket alternative to the HTTP SSE pipeline in useVoiceAgent.
 * It keeps a single persistent connection open for the entire conversation,
 * eliminating per-turn HTTP overhead — matching Retell AI's architecture.
 */

export type VoiceWSState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export interface VoiceWSConfig {
  mode?: "test" | "process";
  knowledgeFile?: string;
  instituteId?: number;
  language?: string;
}

export interface VoiceWSMessage {
  role: "user" | "ai";
  content: string;
  timestamp: string;
}

export interface VoiceWSDebugInfo {
  stt_time_ms?: number;
  rag_time_ms?: number;
  llm_time_ms?: number;
  tts_time_ms?: number;
  first_sentence_ms?: number;
  total_time_ms?: number;
  sentence_count?: number;
  knowledge_source?: string;
  stream_error?: string;
}

interface VoiceWSCallbacks {
  onStateChange?: (state: VoiceWSState) => void;
  onMessage?: (message: VoiceWSMessage) => void;
  onMessageUpdate?: (index: number, content: string) => void;
  onSentence?: (text: string, audioData: string | null, index: number) => void;
  onTranscript?: (text: string, language: string) => void;
  onTurnDone?: (aiResponse: string, debugInfo: VoiceWSDebugInfo) => void;
  onError?: (detail: string) => void;
}

const SAMPLE_RATE = 16000;

export class VoiceWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: VoiceWSCallbacks = {};
  private state: VoiceWSState = "disconnected";
  private config: VoiceWSConfig = {};
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private audioQueue: Array<{ text: string; audioData: string }> = [];
  private queuePlaying = false;
  private conversationId: string = "";
  private messages: VoiceWSMessage[] = [];
  private currentAiIndex: number = -1;
  private currentAiText: string = "";

  getState(): VoiceWSState {
    return this.state;
  }

  getConversationId(): string {
    return this.conversationId;
  }

  getMessages(): VoiceWSMessage[] {
    return this.messages;
  }

  async connect(config: VoiceWSConfig, callbacks: VoiceWSCallbacks): Promise<void> {
    this.config = config;
    this.callbacks = callbacks;
    this.audioQueue = [];
    this.queuePlaying = false;
    this.messages = [];
    this.currentAiIndex = -1;
    this.currentAiText = "";
    this.setState("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/voice`;

    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        console.log("[VoiceWS] Connected to", url);
        this.ws!.send(
          JSON.stringify({
            type: "config",
            mode: config.mode || "test",
            knowledge_file: config.knowledgeFile || "institute.json",
            institute_id: config.instituteId || 1,
            language: config.language || "English",
          })
        );
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          this.handleJSONMessage(event.data);
        }
      };

      this.ws.onerror = (err) => {
        console.error("[VoiceWS] Error:", err);
        this.setState("error");
        this.callbacks.onError?.("WebSocket connection error");
      };

      this.ws.onclose = () => {
        console.log("[VoiceWS] Disconnected");
        this.setState("disconnected");
        this.stopMicrophone();
      };
    } catch (e) {
      console.error("[VoiceWS] Connection failed:", e);
      this.setState("error");
      this.callbacks.onError?.("Failed to connect to voice agent");
    }
  }

  private handleJSONMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "connected":
        this.conversationId = msg.conversation_id || "";
        this.setState("connected");
        break;

      case "sentence":
        this.callbacks.onSentence?.(msg.text || "", msg.audio_data || null, msg.index ?? 0);
        if (msg.audio_data) {
          this.enqueueSentence(msg.text || "", msg.audio_data);
        }
        // Progressive AI message update
        this.currentAiText += msg.text || "";
        if (this.currentAiIndex >= 0) {
          this.callbacks.onMessageUpdate?.(this.currentAiIndex, this.currentAiText);
        }
        break;

      case "turn_done":
        this.setState("listening");
        this.callbacks.onTurnDone?.(msg.ai_response || "", msg.debug_info || {});
        // Finalize AI message
        if (this.currentAiIndex >= 0 && msg.ai_response) {
          this.currentAiText = msg.ai_response;
          this.callbacks.onMessageUpdate?.(this.currentAiIndex, this.currentAiText);
        }
        this.currentAiIndex = -1;
        this.currentAiText = "";
        break;

      case "processing":
        this.setState("processing");
        // Add AI message placeholder
        this.currentAiText = "";
        const aiMsg: VoiceWSMessage = {
          role: "ai",
          content: "",
          timestamp: new Date().toISOString(),
        };
        this.messages.push(aiMsg);
        this.currentAiIndex = this.messages.length - 1;
        this.callbacks.onMessage?.(aiMsg);
        break;

      case "transcript":
        this.callbacks.onTranscript?.(msg.text || "", msg.language || "en");
        // Add user message
        const userMsg: VoiceWSMessage = {
          role: "user",
          content: msg.text || "",
          timestamp: new Date().toISOString(),
        };
        this.messages.push(userMsg);
        this.callbacks.onMessage?.(userMsg);
        break;

      case "speech_start":
        this.setState("processing");
        break;

      case "speech_end":
        break;

      case "ended":
        this.disconnect();
        break;

      case "error":
        console.error("[VoiceWS] Server error:", msg.detail);
        this.setState("error");
        this.callbacks.onError?.(msg.detail || "Unknown server error");
        break;
    }
  }

  async startMicrophone(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.mediaStream = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx({ sampleRate: SAMPLE_RATE });

      const source = this.audioCtx.createMediaStreamSource(stream);
      const bufferSize = 4096;
      this.scriptProcessor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);

      this.scriptProcessor.onaudioprocess = (event) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const float32 = event.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        this.ws.send(int16.buffer);
      };

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioCtx.destination);

      this.setState("listening");
      return true;
    } catch (e) {
      console.error("[VoiceWS] Microphone access failed:", e);
      this.callbacks.onError?.(
        "Microphone access denied. Please allow microphone access and try again."
      );
      return false;
    }
  }

  stopMicrophone(): void {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }

  private enqueueSentence(text: string, audioData: string): void {
    this.audioQueue.push({ text, audioData });
    if (!this.queuePlaying) {
      this.playNextSentence();
    }
  }

  private async playNextSentence(): Promise<void> {
    if (this.audioQueue.length === 0) {
      this.queuePlaying = false;
      return;
    }

    this.queuePlaying = true;
    this.setState("speaking");

    const { audioData } = this.audioQueue.shift()!;

    try {
      const binaryStr = atob(audioData);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: "audio/mp3" });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = (e) => {
          URL.revokeObjectURL(url);
          reject(e);
        };
        audio.play().catch(reject);
      });
    } catch (e) {
      console.warn("[VoiceWS] Audio playback failed:", e);
    }

    const pause = 300 + Math.random() * 200;
    await new Promise((r) => setTimeout(r, pause));

    this.playNextSentence();
  }

  async endCall(): Promise<void> {
    this.stopMicrophone();
    this.audioQueue = [];
    this.queuePlaying = false;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "end" }));
      await new Promise((r) => setTimeout(r, 200));
    }

    this.disconnect();
  }

  disconnect(): void {
    this.stopMicrophone();
    this.audioQueue = [];
    this.queuePlaying = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState("disconnected");
  }

  private setState(state: VoiceWSState): void {
    if (this.state !== state) {
      this.state = state;
      this.callbacks.onStateChange?.(state);
    }
  }
}

export const voiceWebSocket = new VoiceWebSocket();
