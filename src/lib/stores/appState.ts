import { writable } from 'svelte/store';

export const currentView = writable<'lobby' | 'chat' | 'create' | 'settings'>('lobby');

export const activeCharacter = writable<any>(null);

export const editingCharacter = writable<any>(null);

export const isOnboarding = writable<boolean>(false);

export const pendingUiLocale = writable<string>('');

export interface ApiSettings {
  url: string;
  apiKey: string;
  model: string;
  isThinkingModel: boolean;
  aiLanguage: string;
  systemPrompt: string;
  temperature: number;
}

export const apiSettings = writable<ApiSettings>({
  url: "http://127.0.0.1:1234/v1",
  apiKey: "",
  model: "",
  isThinkingModel: false,
  aiLanguage: "German", 
  systemPrompt: "",
  temperature: 0.8
});