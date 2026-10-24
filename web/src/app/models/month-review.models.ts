export interface MonthReview {
  id: string;
  from: string;
  to: string;
  planned: number;
  done: number;
  headline: string;
  facts: string[];
  conclusions: string[];
  changes: string[];
  note: string;
}
