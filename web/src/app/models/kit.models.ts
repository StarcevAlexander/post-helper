import { PostFormat } from './schedule.models';

export interface KitFrame {
  visual: string;
  overlay: string;
}

export interface PublicationKit {
  shots: string[];
  frames: KitFrame[];
  caption: string;
  hashtags: string[];
  tip: string;
}

export interface StoredKit {
  itemId: string;
  format: PostFormat;
  pillar: string;
  idea: string;
  kit: PublicationKit;
}
