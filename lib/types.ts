export enum FLAGS {
  COPILOT = "copilot",
  SUMMARIZER = "summarizer",
  ASK_AI = "ask-ai",
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

export interface UserInterviewContext {
  interviewNotes: string | null;
  resumeText: string | null;
  resumeFileName: string | null;
  jobDescription: string | null;
  updatedAt: string | Date | null;
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

export type SupportAuthorType = "user" | "admin";

export type SupportThreadStatus = "open" | "pending" | "resolved" | "reply";

export interface SupportMessage {
  id: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  parentId: string | null;
  authorType: SupportAuthorType;
  authorEmail: string | null;
  subject: string | null;
  body: string;
  status: SupportThreadStatus;
  unreadByAdmin: boolean;
  unreadByUser: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupportThreadListResponse {
  threads: SupportMessage[];
  total: number;
  pagination: { limit: number; offset: number };
}

export interface SupportThreadResponse {
  thread: SupportMessage;
  messages: SupportMessage[];
}

export type AnnouncementKind = "banner" | "popup" | "toast";
export type AnnouncementSeverity =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "announcement";

export interface AppAnnouncement {
  id: string;
  kind: AnnouncementKind;
  severity: AnnouncementSeverity;
  title: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audience: "all" | "users";
  status: "active" | "paused" | "archived";
  dismissable: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveAnnouncementsResponse {
  announcements: AppAnnouncement[];
}
