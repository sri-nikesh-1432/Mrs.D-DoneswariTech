export interface Campaign {
  id?: number;
  campaign_id: string;
  campaign_name: string;
  institute_name: string;
  status: "pending" | "running" | "paused" | "completed" | "cancelled";
  language: string;
  voice: string;
  total_students: number;
  calls_completed: number;
  calls_failed: number;
  calls_in_progress: number;
  interested: number;
  follow_up_required: number;
  average_duration: number;
  knowledge_ready: boolean;
  progress: number;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface Student {
  id: number;
  name: string;
  phone: string;
  email: string;
  preferred_course: string;
  city: string;
  status: "not_called" | "calling" | "completed" | "failed" | "retry";
  call_state: string;
  duration: number;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  interest_score: number;
  summary: string;
  transcript: string;
  questions_asked: string[];
  recommended_follow_up: string;
  admission_probability: number;
  called_at: string | null;
}

export interface KnowledgeDoc {
  id: number;
  filename: string;
  status: string;
  chunk_count: number;
}

export interface Activity {
  message: string;
  type: "info" | "success" | "warning" | "error";
  timestamp: string;
}

export interface CampaignStats {
  campaign_id: number;
  campaign_name: string;
  institute_name: string;
  status: string;
  total_students: number;
  completed_calls: number;
  failed_calls: number;
  pending_calls: number;
  completion_rate: number;
  interested_students: number;
  not_interested: number;
  neutral_students: number;
  interest_rate: number;
  sentiment_distribution: Record<string, number>;
  course_distribution: Record<string, number>;
  average_call_duration: number;
  total_call_duration: number;
  follow_up_required: number;
  most_asked_questions: Array<[string, number]>;
  common_objections: Array<[string, number]>;
  started_at?: string;
  completed_at?: string;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface UploadResponse {
  message: string;
  knowledge_id?: number;
  status?: string;
  total_students?: number;
  imported?: number;
  duplicates_removed?: number;
  campaign_id?: number;
  errors?: string[];
}
