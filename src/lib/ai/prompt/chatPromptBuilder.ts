import { buildSystemPrompt, buildWiString, buildWorldInfoBlock } from './promptBuilder.ts';
import { applyTextRules, transformMessageText, type TextRule } from './textRules.ts';
import { stripThinkingContent } from '../generation/thinkingOutput.ts';

export interface PromptMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface PromptWorldInfoEntry {
  id?: string;
  keys: string[];
  content: string;
  enabled: boolean;
  position: string;
  constant?: boolean;
  case_sensitive?: boolean;
  use_regex?: boolean;
  selective?: boolean;
  secondary_keys?: string[];
}

export interface PromptWorldInfo {
  id: string;
  entries: PromptWorldInfoEntry[];
}

export interface PromptBuildOptions {
  systemPrompt?: string;
  postHistoryPrompt?: string;
  textRules?: readonly TextRule[];
  character: {
    name?: string;
    prompt?: string;
    world_info_ids?: string[];
  } | null;
  role?: { name: string; prompt: string } | null;
  recentMessages: PromptMessage[];
  userPrompt?: string;
  summaryMeta?: {
    currentSummary: string | null;
    lastSummarizedMessageId: string | null;
  };
  worldInfos: PromptWorldInfo[];
}

export interface ChatPromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const START_ROLEPLAY_MARKER = '[Start Roleplay]';

/** Fixed prompt and currently activated lore, without summary or dialogue. */
export function buildPromptReferenceContext(options: PromptBuildOptions): { baseSystemPrompt: string; worldInfoBlock: string } {
  const rules = options.textRules ?? [];
  const sendText = (message: PromptMessage) => {
    const transformed = transformMessageText(message.content, rules, message.role, 'send');
    return message.role === 'assistant' ? stripThinkingContent(transformed) : transformed;
  };
  const worldInfoById = new Map(options.worldInfos.map(worldInfo => [worldInfo.id, worldInfo]));
  const selectedIds = [...new Set(options.character?.world_info_ids ?? [])];
  const relevantEntries = selectedIds
    .flatMap(id => worldInfoById.get(id)?.entries ?? []);
  const recentContext = [
    options.summaryMeta?.currentSummary ?? '',
    ...options.recentMessages.slice(-10).map(sendText),
    applyTextRules(options.userPrompt ?? '', rules, 'user', 'send'),
  ].join(' ');

  const charName = options.character?.name || 'Unknown';
  const baseSystemPrompt = buildSystemPrompt({
    systemPrompt: options.systemPrompt,
    charName,
    prompt: options.character?.prompt,
    role: options.role,
  });

  const worldInfoBlock = buildWorldInfoBlock(
    buildWiString(relevantEntries, 'before', recentContext, content => applyTextRules(content, rules, 'lorebook', 'send')),
    buildWiString(relevantEntries, 'after', recentContext, content => applyTextRules(content, rules, 'lorebook', 'send')),
    charName,
  );
  return { baseSystemPrompt, worldInfoBlock };
}

/**
 * Builds the exact message array sent to the model. Runtime state is resolved by
 * chatApi before calling this function so this production path remains directly
 * regression-testable without a Tauri or Svelte runtime.
 */
export function buildPromptMessages(options: PromptBuildOptions): ChatPromptMessage[] {
  const { recentMessages, userPrompt } = options;
  const rules = options.textRules ?? [];
  const sendText = (message: PromptMessage) => {
    const transformed = transformMessageText(message.content, rules, message.role, 'send');
    return message.role === 'assistant' ? stripThinkingContent(transformed) : transformed;
  };
  const { baseSystemPrompt, worldInfoBlock } = buildPromptReferenceContext(options);

  const { currentSummary = null, lastSummarizedMessageId = null } = options.summaryMeta ?? {};
  const fullSystemContent = currentSummary
    ? `${baseSystemPrompt}\n\n[Previous conversation summary:\n${currentSummary}]`
    : baseSystemPrompt;
  const lastSummaryIndex = lastSummarizedMessageId
    ? recentMessages.findIndex(message => message.id === lastSummarizedMessageId)
    : -1;
  const newMessages = recentMessages.slice(lastSummaryIndex + 1);

  const messages: ChatPromptMessage[] = [{ role: 'system', content: fullSystemContent }];
  messages.push(...newMessages.map(message => ({
    role: message.role,
    content: sendText(message),
  })));

  if (userPrompt) messages.push({ role: 'user', content: applyTextRules(userPrompt, rules, 'user', 'send') });

  const firstNonSystem = messages.find(message => message.role !== 'system');
  if (firstNonSystem?.role === 'assistant') {
    const systemIndex = messages.findLastIndex(message => message.role === 'system');
    messages.splice(systemIndex + 1, 0, { role: 'user', content: START_ROLEPLAY_MARKER });
  }

  if (worldInfoBlock) {
    const lastUserIndex = messages.findLastIndex(message => message.role === 'user');
    if (lastUserIndex !== -1) {
      messages[lastUserIndex] = {
        ...messages[lastUserIndex],
        content: `${worldInfoBlock}\n\n${messages[lastUserIndex].content}`,
      };
    } else {
      messages.push({ role: 'user', content: worldInfoBlock });
    }
  }

  // Native APIs and compatible gateways/templates may hoist system messages.
  // Keep this instruction in conversation order on every provider path, merging
  // into a final user turn when possible to retain alternating roles.
  if (options.postHistoryPrompt?.trim()) {
    const instruction = `[Post-history instruction]\n${options.postHistoryPrompt.trim()}`;
    const last = messages.at(-1);
    if (last?.role === 'user') messages[messages.length - 1] = { ...last, content: `${last.content}\n\n${instruction}` };
    else messages.push({ role: 'user', content: instruction });
  }
  return messages;
}
