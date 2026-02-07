import { writable } from 'svelte/store';

export const currentView = writable<'lobby' | 'chat'>('lobby');

export const activeCharacter = writable<any>(null);

export const apiSettings = writable({
  url: "http://127.0.0.1:1234/v1",
  apiKey: ""
});