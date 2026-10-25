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

export interface IntakeStats {
  followers?: number;
  reach?: number;
  bestPost?: string;
}

export interface IntakeStatsDraft {
  followers: string;
  reach: string;
  bestPost: string;
}

export type IntakeStatField = keyof IntakeStatsDraft;

export interface IntakeSchedule {
  shootDays: number[];
  shootTime?: string;
  publishTime?: string;
}

export interface IntakeScheduleDraft {
  shootDays: number[];
  shootTime: string;
  publishTime: string;
}

export type IntakeTimeField = Exclude<keyof IntakeScheduleDraft, 'shootDays'>;

export interface IntakeDraft {
  links: string[];
  references: string[];
  goals: IntakeGoalId[];
  note: string;
  city: string;
  stats: IntakeStatsDraft;
  schedule: IntakeScheduleDraft;
}

export interface IntakeSubmission extends Omit<IntakeDraft, 'stats' | 'schedule'> {
  review?: boolean;
  timeZone?: string;
  stats?: IntakeStats;
  schedule?: IntakeSchedule;
}

export interface IntakeRequest {
  id: string;
  networks: IntakeNetwork[];
  references?: IntakeNetwork[];
  goals: IntakeGoalId[];
  note?: string;
  city?: string;
  status: IntakeStatus;
  replyNote?: string;
  createdAt: string;
  updatedAt: string;
  readyAt?: string;
  review?: boolean;
  stats?: IntakeStats;
  schedule?: IntakeSchedule;
}
