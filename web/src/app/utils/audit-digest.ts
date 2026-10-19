import { MAX_AUDIT_DIGEST_RUNES } from '../constants';
import { AuditResult } from '../models';

function clip(text: string): string {
  const letters = Array.from(text);
  return letters.length > MAX_AUDIT_DIGEST_RUNES
    ? `${letters
        .slice(0, MAX_AUDIT_DIGEST_RUNES - 1)
        .join('')
        .trimEnd()}…`
    : text;
}

function sentence(label: string, items: string[]): string {
  return items.length > 0 ? `${label}: ${items.join('; ')}.` : '';
}

export function buildAuditDigest(result: AuditResult): string {
  const parts = [
    result.summary,
    sentence('Сильные стороны', result.strengths),
    sentence('Слабые места', result.problems),
    result.nameSuggestion ? `Предложенное имя профиля: ${result.nameSuggestion}.` : '',
    result.bioSuggestion ? `Предложенная шапка: ${result.bioSuggestion}.` : '',
    sentence('Правки', result.fixes),
  ];
  return clip(
    parts
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' '),
  );
}
