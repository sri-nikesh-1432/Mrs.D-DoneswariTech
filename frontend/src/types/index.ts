// ─── Agent & Onboarding ─────────────────────────────────────────
export interface OnboardPayload {
  name: string;
  phone_number: string;
  agent_name: string;
  language?: string;
  voice?: string;
}

export interface AgentProfile {
  id: string | number;
  name: string;          // user/institution name
  agent_name: string;    // e.g. "Mrs.D"
  phone_number: string;
  language: string;
  voice: string;
  status: AgentStatus;
  published_version?: string | number | null;
  knowledge_file?: string | null;
  knowledge_status?: KnowledgeStatus;
  created_at?: string;
  updated_at?: string;
}

export type AgentStatus = "draft" | "training" | "ready" | "published" | "paused";
export type KnowledgeStatus = "uploaded" | "extracting" | "chunking" | "embedding" | "indexing" | "configuring" | "ready" | "failed";

// ─── Voice / Conversation ─────────────────────────────────────────
export type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "calling"
  | "connected"
  | "ended"
  | "error"
  | "greeting";

export interface ConversationMessage {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  language?: string;
  partial?: boolean;
}

// ─── Memory Panel ─────────────────────────────────────────────────
export interface CallerMemory {
  caller_name?: string;
  caller_phone?: string;
  student_name?: string;
  student_class?: string;
  course_interest?: string;
  location?: string;
  budget?: string;
  hostel?: string;
  transport?: string;
  interest_score?: number;
  objections?: string;
  preferred_callback?: string;
  lead_intent?: "HOT" | "WARM" | "COLD" | "";
}

// ─── Calls & Leads ────────────────────────────────────────────────
export type LeadIntent = "HOT" | "WARM" | "COLD";

export interface CallRecord {
  id: string | number;
  caller_name: string;
  caller_phone: string;
  date: string;
  duration: string;         // e.g. "3:42"
  language: string;
  interest_score: number;   // 0-100
  lead_status: LeadIntent;
  course?: string;
  outcome: string;
  summary?: string;
  transcript?: ConversationMessage[];
  lead?: CallerMemory;
  objections?: string[];
  next_action?: string;
  conversion_likelihood?: number;
  questions_asked?: string[];
}

export interface CallStats {
  total_calls: number;
  answered_calls: number;
  missed_calls: number;
  hot_leads: number;
  warm_leads: number;
  cold_leads: number;
  avg_duration: string;
  conversion_rate: number;
  interested_leads: number;
}

// ─── Analytics ────────────────────────────────────────────────────
export interface AnalyticPoint {
  date: string;
  calls: number;
  interested: number;
  hot: number;
}

// ─── Settings ─────────────────────────────────────────────────────
export interface AgentSettings {
  agent_name: string;
  business_name: string;
  phone_number: string;
  supported_languages: string[];
  voice: string;
  voice_speed: number;
  background_ambience: boolean;
  greeting: string;
  knowledge_file?: string | null;
  knowledge_status?: KnowledgeStatus;
  published_version?: string | number | null;
}

// ─── WS Messages ─────────────────────────────────────────────────
export interface WSMessage {
  type:
    | "agent_state"
    | "transcript_partial"
    | "transcript_final"
    | "agent_response_partial"
    | "agent_response_final"
    | "audio_chunk"
    | "memory_update"
    | "call_started"
    | "call_connected"
    | "call_ended"
    | "lead_score_update"
    | "report_ready"
    | "error";
  data: unknown;
}

// ─── Training Job ─────────────────────────────────────────────────
export interface TrainingJob {
  job_id: string;
  status: KnowledgeStatus;
  progress?: number;
  message?: string;
}
