export type ModelType = 'claude' | 'gpt' | 'ollama' | 'openrouter';

export interface PromptBuilderOptions {
  charName:      string;
  desc?:         string | null;
  personality?:  string | null;
  scenario?:     string | null;
  example?:      string | null;
  lang:          string;
  userName?:     string;
  userBio?:      string | null;
  userPronouns?: string | null;
  modelType?:    ModelType;
  wiBefore?:     string | null;
  wiAfter?:      string | null;
}

function replacePlaceholders(text: string, charName: string, userName: string): string {
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName);
}

export function buildSystemPrompt({
  charName,
  desc,
  personality,
  scenario,
  example,
  lang,
  userName = 'User',
  userBio,
  userPronouns,
  modelType = 'ollama',
  wiBefore,
  wiAfter,
}: PromptBuilderOptions): string {

  const rp = (text: string) => replacePlaceholders(text, charName, userName);

  const userIdentityParts = [
    userName && userName !== 'User' ? userName : null,
    userPronouns ? `(${userPronouns})` : null,
  ].filter(Boolean);
  const userIdentityLine = userIdentityParts.length > 0
    ? userIdentityParts.join(' ')
    : userName;

  let prompt = '';

  if (wiBefore?.trim()) {
    prompt += formatSection('world_info_before', rp(wiBefore.trim()), modelType) + '\n\n';
  }

  prompt += `You are ${charName}. Reply in ${lang}.
You are speaking with ${userIdentityLine}. React to them as ${charName} naturally would throughout the entire conversation.
Stay fully in character. The user has an active role — you must perceive and react to it consistently.
If a message is prefixed with [OOC:], treat it as a director's instruction. Do NOT respond as ${charName}. Silently incorporate it into your next in-character response, then seamlessly return to character.`;

  const sections: Array<{ label: string; content: string }> = [];
  if (desc?.trim())        sections.push({ label: 'description',    content: rp(desc.trim()) });
  if (personality?.trim()) sections.push({ label: 'personality',    content: rp(personality.trim()) });
  if (scenario?.trim())    sections.push({ label: 'scenario',       content: rp(scenario.trim()) });
  if (example?.trim())     sections.push({ label: 'example_dialog', content: rp(example.trim()) });

  for (const s of sections) {
    prompt += '\n\n' + formatSection(s.label, s.content, modelType);
  }

  if (wiAfter?.trim()) {
    prompt += '\n\n' + formatSection('world_info_after', rp(wiAfter.trim()), modelType);
  }

  if (userBio?.trim()) {
    const bioContent = rp(userBio.trim())
      + `\n\nOnly address them by name in-character if it has been introduced in the roleplay.`;
    prompt += '\n\n' + formatSection('user_role', bioContent, modelType);
  }

  return prompt;
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