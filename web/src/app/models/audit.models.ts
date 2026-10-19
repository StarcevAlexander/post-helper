export interface AuditResult {
  summary: string;
  strengths: string[];
  problems: string[];
  fixes: string[];
  bioSuggestion: string;
  nameSuggestion: string;
  contentNotes: string[];
  missing: string[];
}

export interface StoredAudit {
  createdAt: string;
  jobId?: string;
  imageCount: number;
  result: AuditResult;
}

export interface AuditPick {
  id: string;
  file: File;
  previewUrl: string;
}

export type AuditJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface AuditJob {
  id: string;
  handle: string;
  status: AuditJobStatus;
  createdAt: string;
  error?: string;
  result?: AuditResult;
}
