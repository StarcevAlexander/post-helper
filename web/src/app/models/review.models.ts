import { MasterProfile } from './profile.models';
import { PostFormat } from './schedule.models';
import { StrategyCadence } from './strategy.models';

export interface ReviewAnswers {
  inquiries?: number;
  bestIdea: string;
  hard: string;
}

export interface ReviewIdeas {
  pillar: string;
  ideas: string[];
}

export interface ReviewCadence {
  reels: number;
  posts: number;
  stories: number;
}

export interface ReviewResult {
  headline: string;
  whatWorked: string[];
  whatToChange: string[];
  nextFocus: string;
  cadence: ReviewCadence;
  newIdeas: ReviewIdeas[];
}

export interface ReviewItemPayload {
  format: PostFormat;
  pillar: string;
  idea: string;
  done: boolean;
}

export interface ReviewRequest {
  profile: MasterProfile;
  positioning: string;
  cadence: StrategyCadence;
  pillars: { title: string; ideas: string[] }[];
  items: ReviewItemPayload[];
  results: ReviewAnswers;
}

export interface StoredReview {
  weekFrom: string;
  createdAt: string;
  answers: ReviewAnswers;
  result: ReviewResult;
  applied: boolean;
}
