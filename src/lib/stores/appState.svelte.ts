export interface ApiSettings {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  presencePenalty: number;
  topP: number;
  topK: number;
  minP: number;
  frequencyPenalty: number;
  contextLimit: number;
  thinkingBudget: number;
  customMode: boolean;
}

export type InteractionMode = 'desktop' | 'mobile';

export const appState = $state({
  currentView: 'lobby' as 'lobby' | 'chat' | 'create' | 'settings' | 'roleEditor' | 'worldInfoEditor' | 'list' | 'play' | 'multiplayerRoom',
  activeCharacter: null as any,
  editingCharacter: null as any,
  isOnboarding: false,
  pendingUiLocale: '',
  interactionMode: 'desktop' as InteractionMode,
  apiSettings: {
    url: "http://127.0.0.1:1234/v1",
    apiKey: "",
    model: "",
    systemPrompt: "",
    temperature: 0.8,
    thinkingBudget: 2500,
    maxTokens: 300,
    presencePenalty: 1.12,
    topP: 0.9,
    topK: 40,
    minP: 0.05,
    frequencyPenalty: 0,
    contextLimit: 4096,
    customMode: false,
  } as ApiSettings
});
