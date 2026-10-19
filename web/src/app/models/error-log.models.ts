export type ErrorSource = 'send' | 'microphone' | 'speech' | 'attachment';

export interface ErrorEntry {
  id: string;
  source: ErrorSource;
  message: string;
  createdAt: Date;
}

export interface StoredErrorEntry {
  id: string;
  source: ErrorSource;
  message: string;
  createdAt: string;
}
