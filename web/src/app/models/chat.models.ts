import { ProfileField } from './profile.models';

export type MessageRole = 'user' | 'assistant';

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  file: File;
  previewUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  attachments: Attachment[];
  createdAt: Date;
  pending?: boolean;
  failed?: boolean;
  onboarding?: boolean;
  answerFor?: ProfileField;
}

export interface StoredMessage {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: string;
  onboarding?: boolean;
  answerFor?: ProfileField;
}

export interface ComposerPayload {
  text: string;
  attachments: Attachment[];
}

export interface ChatReply {
  id: string;
  text: string;
}
