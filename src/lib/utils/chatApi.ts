import { invoke } from '@tauri-apps/api/core';
import { buildSystemPrompt } from '$lib/utils/promptBuilder';
import type { ApiSettings } from '$lib/stores/appState';
import type { Message } from '$lib/stores/chatStore';

export interface GenerationCallbacks {
  onStreamUpdate: (text: string) => void;
  onThinkingPhaseChange: (isThinking: boolean) => void;
}

export interface GenerationOptions {
  character: {
    name?: string;
    desc?: string;
    personality?: string;
    scenario?: string;
    mes_example?: string;
  } | null;
  apiSettings: ApiSettings;
  recentMessages: Message[];
  /** Include a new user prompt at the end (normal send). Omit for retry. */
  userPrompt?: string;
}

/** Pure function — strips thinking tags and returns the visible response text. */
export function processThinkingOutput(raw: string, isFinished: boolean): {
  text: string;
  isThinking: boolean;
} {
  const thinkEnd = '</think>';

  if (raw.includes(thinkEnd)) {
    const parts = raw.split(thinkEnd);
    return { text: parts[parts.length - 1].trimStart(), isThinking: false };
  }

  if (isFinished) {
    return { text: raw, isThinking: false };
  }

  return { text: '', isThinking: true };
}

/** Builds the messages array sent to the AI API. */
function buildApiMessages(
  options: GenerationOptions
): { role: string; content: string }[] {
  const { character, apiSettings, recentMessages, userPrompt } = options;

  const systemPrompt = buildSystemPrompt({
    charName: character?.name || 'Unknown',
    desc: character?.desc,
    personality: character?.personality,
    scenario: character?.scenario,
    example: character?.mes_example,
    lang: apiSettings.aiLanguage || 'English',
    userName: 'User',
    modelType: 'ollama',
  });

  const history = recentMessages
    .slice(-10)
    .map(msg => ({ role: msg.role, content: msg.content }));

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  if (userPrompt) {
    messages.push({ role: 'user', content: userPrompt });
  }

  return messages;
}

/**
 * Calls the AI API via Tauri invoke and returns the raw streamed text.
 * Streaming updates are forwarded via `callbacks` so the component can
 * update its reactive state in real-time.
 */
export async function runGeneration(
  options: GenerationOptions,
  callbacks: GenerationCallbacks
): Promise<string> {
  const { apiSettings } = options;
  const messages = buildApiMessages(options);

  console.log(messages);

  let rawBuffer = '';

  // Subscribe to streaming tokens before invoking
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<{ token: string }>('ai-token', (event) => {
    rawBuffer += event.payload.token;

    if (apiSettings.isThinkingModel) {
      const { text, isThinking } = processThinkingOutput(rawBuffer, false);
      callbacks.onThinkingPhaseChange(isThinking);
      callbacks.onStreamUpdate(text);
    } else {
      callbacks.onStreamUpdate(rawBuffer);
    }
  });

  try {
    await invoke('call_ai_api', {
      payload: {
        url: apiSettings.url,
        api_key: apiSettings.apiKey,
        model: apiSettings.model,
        messages,
        temperature: apiSettings.temperature,
      },
    });

    // Finalise thinking-model output
    if (apiSettings.isThinkingModel) {
      const { text } = processThinkingOutput(rawBuffer, true);
      callbacks.onThinkingPhaseChange(false);
      callbacks.onStreamUpdate(text);
      return text || rawBuffer;
    }

    callbacks.onStreamUpdate(rawBuffer);
    return rawBuffer;
  } finally {
    unlisten();
  }
}