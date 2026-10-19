export type RequestStatus = 'pending' | 'success' | 'error';

export interface RequestEntry {
  id: string;
  createdAt: Date;
  description: string;
  status: RequestStatus;
  durationMs?: number;
  sent: string;
  received?: string;
}

export interface StoredRequestEntry {
  id: string;
  createdAt: string;
  description: string;
  status: RequestStatus;
  durationMs?: number;
  sent: string;
  received?: string;
}

export interface RequestDescriptor {
  description: string;
  sent: string;
}
