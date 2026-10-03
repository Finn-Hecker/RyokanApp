import { estimateTokens } from './tokenEstimate.ts';

/**
 * Returns an approximate token count for editor displays, never provider usage.
 */
export function countTokens(text: string | null | undefined): number {
  return estimateTokens(text);
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
