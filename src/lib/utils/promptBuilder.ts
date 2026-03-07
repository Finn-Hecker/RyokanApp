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

  let prompt = '';
  if (wiBefore?.trim()) {
    prompt += formatSection('world_info_before', rp(wiBefore.trim()), modelType) + '\n\n';
  }

  prompt += `You are ${charName}. Reply in ${lang}.
Stay fully in character. The user has an active role — you must perceive and react to it consistently throughout the entire conversation.
If a message is prefixed with [OOC:], this is a director's instruction — a meta-command to shape the story. Do NOT respond to it as ${charName}. Instead, silently incorporate the instruction into your next in-character response as if it naturally happened in the scene. Step outside the roleplay briefly to address it naturally, then seamlessly return to character in your next response.`;

  const sections = [];
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

  const roleParts: string[] = [];
  if (userName && userName !== 'User') roleParts.push(`Name: ${userName}`);
  if (userPronouns) roleParts.push(`Pronouns: ${userPronouns}`);
  if (userBio?.trim()) roleParts.push(`Bio: ${rp(userBio.trim())}`);

  if (roleParts.length > 0) {
    const roleContent = roleParts.join('\n')
      + `\n\nThis is an active part of the scene. React to this person as ${charName} naturally would.`
      + ` Their name is meta — only use it in-character if it has been introduced in roleplay.`;
    prompt += '\n\n' + formatSection('user_role', roleContent, modelType);
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