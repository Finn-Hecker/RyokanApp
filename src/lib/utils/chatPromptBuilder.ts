import { buildSystemPrompt, buildWiString, buildWorldInfoBlock } from './promptBuilder.ts';
import { stripThinkingContent } from './thinkingOutput.ts';

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

/**
 * Builds the exact message array sent to the model. Runtime state is resolved by
 * chatApi before calling this function so this production path remains directly
 * regression-testable without a Tauri or Svelte runtime.
 */
export function buildPromptMessages(options: PromptBuildOptions): ChatPromptMessage[] {
  const { character, recentMessages, userPrompt } = options;
  const worldInfoById = new Map(options.worldInfos.map(worldInfo => [worldInfo.id, worldInfo]));
  const selectedIds = [...new Set(character?.world_info_ids ?? [])];
  const relevantEntries = selectedIds
    .flatMap(id => worldInfoById.get(id)?.entries ?? []);
  const recentContext = [
    options.summaryMeta?.currentSummary ?? '',
    ...recentMessages.slice(-10).map(message =>
      message.role === 'assistant' ? stripThinkingContent(message.content) : message.content
    ),
    userPrompt ?? '',
  ].join(' ');

  const charName = character?.name || 'Unknown';
  const baseSystemPrompt = buildSystemPrompt({
    charName,
    prompt: character?.prompt,
    role: options.role,
  });

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
    content: message.role === 'assistant'
      ? stripThinkingContent(message.content)
      : message.content,
  })));

  if (userPrompt) messages.push({ role: 'user', content: userPrompt });

  const firstNonSystem = messages.find(message => message.role !== 'system');
  if (firstNonSystem?.role === 'assistant') {
    const systemIndex = messages.findLastIndex(message => message.role === 'system');
    messages.splice(systemIndex + 1, 0, { role: 'user', content: START_ROLEPLAY_MARKER });
  }

  const worldInfoBlock = buildWorldInfoBlock(
    buildWiString(relevantEntries, 'before', recentContext),
    buildWiString(relevantEntries, 'after', recentContext),
    charName,
    'ollama',
  );

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

  return messages;
}
