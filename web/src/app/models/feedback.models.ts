export interface FeedbackSubmission {
  text: string;
  contact: string;
  itemId?: string;
}

export interface IdeaRequestMark {
  idea: string;
  sentAt: string;
}

export type IdeaRequestMarks = Record<string, IdeaRequestMark>;

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}
