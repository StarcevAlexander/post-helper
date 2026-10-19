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
  imageCount: number;
  result: AuditResult;
}

export interface AuditPick {
  id: string;
  file: File;
  previewUrl: string;
}
