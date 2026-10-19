import { KIT_FRAME_LABELS, KIT_OVERLAY_LABEL, KIT_SECTIONS, KIT_VISUAL_LABEL } from '../constants';
import { PostFormat, PublicationKit } from '../models';

export function captionWithHashtags(kit: PublicationKit): string {
  return [kit.caption, kit.hashtags.join(' ')].filter(Boolean).join('\n\n');
}

export function fullKitText(title: string, format: PostFormat, kit: PublicationKit): string {
  const frameLabel = KIT_FRAME_LABELS[format];
  const sections: string[] = [title];
  if (kit.shots.length > 0) {
    sections.push(`${KIT_SECTIONS.shots}:\n${kit.shots.map((shot) => `- ${shot}`).join('\n')}`);
  }
  if (kit.frames.length > 0) {
    const frames = kit.frames.map((frame, index) =>
      [
        `${frameLabel} ${index + 1}`,
        frame.visual ? `${KIT_VISUAL_LABEL}: ${frame.visual}` : '',
        frame.overlay ? `${KIT_OVERLAY_LABEL}: ${frame.overlay}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    sections.push(`${KIT_SECTIONS.frames}:\n${frames.join('\n\n')}`);
  }
  if (kit.caption) {
    sections.push(`${KIT_SECTIONS.caption}:\n${kit.caption}`);
  }
  if (kit.hashtags.length > 0) {
    sections.push(`${KIT_SECTIONS.hashtags}:\n${kit.hashtags.join(' ')}`);
  }
  if (kit.tip) {
    sections.push(`${KIT_SECTIONS.tip}: ${kit.tip}`);
  }
  return sections.join('\n\n');
}
