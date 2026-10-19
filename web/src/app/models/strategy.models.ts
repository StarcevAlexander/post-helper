export interface StrategyPillar {
  title: string;
  description: string;
  ideas: string[];
}

export interface StrategyCadence {
  reels: number;
  posts: number;
  stories: number;
  note: string;
}

export interface Strategy {
  summary: string;
  positioning: string;
  profileFixes: string[];
  pillars: StrategyPillar[];
  cadence: StrategyCadence;
  firstSteps: string[];
}
