import { encode } from 'gpt-tokenizer';

/**
 * Returns the token count for a given text.
 */
export function countTokens(text: string | null | undefined): number {
  if (!text) return 0;

  try {
    return encode(text).length;
  } catch {
    // Conservative fallback if tokenization fails.
    return Math.ceil(text.length / 4);
  }
}

export interface CharacterTokenFields {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  greeting?: string;
  mes_example?: string;
}

/**
 * Counts the tokens of character fields that are included in the core prompt context.
 */
export function countCoreCharacterTokens(fields: CharacterTokenFields): number {
  return (
    countTokens(fields.name) +
    countTokens(fields.description) +
    countTokens(fields.personality) +
    countTokens(fields.scenario) +
    countTokens(fields.greeting) +
    countTokens(fields.mes_example)
  );
}