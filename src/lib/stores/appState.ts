import { writable } from 'svelte/store';

export const currentView = writable<'lobby' | 'chat' | 'create'>('lobby');

export const activeCharacter = writable<any>(null);

export interface ApiSettings {
  url: string;
  apiKey: string;
  model: string;
  isThinkingModel: boolean;
  aiLanguage: string;
  systemPrompt: string;
}

export const apiSettings = writable<ApiSettings>({
  url: "http://127.0.0.1:1234/v1",
  apiKey: "",
  model: "",
  isThinkingModel: false,
  aiLanguage: "German", 
  systemPrompt: ""
});