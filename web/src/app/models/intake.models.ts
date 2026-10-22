export type IntakePlatform =
  | 'instagram'
  | 'vk'
  | 'telegram'
  | 'youtube'
  | 'tiktok'
  | 'ok'
  | 'dzen'
  | 'rutube'
  | 'max'
  | 'other';

export type IntakeGoalId =
  | 'reach'
  | 'followers'
  | 'leads'
  | 'check'
  | 'repeat'
  | 'brand'
  | 'expert'
  | 'premium'
  | 'engagement'
  | 'schedule'
  | 'products'
  | 'system';

export type IntakeStatus = 'new' | 'ready';

export interface IntakeGoal {
  id: IntakeGoalId;
  label: string;
}

export interface IntakeNetwork {
  platform: IntakePlatform;
  url: string;
}

export interface IntakeDraft {
  links: string[];
  references: string[];
  goals: IntakeGoalId[];
  note: string;
}

export interface IntakeRequest {
  id: string;
  networks: IntakeNetwork[];
  references?: IntakeNetwork[];
  goals: IntakeGoalId[];
  note?: string;
  status: IntakeStatus;
  replyNote?: string;
  createdAt: string;
  updatedAt: string;
  readyAt?: string;
}
