export type TextRuleScope = 'user' | 'assistant' | 'reasoning' | 'lorebook';
export type TextRuleTarget = 'display' | 'send';
export interface TextRule {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  flags: string;
  enabled: boolean;
  scopes: TextRuleScope[];
  targets: TextRuleTarget[];
}
export const TEXT_RULES_KEY = 'text_rules_v1';
export const TEXT_RULE_SCOPES: TextRuleScope[] = ['user', 'assistant', 'reasoning', 'lorebook'];
export const TEXT_RULE_TARGETS: TextRuleTarget[] = ['display', 'send'];

/** Use native ECMAScript replacement semantics, including captures and named groups. */
export function previewTextRule(text: string, rule: Pick<TextRule, 'pattern' | 'replacement' | 'flags'>) {
  try {
    const regex = new RegExp(rule.pattern, rule.flags);
    let matches = 0;
    text.replace(regex, match => { matches++; return match; });
    return { text: text.replace(new RegExp(rule.pattern, rule.flags), rule.replacement), matches, error: null };
  } catch (error) {
    return { text, matches: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export function applyTextRules(text: string, rules: readonly TextRule[], scope: TextRuleScope, target: TextRuleTarget): string {
  return rules.reduce((result, rule) => rule.enabled && rule.scopes.includes(scope) && rule.targets.includes(target)
    ? replaceSafely(result, rule) : result, text);
}

function replaceSafely(text: string, rule: TextRule): string {
  try { return text.replace(new RegExp(rule.pattern, rule.flags), rule.replacement); }
  catch { return text; }
}

/** Reasoning segments are never processed by ordinary AI-message rules. */
export function transformMessageText(text: string, rules: readonly TextRule[], scope: 'user' | 'assistant', target: TextRuleTarget): string {
  if (scope === 'user') return applyTextRules(text, rules, scope, target);
  const parts = text.split(/(<think>[\s\S]*?(?:<\/think>|$)|<\|channel>[\s\S]*?(?:<channel\|>|$))/gi);
  return parts.map((part, index) => applyTextRules(part, rules, index % 2 ? 'reasoning' : 'assistant', target)).join('');
}

/** Versioned settings payload; malformed records cannot break chat startup. */
export function parseTextRules(value: string | null | undefined): TextRule[] {
  try {
    const data = JSON.parse(value ?? 'null');
    if (data?.version !== 1 || !Array.isArray(data.rules)) return [];
    const ids = new Set<string>();
    return data.rules.filter((rule: TextRule) => {
      if (!rule || !['id', 'name', 'pattern', 'replacement', 'flags'].every(key => typeof (rule as unknown as Record<string, unknown>)[key] === 'string')
        || !rule.id || ids.has(rule.id) || typeof rule.enabled !== 'boolean'
        || !Array.isArray(rule.scopes) || !rule.scopes.every(scope => TEXT_RULE_SCOPES.includes(scope))
        || !Array.isArray(rule.targets) || !rule.targets.every(target => TEXT_RULE_TARGETS.includes(target))) return false;
      ids.add(rule.id);
      return true;
    });
  } catch { return []; }
}
export function serializeTextRules(rules: readonly TextRule[]): string {
  return JSON.stringify({ version: 1, rules });
}

export function snapshotTextRules(rules: readonly TextRule[] = []): TextRule[] {
  return rules.map(rule => ({ ...rule, scopes: [...rule.scopes], targets: [...rule.targets] }));
}

export const TEXT_RULE_TEMPLATES = [
  { id: 'name', pattern: '^Character:\\s*', replacement: '', flags: 'gm', scope: 'assistant', example: 'Character: Hello!' },
  { id: 'replace', pattern: 'old text', replacement: 'new text', flags: 'g', scope: 'assistant', example: 'Some old text.' },
  { id: 'remove', pattern: 'unwanted text', replacement: '', flags: 'g', scope: 'assistant', example: 'Hello unwanted text!' },
  { id: 'lines', pattern: '(?:\\r?\\n[\\t ]*){3,}', replacement: '\n\n', flags: 'g', scope: 'assistant', example: 'Hello\n\n\n\nWorld' },
] as const;
