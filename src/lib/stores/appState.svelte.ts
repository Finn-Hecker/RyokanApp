export interface ApiSettings {
  url: string;
  apiKey: string;
  model: string;
  isThinkingModel: boolean;
  aiLanguage: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  presencePenalty: number;
  contextLimit: number;
}

export const appState = $state({
  currentView: 'lobby' as 'lobby' | 'chat' | 'create' | 'settings' | 'roleEditor' | 'worldInfoEditor' | 'list',
  listInitialTab: 'roles' as 'roles' | 'worldinfo',
  activeCharacter: null as any,
  editingCharacter: null as any,
  isOnboarding: false,
  pendingUiLocale: '',
  apiSettings: {
    url: "http://127.0.0.1:1234/v1",
    apiKey: "",
    model: "",
    isThinkingModel: false,
    aiLanguage: "German",
    systemPrompt: "",
    temperature: 0.8,
    maxTokens: 300,
    presencePenalty: 1.12,
    contextLimit: 4096,
  } as ApiSettings
});