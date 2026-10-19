import {
  ANSWER_REASONS,
  ANSWER_EMPTY_HINT,
  ANSWER_SKIP_HINT,
  HANDLE_PATTERN,
  JUNK_ANSWERS,
  KEYBOARD_MASH_LENGTH,
  KEYBOARD_ROWS,
  MAX_CONSONANT_RUN,
  MAX_LETTER_REPEAT,
  MIN_CHECKED_WORD_LENGTH,
  NAME_PATTERN,
  VOWELS,
} from '../constants';
import { AnswerContext, OnboardingStep } from '../models';

function withExample(reason: string, step: OnboardingStep, context: AnswerContext): string {
  const optionalHint = context === 'chat' ? ANSWER_SKIP_HINT : ANSWER_EMPTY_HINT;
  const hint = step.required ? '' : ` ${optionalHint}`;
  return `${reason} «${step.example}».${hint}`;
}
function hasKeyboardMash(word: string): boolean {
  for (let start = 0; start + KEYBOARD_MASH_LENGTH <= word.length; start += 1) {
    const piece = word.slice(start, start + KEYBOARD_MASH_LENGTH);
    const reversed = Array.from(piece).reverse().join('');
    if (KEYBOARD_ROWS.some((row) => row.includes(piece) || row.includes(reversed))) {
      return true;
    }
  }
  return false;
}

function isImplausibleWord(word: string): boolean {
  if (word.length < MIN_CHECKED_WORD_LENGTH) {
    return false;
  }
  if (new RegExp(`(.)\\1{${MAX_LETTER_REPEAT - 1},}`, 'u').test(word)) {
    return true;
  }
  if (!Array.from(word).some((letter) => VOWELS.includes(letter))) {
    return true;
  }
  const consonants = new RegExp(`[^${VOWELS}]{${MAX_CONSONANT_RUN},}`, 'u');
  return consonants.test(word) || hasKeyboardMash(word);
}

function looksLikeJunk(text: string): boolean {
  const lowered = text.trim().toLowerCase();
  if (JUNK_ANSWERS.includes(lowered)) {
    return true;
  }
  const words = lowered.match(/\p{L}+/gu) ?? [];
  const letters = words.join('');
  if (letters.length >= 6 && new Set(letters).size < 3) {
    return true;
  }
  const implausible = words.filter(isImplausibleWord).length;
  return words.length > 0 && implausible * 2 >= words.length && implausible > 0;
}

export function validateAnswer(
  step: OnboardingStep,
  text: string,
  context: AnswerContext = 'chat',
): string | undefined {
  const value = text.trim().replace(/\s+/g, ' ');
  if (!value) {
    return step.required ? withExample(ANSWER_REASONS.requiredEmpty, step, context) : undefined;
  }

  if (step.kind === 'handle') {
    return HANDLE_PATTERN.test(value)
      ? undefined
      : withExample(ANSWER_REASONS.handle, step, context);
  }

  if (step.kind === 'name' && (!NAME_PATTERN.test(value) || value.split(' ').length > 3)) {
    return withExample(ANSWER_REASONS.name, step, context);
  }

  const letters = (value.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) {
    return withExample(ANSWER_REASONS.noLetters, step, context);
  }
  if (Array.from(value).length < step.minChars) {
    return withExample(ANSWER_REASONS.tooShort, step, context);
  }
  if (looksLikeJunk(value)) {
    return withExample(ANSWER_REASONS.junk, step, context);
  }
  return undefined;
}
