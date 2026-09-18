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
  name: string;          // company / institution name
  agent_name: string;    // e.g. "Aadhya"
  company_name?: string;
  phone_number?: string;
  calling_purpose?: string;
  description?: string | null;
  language?: string;
  voice?: string;
  voice_speed?: number;
  greeting_message?: string;
  instructions?: string | null;
  status: AgentStatus;
  total_students?: number;
  calls_completed?: number;
  interested_count?: number;
  follow_up_count?: number;
  knowledge_ready?: boolean;
  knowledge_document?: string | null;
  published_version?: string | number | null;
  knowledge_file?: string | null;
  knowledge_status?: KnowledgeStatus;
  created_at?: string;
  updated_at?: string;
}

export type AgentStatus = "draft" | "processing" | "ready" | "testing" | "published" | "paused" | "training";
export type KnowledgeStatus = "uploaded" | "extracting" | "chunking" | "embedding" | "indexing" | "configuring" | "ready" | "failed" | "waiting" | "processing" | "error";

// ─── Auth ─────────────────────────────────────────────────────────
export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  company_name?: string | null;
}

export interface AuthWorkspace {
  id: number;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  workspace: AuthWorkspace;
}

export interface MeResponse {
  authenticated: boolean;
  user: AuthUser;
  workspace: AuthWorkspace;
}

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

// ─── Students ─────────────────────────────────────────────────────
export type StudentCallStatus =
  | "Pending" | "Calling" | "In Progress" | "Completed"
  | "No Answer" | "Busy" | "Failed" | "Callback Requested";

export type InterestLevelType =
  | "Interested" | "Not Interested" | "Needs Follow-up"
  | "Callback Requested" | "Unclear";

export interface Student {
  id: number;
  name: string;
  phone: string;
  email?: string | null;
  preferred_course?: string | null;
  city?: string | null;
  call_status: string;
  interest_level: string;
  duration_seconds?: number;
  questions_asked?: string[];
  objections?: string[];
  callback_requested?: boolean;
  outcome?: string | null;
  last_called_at?: string | null;
}

export interface StudentListResponse {
  total: number;
  students: Student[];
}

export interface ImportPreview {
  filename: string;
  total_rows: number;
  valid_count: number;
  invalid_count: number;
  duplicates_count: number;
  preview_valid: Array<Record<string, string>>;
  errors: Array<{ row: number; reason: string; name?: string; phone?: string }>;
  valid_records: Array<Record<string, string>>;
}

// ─── Campaign ─────────────────────────────────────────────────────
export interface CampaignStatus {
  agent_id: number;
  agent_name: string;
  agent_status: string;
  is_running: boolean;
  total_students: number;
  ready_to_call: number;
  in_progress: number;
  completed: number;
  interested: number;
  not_interested: number;
  follow_up_required: number;
  callback_requested: number;
  failed: number;
  progress_percent: number;
}

// ─── Analytics ────────────────────────────────────────────────────
export interface AnalyticsCards {
  total_students: number;
  total_calls: number;
  completed_calls: number;
  interested: number;
  not_interested: number;
  follow_ups: number;
  callbacks: number;
  no_answer: number;
  average_duration: string;
  average_duration_seconds: number;
}

export interface AgentAnalytics {
  agent_name: string;
  company_name: string;
  cards: AnalyticsCards;
  interest_distribution: Array<{ name: string; value: number; color: string }>;
  call_outcomes: Array<{ outcome: string; count: number }>;
  most_asked_questions: Array<{ question: string; count: number }>;
  calls_over_time: Array<{ date: string; calls: number }>;
  latency_metrics: {
    avg_stt_ms: number;
    avg_retrieval_ms: number;
    avg_llm_ms: number;
    avg_tts_ms: number;
    avg_total_ms: number;
  };
}

export interface StudentAnalytics {
  student: Student & { notes?: string | null };
  calls: Array<{
    id: string;
    call_status: string;
    date: string;
    duration_seconds: number;
    transcript: string;
    summary: string;
    questions_asked: string[];
    objections: string[];
    interest_level: string;
    outcome: string;
    total_latency_ms: number;
  }>;
}

export interface LatencyAudit {
  stt_ms?: number;
  retrieval_ms?: number;
  llm_ms?: number;
  tts_ms?: number;
  total_ms?: number;
}

export interface AgentCallRecord {
  id: number;
  call_id: string;
  student_id: number | null;
  caller_name: string;
  caller_number: string;
  call_status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  interest_level: string;
  outcome: string;
  callback_requested: boolean;
  summary: string;
  questions_asked: string[];
  objections: string[];
  latency: LatencyAudit;
  total_turns: number;
}

// ─── Legacy Calls & Leads ─────────────────────────────────────────
export type LeadIntent = "HOT" | "WARM" | "COLD";

export interface CallRecord {
  id: string | number;
  caller_name: string;
  caller_phone: string;
  date: string;
  duration: string;
  language: string;
  interest_score: number;
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
