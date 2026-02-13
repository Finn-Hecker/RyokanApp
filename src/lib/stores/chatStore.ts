import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { activeCharacter } from './appState';
import { CHARACTERS } from '$lib/data/characters';

export interface Message {
    id?: number;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
}

export interface Conversation {
    id: string;
    title: string;
    character_id: string;
    created_at: string;
}

export interface DisplayMessage {
    id: string;
    text: string;
    isUser: boolean;
    senderName: string;
}

export const conversations = writable<Conversation[]>([]);
export const currentMessages = writable<Message[]>([]);
export const activeChatId = writable<string | null>(null);


export async function loadAllConversations() {
    try {
        const result = await invoke<Conversation[]>('get_conversations');
        conversations.set(result);
    } catch (e) { console.error(e); }
}

export async function startNewChat(character: any) {
    try {
        const newId = await invoke<string>('create_chat', {
            characterId: character.id.toString(),
            characterName: character.name,
            initialMessage: character.greeting
        });
        await loadAllConversations();
        activeChatId.set(newId);
        await loadMessages(newId);
    } catch (e) { console.error(e); }
}

export async function openHistoryChat(chatId: string) {
    await loadMessages(chatId);

    const allChats = get(conversations);
    const currentChat = allChats.find(c => c.id === chatId);

    if (currentChat && currentChat.character_id) {
        const char = CHARACTERS.find(c => c.id.toString() === currentChat.character_id);
        if (char) {
            activeCharacter.set(char);
            console.log("Character synchronized:", char.name);
        }
    }
}

export async function loadConversations() {
    try {
        const result = await invoke<Conversation[]>('get_conversations');
        conversations.set(result);
    } catch (e) {
        console.error("Error loading chats:", e);
    }
}

export async function loadMessages(chatId: string) {
    try {
        const result = await invoke<Message[]>('get_messages', { chatId });
        currentMessages.set(result);
        activeChatId.set(chatId);
    } catch (e) { console.error(e); }
}

export async function addMessage(role: 'user' | 'assistant', content: string) {
    const chatId = get(activeChatId);
    if (!chatId) return;

    try {
        await invoke('add_message', { chatId, role, content });
        await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

export async function deleteConversation(id: string) {
    try {
        await invoke('delete_chat', { id });
        await loadAllConversations();
        if (get(activeChatId) === id) {
            activeChatId.set(null);
            currentMessages.set([]);
        }
    } catch (e) { console.error(e); }
}