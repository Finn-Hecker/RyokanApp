export interface PromptBuilderOptions {
  charName: string;
  prompt?: string | null;
  systemPrompt?: string;
  role?: { name: string; prompt: string } | null;
}

function replacePlaceholders(
  text: string,
  charName: string,
  userName = 'User'
): string {
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName);
}

export function buildSystemPrompt({
  charName,
  prompt,
  systemPrompt,
  role,
}: PromptBuilderOptions): string {
  const coreInstructions = `You are ${charName}.

You are speaking with the user. React to them as ${charName} naturally would throughout the entire conversation.

Stay fully in character.`;

  const cardPrompt = prompt?.trim()
    ? replacePlaceholders(prompt.trim(), charName)
    : '';

  // Plain preset instructions replace the default; character/role context remains intact.
  const sections = [systemPrompt?.trim() || coreInstructions];
  if (cardPrompt) sections.push(cardPrompt);
  if (role) {
    const rolePrompt = replacePlaceholders(role.prompt.trim(), charName, role.name);
    sections.push(`[Player Role: ${role.name}]${rolePrompt ? `\n${rolePrompt}` : ''}`);
  }
  return sections.join('\n\n');
}

export function buildWorldInfoBlock(
  wiBefore:  string | null | undefined,
  wiAfter:   string | null | undefined,
  charName:  string,
): string {
  const rp = (text: string) => replacePlaceholders(text, charName);
  const parts: string[] = [];

  if (wiBefore?.trim()) parts.push(formatSection('world_info_before', rp(wiBefore.trim())));
  if (wiAfter?.trim())  parts.push(formatSection('world_info_after',  rp(wiAfter.trim())));

  if (parts.length === 0) return '';

return `[Roleplay context for the next reply only — not something the user said, do not treat it as dialogue]

${parts.join('\n\n')}`;
}

export function buildWiString(
  entries: Array<{
    keys: string[];
    content: string;
    enabled: boolean;
    position: string;
    constant?: boolean;
    case_sensitive?: boolean;
    use_regex?: boolean;
    selective?: boolean;
    secondary_keys?: string[];
  }>,
  position: 'before' | 'after',
  recentMessages: string,
  transformContent: (content: string) => string = content => content,
): string {
  const normalizedContext = recentMessages.normalize('NFC');
  const matches = (key: string, caseSensitive = false, useRegex = false): boolean => {
    const normalizedKey = key.normalize('NFC');
    if (useRegex) {
      try {
        return new RegExp(normalizedKey, caseSensitive ? 'u' : 'iu').test(normalizedContext);
      } catch {
        return false;
      }
    }
    return caseSensitive
      ? normalizedContext.includes(normalizedKey)
      : normalizedContext.toLowerCase().includes(normalizedKey.toLowerCase());
  };

  return entries
    .filter(e => e.enabled && e.position === position)
    .filter(e => {
      // Empty-key Ryokan entries have historically been constant. An explicit
      // CCv3 `constant: false`, however, must remain inactive without a key.
      if ((!e.use_regex && e.constant === true) ||
          (e.keys.length === 0 && e.constant === undefined)) return true;
      const primaryMatch = e.keys.some(key => matches(key, e.case_sensitive, e.use_regex));
      if (!primaryMatch) return false;
      if (!e.selective || e.use_regex) return true;
      return (e.secondary_keys ?? []).some(key => matches(key, e.case_sensitive, false));
    })
    .map(e => transformContent(e.content).trim())
    .filter(Boolean)
    .join('\n\n');
}

function formatSection(label: string, content: string): string {
  return `${capitalize(label)}\n${content}`;
}

function capitalize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
