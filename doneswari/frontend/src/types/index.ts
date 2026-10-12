export interface UploadResponse {
  document_id: string;
  agent_id: string;
  filename: string;
  file_size: number;
}

export interface TrainingProgress {
  step: number;
  total: number;
  message: string;
  status: 'starting' | 'in_progress' | 'complete' | 'failed';
  percent: number;
}

export interface AgentProfile {
  institution_name: string;
  institution_type: string;
  location: string;
  courses: string[];
  faqs: Array<{ question: string; grounded: boolean; source: string | null }>;
}

export interface KnowledgeStats {
  total_chunks: number;
  total_pages: number;
  categories: Record<string, number>;
  grounded_faqs: number;
  total_faqs: number;
  knowledge_quality: number;
  capabilities: string[];
}

export interface Agent {
  id: string;
  status: string;
  status_message: string;
  institution_profile: AgentProfile;
  knowledge_stats: KnowledgeStats;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  retrieved_chunks?: Array<{ text: string; page: number; section: string; category: string; score: number }>;
  timestamp: Date;
}

export interface ConversationMemory {
  caller_name: string;
  student_name: string;
  course_interest: string;
  language: string;
  concern: string;
  hostel_needed: boolean;
  fee_concern: boolean;
  scholarship_interest: boolean;
  lead_signals: string[];
  topics_discussed: string[];
}

export interface ChatResponse {
  conversation_id: string;
  response: string;
  retrieved_chunks: Array<{ text: string; page: number; section: string; category: string; score: number }>;
  lead_status: string;
  memory: ConversationMemory;
  objection_type: string | null;
}
