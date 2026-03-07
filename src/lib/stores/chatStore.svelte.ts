import { invoke } from '@tauri-apps/api/core';
import { appState } from './appState.svelte';
import { characterState } from './characterStore.svelte';
import { roleState } from './roleStore.svelte';
import { getLocale } from '$lib/paraglide/runtime';

export interface Message {
    id?: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
}

export interface Conversation {
    id: string;
    title: string;
    character_id: string;
    created_at: string;
    updated_at: string;
    formattedDate?: string;
}

export interface DisplayMessage {
    id: string;
    text: string;
    isUser: boolean;
    senderName: string;
}

// Group all reactive state into a single object
export const chatState = $state({
    conversations: [] as Conversation[],
    currentMessages: [] as Message[],
    activeChatId: null as string | null
});

const dateFormatter = new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
});

const PAGE_SIZE = 15;

/** Call when the sidebar opens. */
export async function loadAllConversations() {
    try {
        const result = await invoke<Conversation[]>('get_conversations_page', {
            limit: PAGE_SIZE,
            offset: 0,
        });

        const enhanced = result.map(chat => ({
            ...chat,
            formattedDate: dateFormatter.format(new Date(chat.created_at))
        }));

        chatState.conversations = enhanced;

    } catch (e) {
        console.error(e);
    }
}

/** * Appends the next page to the existing list.
 * Returns false when there are no more results to load. 
 */
export async function loadMoreConversations(): Promise<boolean> {
    try {
        const currentLength = chatState.conversations.length;
        const result = await invoke<Conversation[]>('get_conversations_page', {
            limit: PAGE_SIZE,
            offset: currentLength,
        });
        
        if (result.length === 0) return false;

        const enhanced = result.map(chat => ({
            ...chat,
            formattedDate: dateFormatter.format(new Date(chat.created_at))
        }));

        chatState.conversations = [...chatState.conversations, ...enhanced];
        return result.length === PAGE_SIZE;
    } catch (e) {
        console.error(e);
        return false;
    }
}

export async function startNewChat(character: any) {
    try {
        let allGreetings = [];

        if (character.greeting && character.greeting.trim().length > 0) {
            allGreetings.push(character.greeting);
        }

        if (character.alternate_greetings) {
            try {
                const altGreetings = typeof character.alternate_greetings === 'string' 
                    ? JSON.parse(character.alternate_greetings) 
                    : character.alternate_greetings;
                if (Array.isArray(altGreetings)) {
                    const validAlts = altGreetings.filter(g => 
                        typeof g === 'string' && g.trim().length > 0
                    );
                    allGreetings.push(...validAlts);
                }
            } catch (e) {
                console.warn("Could not parse alternative greetings:", e);
            }
        }

        const rawGreeting = allGreetings.length > 0
            ? allGreetings[Math.floor(Math.random() * allGreetings.length)]
            : null;

        const activeRole = roleState.allRoles.find(r => r.id === roleState.activeRoleId);
        
        const userName: string = activeRole?.name ?? (character as any).userName ?? 'User';
        const selectedGreeting = rawGreeting
            ? rawGreeting
                .replace(/\{\{char\}\}/gi, character.name)
                .replace(/\{\{user\}\}/gi, userName)
            : null;

        const newId = await invoke<string>('create_chat', {
            characterId: character.id.toString(),
            characterName: character.name,
            initialMessage: selectedGreeting
        });
        
        await loadAllConversations();
        chatState.activeChatId = newId;
        await loadMessages(newId);
    } catch (e) { console.error(e); }
}

export async function openHistoryChat(chatId: string) {
    await loadMessages(chatId);

    const currentChat = chatState.conversations.find(c => c.id === chatId);

    if (currentChat && currentChat.character_id) {
        const chars = characterState.allCharacters; 
        const char = chars.find(c => c.id.toString() === currentChat.character_id);
        
        if (char) {
            appState.activeCharacter = char;
            console.log("Character synchronized:", char.name);
        } else {
            console.warn("Could not find a character for this chat.");
        }
    }
}

export async function loadMessages(chatId: string) {
    try {
        const result = await invoke<Message[]>('get_messages', { chatId });
        chatState.currentMessages = result;
        chatState.activeChatId = chatId;
    } catch (e) { console.error(e); }
}

export async function addMessage(role: 'user' | 'assistant', content: string) {
    const chatId = chatState.activeChatId;
    if (!chatId) return;

    try {
        await invoke('add_message', { chatId, role, content });
        // Reload conversations so the sidebar re-sorts by updated_at
        await loadAllConversations();
        await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

// Updates the content of an existing message in the database.
export async function updateMessage(id: string, content: string) {
    const chatId = chatState.activeChatId;
    try {
        await invoke('update_message', { id, content });
        if (chatId) await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

// Deletes a single message by ID, then reloads the message list.
export async function deleteMessage(id: string) {
    const chatId = chatState.activeChatId;
    try {
        await invoke('delete_message', { id });
        if (chatId) await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

export async function deleteConversation(id: string) {
    try {
        await invoke('delete_chat', { id });
        await loadAllConversations();
        if (chatState.activeChatId === id) {
            chatState.activeChatId = null;
            chatState.currentMessages = [];
        }
    } catch (e) { console.error(e); }
}