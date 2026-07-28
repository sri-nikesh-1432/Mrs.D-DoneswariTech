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
  stats: Campaign;
  students: Student[];
  analytics: {
    sentiment_distribution: { positive: number; neutral: number; negative: number };
    interest_levels: { high: number; medium: number; low: number };
    course_distribution: Record<string, number>;
    total_students: number;
    completion_rate: number;
    interest_rate: number;
  };
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface UploadResponse {
  success: boolean;
  message: string;
  doc_id?: number;
  chunk_count?: number;
  status?: string;
  knowledge_ready?: boolean;
  imported?: number;
  skipped?: number;
  errors?: string[];
  total?: number;
}
