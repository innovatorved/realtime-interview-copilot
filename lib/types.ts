export enum FLAGS {
  COPILOT = "copilot",
  SUMMARIZER = "summarizer",
}

export interface HistoryData {
  createdAt: string;
  data: string;
  tag: string;
}

export interface SavedNote {
  id: string;
  userId: string;
  content: string;
  tag: string;
  createdAt: string;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface NotesResponse {
  notes: SavedNote[];
  pagination: PaginationInfo;
}

export interface InterviewPreset {
  id: string;
  name: string;
  category: string;
  context: string;
  description: string | null;
  icon: string | null;
  isBuiltIn: boolean | null;
  userId: string | null;
  createdAt: string;
}

export interface TranscriptionWord {
  word: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: number;
}

export interface TranscriptionSegment {
  id: string;
  text: string;
  words: TranscriptionWord[];
  startTime: number;
  endTime: number;
  confidence?: number;
  speaker?: number;
  isFinal: boolean;
  timestamp: string;
}
