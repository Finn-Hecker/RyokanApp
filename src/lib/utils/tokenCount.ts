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
  prompt?: string;
  greeting?: string;
}

export function countCoreCharacterTokens(
  fields: CharacterTokenFields
): number {
  return (
    countTokens(fields.name) +
    countTokens(fields.prompt) +
    countTokens(fields.greeting)
  );
}