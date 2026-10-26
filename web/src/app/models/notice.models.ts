export type NoticeKind = 'plan' | 'refs' | 'media' | 'content' | 'publication' | 'message';

export type NoticeState = 'actual' | 'done' | 'outdated' | 'info';

export type NoticeReason =
  | 'planRemoved'
  | 'planReplaced'
  | 'refsGone'
  | 'mediaGone'
  | 'dayPassed'
  | 'scheduleChanged'
  | 'itemRemoved'
  | 'published'
  | 'moved';

export interface NoticeView {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  sentAt: string;
  state: NoticeState;
  reason?: NoticeReason;
  link?: string;
  movedTo?: string;
}

export interface NoticeRow {
  notice: NoticeView;
  when: string;
  note?: string;
  canOpen: boolean;
}
