import { PublicationKit } from '../models';

export function captionWithHashtags(kit: PublicationKit): string {
  return [kit.caption, kit.hashtags.join(' ')].filter(Boolean).join('\n\n');
}
