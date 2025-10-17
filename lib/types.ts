export enum FLAGS {
  COPILOT = "copilot",
  SUMMERIZER = "summerizer",
}

export interface HistoryData {
  createdAt: string;
  data: string;
  tag: string;
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
