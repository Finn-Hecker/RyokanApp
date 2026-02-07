import { writable, get } from 'svelte/store';
import Database from '@tauri-apps/plugin-sql';

export interface Message {
    id?: number;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
}

export interface Conversation {
    id: string;
    title: string;
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

let db: Database | null = null;

export async function initDb() {
    if (db) return db;
    db = await Database.load("sqlite:ryokan.db");
    return db;
}

export async function loadAllConversations() {
    const instance = await initDb();
    const result = await instance.select<Conversation[]>(
        "SELECT * FROM conversations ORDER BY created_at DESC"
    );
    conversations.set(result);
}

export async function startNewChat(character: any) {
    const instance = await initDb();
    const newId = crypto.randomUUID();
    const charId = character.id.toString();
    
    const dateStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const title = `Chat mit ${character.name}`;

    await instance.execute(
        "INSERT INTO conversations (id, title, character_id) VALUES ($1, $2, $3)",
        [newId, title, charId]
    );

    await loadAllConversations();
    activeChatId.set(newId);
    currentMessages.set([]);
}

export async function openHistoryChat(chatId: string) {
    await loadMessages(chatId);
}

export async function loadConversations() {
    const instance = await initDb();
    const result = await instance.select<Conversation[]>("SELECT * FROM conversations ORDER BY created_at DESC");
    conversations.set(result);
}

export async function loadMessages(chatId: string) {
    const instance = await initDb();
    const result = await instance.select<Message[]>(
        "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
        [chatId]
    );
    currentMessages.set(result);
    activeChatId.set(chatId);
}

export async function addMessage(role: 'user' | 'assistant', content: string) {
    const chatId = get(activeChatId);
    if (!chatId) {
        console.error("Kein aktiver Chat ausgewählt!");
        return;
    }

    const instance = await initDb();
    await instance.execute(
        "INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)",
        [chatId, role, content]
    );
    
    await loadMessages(chatId);
}

export async function selectChatForCharacter(character: any) {
    const instance = await initDb();
    const charId = character.id.toString();

    const existingChats = await instance.select<Conversation[]>(
        "SELECT * FROM conversations WHERE character_id = $1 ORDER BY created_at DESC LIMIT 1",
        [charId]
    );

    if (existingChats.length > 0) {
        const oldChat = existingChats[0];
        console.log("Alten Chat gefunden:", oldChat.id);
        await loadMessages(oldChat.id);
    } else {
        console.log("Erstelle neuen Chat für", character.name);
        const newId = crypto.randomUUID();
        
        await instance.execute(
            "INSERT INTO conversations (id, title, character_id) VALUES ($1, $2, $3)",
            [newId, `Chat mit ${character.name}`, charId]
        );

        activeChatId.set(newId);
        currentMessages.set([]);
    }
}

export async function createNewConversation(characterName: string) {
    const instance = await initDb();
    const newId = crypto.randomUUID(); 
    
    await instance.execute(
        "INSERT INTO conversations (id, title) VALUES ($1, $2)",
        [newId, `Chat mit ${characterName}`]
    );
    
    activeChatId.set(newId);
    currentMessages.set([]);
    
    return newId;
}