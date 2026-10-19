export type AnswerKind = 'name' | 'text' | 'handle';

export type AnswerContext = 'chat' | 'form';

export interface MasterProfile {
  specialty: string;
  name?: string;
  city?: string;
  experience?: string;
  services?: string;
  clients?: string;
  goal?: string;
  instagram?: string;
  style?: string;
}

export type ProfileField = keyof MasterProfile;

export type ProfileDraft = Record<ProfileField, string>;

export interface OnboardingStep {
  field: ProfileField;
  label: string;
  question: string;
  example: string;
  kind: AnswerKind;
  minChars: number;
  required: boolean;
}

export type OnboardingOutcome = 'next' | 'repeat' | 'invalid' | 'done';

export interface AnswerResult {
  outcome: OnboardingOutcome;
  reason?: string;
}

export interface StoredOnboarding {
  index: number;
  answers: Partial<MasterProfile>;
  confirmed?: boolean;
  resumeIndex?: number;
}
