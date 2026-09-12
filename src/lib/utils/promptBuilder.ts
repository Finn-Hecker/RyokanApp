export type ModelType = 'claude' | 'gpt' | 'ollama' | 'openrouter';

export interface PromptBuilderOptions {
  charName: string;
  prompt?: string | null;
}

function replacePlaceholders(
  text: string,
  charName: string
): string {
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, 'User');
}

export function buildSystemPrompt({
  charName,
  prompt,
}: PromptBuilderOptions): string {
  const coreInstructions = `You are ${charName}.

You are speaking with the user. React to them as ${charName} naturally would throughout the entire conversation.

Stay fully in character.

If a message is prefixed with [OOC:], treat it as a director's instruction. Do NOT respond as ${charName}. Silently incorporate it into your next in-character response, then seamlessly return to character.`;

  const cardPrompt = prompt?.trim()
    ? replacePlaceholders(prompt.trim(), charName)
    : '';

  return cardPrompt
    ? `${coreInstructions}\n\n${cardPrompt}`
    : coreInstructions;
}

export function buildWorldInfoBlock(
  wiBefore:  string | null | undefined,
  wiAfter:   string | null | undefined,
  charName:  string,
  modelType: ModelType = 'ollama',
): string {
  const rp = (text: string) => replacePlaceholders(text, charName);
  const parts: string[] = [];

  if (wiBefore?.trim()) parts.push(formatSection('world_info_before', rp(wiBefore.trim()), modelType));
  if (wiAfter?.trim())  parts.push(formatSection('world_info_after',  rp(wiAfter.trim()),  modelType));

  if (parts.length === 0) return '';

return `[Roleplay context for the next reply only — not something the user said, do not treat it as dialogue]

${parts.join('\n\n')}`;
}

export function buildWiString(
  entries: Array<{ keys: string[]; content: string; enabled: boolean; position: string }>,
  position: 'before' | 'after',
  recentMessages: string,
): string {
  return entries
    .filter(e => e.enabled && e.position === position)
    .filter(e =>
      e.keys.length === 0 ||
      e.keys.some(k => recentMessages.toLowerCase().includes(k.toLowerCase()))
    )
    .map(e => e.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

function formatSection(label: string, content: string, modelType: ModelType): string {
  switch (modelType) {
    case 'claude':
      return `<${label}>\n${content}\n</${label}>`;

    case 'gpt':
      return `**${capitalize(label)}:**\n${content}`;

    case 'ollama':
    case 'openrouter':
    default:
      return `${capitalize(label)}\n${content}`;
  }
}

function capitalize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}