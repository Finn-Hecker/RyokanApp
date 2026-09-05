/**
 * Multiplayer client for the zero knowledge relay server.
 *
 * Two secrets, kept strictly apart:
 *  - Room key (`#k=` in the URL fragment): AES-GCM key that never leaves
 *    the client. Everything content related is encrypted with it, the
 *    server only relays opaque bytes.
 *  - Host token (`&h=` in the fragment of the host link): authorization
 *    secret the client deliberately sends over the WebSocket so the server
 *    can verify the host role. It also sits in the fragment (so it never
 *    ends up in the static server's HTTP logs), but unlike the key it is
 *    actively transmitted.
 *
 * The host is also the only LLM executor. It streams the reply from its
 * local endpoint, encrypts every delta on the client, and feeds it into the
 * relay as a normal opaque frame. The server never sees LLM content in
 * plaintext either.
 */

import { appState } from './appState.svelte';
import { invoke } from '@tauri-apps/api/core';
import { processThinkingOutput } from '$lib/utils/chatApi';
import { selectInitialGreeting } from '$lib/utils/characterGreeting';
import type { Character } from './characterStore.svelte';

// Configuration

export const RELAY_URL: string =
  (import.meta as any).env?.VITE_RELAY_URL ?? 'http://127.0.0.1:8787';
const RELAY_WS = RELAY_URL.replace(/^http/, 'ws');

const SNAPSHOT_DEBOUNCE_MS = 1200; // batch joins so snapshots don't spam
const LLM_FLUSH_MS = 150; // batch token deltas instead of one frame per token

// Types and reactive state

export type MpRole = 'host' | 'guest';
export type ClosedReason =
  | ''
  | 'host_left'
  | 'expired'
  | 'not_found'
  | 'bad_token'
  | 'host_taken'
  | 'idle'
  | 'slow'
  | 'error'
  | 'left';

export interface MpMessage {
  id: string;
  kind: 'chat' | 'llm' | 'system';
  author: string;
  text: string;
  ts: number;
  /** true while an LLM stream is still writing into this message */
  streaming?: boolean;
}

export interface SessionCharacter {
  name: string;
  prompt: string;
  greeting: string;
  initials: string;
  color: string;
  avatarUrl?: string;
}

interface PendingJoin {
  mode: 'create' | 'join' | 'resume';
  roomId?: string;
  keyB64?: string;
  hostToken?: string;
}

export const mpState = $state({
  connected: false,
  connecting: false,
  roomId: '',
  role: 'guest' as MpRole,
  selfId: 0,
  count: 0,
  lockedBy: null as number | null,
  everyoneCanGenerate: false,
  generating: false, // true only on the host while it runs the LLM call
  messages: [] as MpMessage[],
  displayName: '',
  characterName: '',
  /** Host-authoritative character data for this room; transient on guests. */
  sessionCharacter: null as SessionCharacter | null,
  /** Stable local conversation id. Deliberately unrelated to roomId. */
  conversationId: null as string | null,
  /** Read-only rendering of a saved session after the relay room is gone. */
  viewingHistory: false,
  /** Set right after room creation, used to display the links */
  shareLink: '',
  hostLink: '',
  showLinks: false,
  closedReason: '' as ClosedReason,
  error: '' as '' | 'invalid_link' | 'missing_key' | 'create_failed',
  pending: null as PendingJoin | null,
});

// Non reactive module state (secrets and handles do not belong in $state)

let ws: WebSocket | null = null;
let cryptoKey: CryptoKey | null = null;
let keyB64 = '';
let hostToken: string | null = null;
const seenIds = new Set<string>();
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let llmAbort: AbortController | null = null;
let sessionPromise: Promise<string> | null = null;
let shouldInsertInitialGreeting = false;

// Crypto (WebCrypto, AES-256-GCM, payload = base64url(iv || ciphertext))

const b64u = {
  encode(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Uint8Array {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

async function generateKey(): Promise<void> {
  cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  keyB64 = b64u.encode(await crypto.subtle.exportKey('raw', cryptoKey));
}

async function importKey(b64: string): Promise<void> {
  const decoded = b64u.decode(b64);
  const keyBytes = new Uint8Array(decoded);

  cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );

  keyB64 = b64;
}

async function encryptJson(obj: unknown): Promise<string> {
  if (!cryptoKey) throw new Error('no room key');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain);
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.length);
  return b64u.encode(out);
}

async function decryptJson(p: string): Promise<any | null> {
  if (!cryptoKey) return null;
  try {
    const raw = b64u.decode(p);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      cryptoKey,
      raw.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null; // wrong key or broken frame, drop it silently
  }
}

// Entry points: create, join, deep link

/** "Create room" from the play page: name gate first, then createRoom(). */
export function prepareCreate(character: Character): void {
  resetRoomState();
  shouldInsertInitialGreeting = true;
  appState.activeCharacter = character;
  mpState.characterName = character.name;
  mpState.pending = { mode: 'create' };
  appState.currentView = 'multiplayerRoom';
}

/**
 * Play page input field: accepts a full share or host link.
 * A bare code is not enough, without `#k=` nothing can be decrypted.
 */
export function prepareJoin(input: string): boolean {
  const parsed = parseLink(input.trim());
  if (!parsed) {
    mpState.error = looksLikeBareCode(input) ? 'missing_key' : 'invalid_link';
    return false;
  }
  resetRoomState();
  appState.activeCharacter = null;
  mpState.pending = { mode: 'join', ...parsed };
  appState.currentView = 'multiplayerRoom';
  return true;
}

/**
 * Call once on app start (e.g. from the root layout). Opens a room shared
 * via link and immediately strips the code and key from the address bar.
 */
export function checkJoinLink(): void {
  if (typeof window === 'undefined') return;
  const parsed = parseLink(window.location.href);
  if (!parsed) return;
  history.replaceState(null, '', window.location.pathname);
  resetRoomState();
  appState.activeCharacter = null;
  mpState.pending = { mode: 'join', ...parsed };
  appState.currentView = 'multiplayerRoom';
}

function parseLink(input: string): Omit<PendingJoin, 'mode'> | null {
  let roomId = '';
  let key = '';
  let host = '';
  try {
    const url = new URL(input, window.location.origin);
    roomId = url.searchParams.get('mp') ?? '';
    const frag = new URLSearchParams(url.hash.replace(/^#/, ''));
    key = frag.get('k') ?? '';
    host = frag.get('h') ?? '';
  } catch {
    return null;
  }
  if (!roomId || !key) return null;
  return { roomId: roomId.toUpperCase(), keyB64: key, hostToken: host || undefined };
}

function looksLikeBareCode(input: string): boolean {
  return /^[A-Za-z0-9]{4,8}$/.test(input.trim());
}

/** Called by the room page's name gate once the display name is set. */
export async function enterRoom(displayName: string): Promise<void> {
  const pending = mpState.pending;
  if (!pending || mpState.connecting || mpState.connected) return;
  mpState.displayName = displayName.trim();
  mpState.connecting = true;
  try {
    if (pending.mode === 'create' || pending.mode === 'resume') {
      await createRoom();
    } else {
      await importKey(pending.keyB64!);
      hostToken = pending.hostToken ?? null;
      connect(pending.roomId!);
    }
  } catch {
    mpState.connecting = false;
    mpState.error = 'create_failed';
  }
}

interface PersistedMpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  author: string | null;
  created_at: string;
}

/** Opens a saved multiplayer session without attempting to revive its relay room. */
export async function openPersistentSession(
  conversationId: string,
  character: Character | null,
): Promise<void> {
  resetRoomState();
  mpState.conversationId = conversationId;
  mpState.characterName = character?.name ?? 'AI';
  if (character) mpState.sessionCharacter = sessionCharacterFrom(character);
  mpState.viewingHistory = true;

  const rows = await invoke<PersistedMpMessage[]>('get_messages', { chatId: conversationId });
  mpState.messages = rows.map((row) => ({
    id: row.id,
    kind: row.role === 'assistant' ? 'llm' : 'chat',
    author: row.author || (row.role === 'assistant' ? mpState.characterName : '?'),
    text: row.content,
    ts: Date.parse(row.created_at) || 0,
  }));
  for (const message of mpState.messages) seenIds.add(message.id);
}

/**
 * Turns a saved, read-only session back into a hosted session. Only the
 * persistent conversation and its messages survive this transition; the
 * room, credentials and encryption key are always created from scratch.
 */
export function prepareResume(): void {
  if (!mpState.viewingHistory || !mpState.conversationId || !mpState.sessionCharacter) return;

  ws?.close(1000);
  ws = null;
  stopGeneration();
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = null;
  cryptoKey = null;
  keyB64 = '';
  hostToken = null;

  Object.assign(mpState, {
    connected: false,
    connecting: false,
    roomId: '',
    role: 'host',
    selfId: 0,
    count: 0,
    lockedBy: null,
    everyoneCanGenerate: false,
    generating: false,
    viewingHistory: false,
    shareLink: '',
    hostLink: '',
    showLinks: false,
    closedReason: '',
    error: '',
    pending: { mode: 'resume' } satisfies PendingJoin,
  });
}

async function ensurePersistentSession(): Promise<string> {
  if (mpState.conversationId) return mpState.conversationId;
  if (sessionPromise) return sessionPromise;

  const character = mpState.role === 'host' ? appState.activeCharacter : null;
  const characterName = character?.name || mpState.characterName || 'Multiplayer';
  sessionPromise = invoke<string>('create_chat', {
    characterId: character?.id != null ? String(character.id) : null,
    characterName,
    initialMessage: null,
    mode: 'multiplayer',
  }).then((id) => {
    mpState.conversationId = id;
    return id;
  }).finally(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

function sessionCharacterFrom(character: Character, avatarUrl = character.avatarUrl): SessionCharacter {
  return {
    name: character.name,
    prompt: character.prompt,
    greeting: character.greeting || '',
    initials: character.initials || character.name.slice(0, 1).toUpperCase(),
    color: character.color || 'bg-stone-700',
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

async function inlineAvatar(url: string): Promise<string | undefined> {
  if (url.startsWith('data:image/')) return url;
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

async function prepareHostSessionCharacter(): Promise<void> {
  const character = appState.activeCharacter as Character | null;
  if (!character) throw new Error('missing multiplayer character');

  let avatarUrl = character.avatarUrl;
  if (!avatarUrl && character.isCustom && character.has_avatar) {
    avatarUrl = await invoke<string | null>('get_character_avatar', {
      id: String(character.id),
    }) ?? undefined;
  }
  if (avatarUrl) avatarUrl = await inlineAvatar(avatarUrl);

  mpState.sessionCharacter = sessionCharacterFrom(character, avatarUrl);
  mpState.characterName = character.name;
}

function applySessionCharacter(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const candidate = raw as Partial<SessionCharacter>;
  if (typeof candidate.name !== 'string' || typeof candidate.prompt !== 'string') return;

  const avatarUrl = typeof candidate.avatarUrl === 'string'
    && (candidate.avatarUrl.startsWith('data:image/') || candidate.avatarUrl.startsWith('/'))
      ? candidate.avatarUrl
      : undefined;
  const character: SessionCharacter = {
    name: candidate.name,
    prompt: candidate.prompt,
    greeting: typeof candidate.greeting === 'string' ? candidate.greeting : '',
    initials: typeof candidate.initials === 'string' && candidate.initials
      ? candidate.initials
      : candidate.name.slice(0, 1).toUpperCase(),
    color: typeof candidate.color === 'string' ? candidate.color : 'bg-stone-700',
    ...(avatarUrl ? { avatarUrl } : {}),
  };

  mpState.sessionCharacter = character;
  mpState.characterName = character.name;
  appState.activeCharacter = { id: 'multiplayer-session', ...character };
}

async function persistMessage(message: MpMessage): Promise<void> {
  if (message.kind === 'system' || message.streaming) return;
  const chatId = await ensurePersistentSession();
  await invoke('add_message', {
    chatId,
    role: message.kind === 'llm' ? 'assistant' : 'user',
    content: message.text,
    author: message.author || null,
    // The relay id is only unique within its network history. Namespace it by
    // the persistent session so rejoining the same ephemeral room can never
    // collide with a different local conversation.
    messageId: `${chatId}:${message.id}`,
    createdAt: new Date(message.ts).toISOString(),
  });
}

async function insertInitialGreeting(): Promise<void> {
  const character = appState.activeCharacter as Character | null;
  if (!character) return;
  const greeting = selectInitialGreeting(character);
  if (!greeting) return;

  const message: MpMessage = {
    id: crypto.randomUUID(),
    kind: 'llm',
    author: character.name,
    text: greeting,
    ts: Date.now(),
  };
  seenIds.add(message.id);
  insertSorted(message);
  await persistMessage(message);
}

async function createRoom(): Promise<void> {
  await prepareHostSessionCharacter();
  const res = await fetch(`${RELAY_URL}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error('create failed');
  const { room_id, host_token } = await res.json();
  await generateKey();
  hostToken = host_token;
  const base = `${window.location.origin}${window.location.pathname}`;
  mpState.shareLink = `${base}?mp=${room_id}#k=${keyB64}`;
  mpState.hostLink = `${base}?mp=${room_id}#k=${keyB64}&h=${host_token}`;
  mpState.showLinks = true;
  connect(room_id);
}

// WebSocket lifecycle

function connect(roomId: string): void {
  mpState.roomId = roomId;
  ws = new WebSocket(`${RELAY_WS}/ws/${roomId}`);

  ws.onopen = () => {
    ws?.send(JSON.stringify({ t: 'hello', host_token: hostToken }));
  };

  ws.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    void handleServerMsg(msg);
  };

  ws.onclose = (ev) => {
    const wasConnected = mpState.connected;
    mpState.connected = false;
    mpState.connecting = false;
    stopGeneration();
    if (mpState.closedReason) return; // room_closed already carried a reason
    mpState.closedReason = mapCloseCode(ev.code, wasConnected);
  };

  ws.onerror = () => {
    /* onclose fires right after anyway */
  };
}

function mapCloseCode(code: number, wasConnected: boolean): ClosedReason {
  switch (code) {
    case 4001:
      return 'host_left';
    case 4404:
      return 'not_found';
    case 4403:
      return 'bad_token';
    case 4409:
      return 'host_taken';
    case 4008:
      return 'idle';
    case 4413:
      return 'slow';
    case 1000:
      return wasConnected ? 'left' : 'error';
    default:
      return 'error';
  }
}

export function leaveRoom(): void {
  mpState.closedReason = 'left';
  ws?.close(1000);
  ws = null;
  stopGeneration();
  appState.activeCharacter = null;
  appState.currentView = 'play';
}

function resetRoomState(): void {
  ws?.close(1000);
  ws = null;
  stopGeneration();
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = null;
  cryptoKey = null;
  keyB64 = '';
  hostToken = null;
  seenIds.clear();
  sessionPromise = null;
  shouldInsertInitialGreeting = false;
  Object.assign(mpState, {
    connected: false,
    connecting: false,
    roomId: '',
    role: 'guest',
    selfId: 0,
    count: 0,
    lockedBy: null,
    everyoneCanGenerate: false,
    generating: false,
    messages: [],
    characterName: '',
    sessionCharacter: null,
    conversationId: null,
    viewingHistory: false,
    shareLink: '',
    hostLink: '',
    showLinks: false,
    closedReason: '',
    error: '',
    pending: null,
  });
}

// Incoming server frames

async function handleServerMsg(msg: any): Promise<void> {
  switch (msg.t) {
    case 'welcome':
      mpState.connected = true;
      mpState.connecting = false;
      mpState.pending = null;
      mpState.selfId = msg.you;
      mpState.role = msg.role;
      mpState.count = msg.count;
      mpState.lockedBy = msg.locked_by ?? null;
      mpState.everyoneCanGenerate = msg.everyone_can_generate;
      if (mpState.role === 'host') {
        mpState.characterName = appState.activeCharacter?.name ?? '';
      }
      const addInitialGreeting = mpState.role === 'host' && shouldInsertInitialGreeting;
      if (addInitialGreeting) shouldInsertInitialGreeting = false;
      await ensurePersistentSession();
      if (addInitialGreeting) await insertInitialGreeting();
      break;

    case 'joined':
      mpState.count = msg.count;
      pushSystem(`__joined:${msg.id}`);
      if (mpState.role === 'host') scheduleSnapshot();
      break;

    case 'left':
      mpState.count = msg.count;
      pushSystem(`__left:${msg.id}`);
      break;

    case 'relay': {
      const inner = await decryptJson(msg.p);
      if (inner) handleDecrypted(inner);
      break;
    }

    case 'locked':
      mpState.lockedBy = msg.by;
      // Triggering and running are separate concerns: no matter who grabbed
      // the lock, generation always happens on the host, since only it has
      // the key, the context, and the LLM.
      if (mpState.role === 'host') void runGeneration();
      break;

    case 'unlocked':
      mpState.lockedBy = null;
      if (mpState.generating) stopGeneration(); // e.g. triggered by the server watchdog
      finalizeStreamingMessages();
      break;

    case 'policy':
      mpState.everyoneCanGenerate = msg.everyone;
      break;

    case 'room_closed':
      mpState.closedReason = msg.reason === 'expired' ? 'expired' : 'host_left';
      break;

    case 'error':
      // "locked" / "not_allowed" / "already_locked": the UI blocks these
      // anyway, so just ignore defensively here.
      break;
  }
}

// Decrypted application frames (the actual protocol, opaque to the server)

function handleDecrypted(inner: any): void {
  switch (inner.k) {
    case 'chat':
      if (typeof inner.id !== 'string' || seenIds.has(inner.id)) return;
      seenIds.add(inner.id);
      const message: MpMessage = {
        id: inner.id,
        kind: 'chat',
        author: String(inner.name ?? '?'),
        text: String(inner.text ?? ''),
        ts: Number(inner.ts) || Date.now(),
      };
      insertSorted(message);
      void persistMessage(message);
      break;

    case 'llm_d': {
      const mid = String(inner.mid);
      const delta = String(inner.d ?? '');

      let m = mpState.messages.find((x) => x.id === mid);

      if (!m) {
        const newMsg: MpMessage = {
          id: mid,
          kind: 'llm',
          author: String(inner.name ?? mpState.characterName ?? 'AI'),
          text: delta,
          ts: Date.now(),
          streaming: true,
        };

        seenIds.add(mid);
        insertSorted(newMsg);
      } else {
        m.text += delta;
      }

      break;
    }

    case 'llm_e': {
      const m = mpState.messages.find((x) => x.id === inner.mid);
      if (m) {
        m.streaming = false;
        void persistMessage(m);
      }
      break;
    }

    case 'snap':
      // History snapshot from the host for late joiners. Anyone who
      // already has a message (by id) simply ignores it.
      if (mpState.role === 'host') return;
      if (typeof inner.charName === 'string' && !mpState.characterName) {
        mpState.characterName = inner.charName;
      }
      applySessionCharacter(inner.character);
      if (Array.isArray(inner.msgs)) {
        let added = false;
        for (const raw of inner.msgs) {
          if (typeof raw?.id !== 'string' || seenIds.has(raw.id)) continue;
          seenIds.add(raw.id);
          const message: MpMessage = {
            id: raw.id,
            kind: raw.kind === 'llm' ? 'llm' : 'chat',
            author: String(raw.author ?? '?'),
            text: String(raw.text ?? ''),
            ts: Number(raw.ts) || 0,
          };
          mpState.messages.push(message);
          void persistMessage(message);
          added = true;
        }
        if (added) mpState.messages.sort((a, b) => a.ts - b.ts);
      }
      break;
  }
}

function pushSystem(text: string): void {
  mpState.messages.push({
    id: crypto.randomUUID(),
    kind: 'system',
    author: '',
    text,
    ts: Date.now(),
  });
}

function finalizeStreamingMessages(): void {
  for (const m of mpState.messages) if (m.streaming) m.streaming = false;
}

// Sending

async function sendRelay(obj: unknown): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ t: 'relay', p: await encryptJson(obj) }));
}

export async function sendChat(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || mpState.lockedBy !== null) return;
  const msg = {
    k: 'chat',
    id: crypto.randomUUID(),
    name: mpState.displayName || '?',
    text: trimmed,
    ts: Date.now(),
  };
  seenIds.add(msg.id);
  const localMessage: MpMessage = {
    id: msg.id,
    kind: 'chat',
    author: msg.name,
    text: msg.text,
    ts: msg.ts,
  };
  insertSorted(localMessage);
  await persistMessage(localMessage);
  await sendRelay(msg);
}

export function requestGeneration(): void {
  if (mpState.lockedBy !== null) return;
  if (!(mpState.role === 'host' || mpState.everyoneCanGenerate)) return;
  ws?.send(JSON.stringify({ t: 'gen_start' }));
}

export function setPolicy(everyone: boolean): void {
  if (mpState.role !== 'host') return;
  ws?.send(JSON.stringify({ t: 'policy', everyone }));
}

/** Host cancels a running generation; the lock is released for everyone. */
export function abortGeneration(): void {
  if (mpState.role !== 'host') return;
  stopGeneration();
  ws?.send(JSON.stringify({ t: 'gen_end' }));
  finalizeStreamingMessages();
}

// Host: history snapshot for late joiners (client side only, debounced)

function scheduleSnapshot(): void {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void sendRelay({
      k: 'snap',
      charName: mpState.characterName,
      character: mpState.sessionCharacter,
      msgs: mpState.messages
        .filter((m) => m.kind !== 'system' && !m.streaming)
        .map(({ id, kind, author, text, ts }) => ({ id, kind, author, text, ts })),
    });
  }, SNAPSHOT_DEBOUNCE_MS);
}

// Host: LLM call

function stopGeneration(): void {
  llmAbort?.abort();
  llmAbort = null;
  mpState.generating = false;
}

async function runGeneration(): Promise<void> {
  if (mpState.generating) return;
  mpState.generating = true;

  const mid = crypto.randomUUID();
  const author = mpState.characterName || 'AI';
  seenIds.add(mid);
  insertSorted({
    id: mid,
    kind: 'llm',
    author,
    text: '',
    ts: Date.now(),
    streaming: true
  });

  const localMsg = mpState.messages.find((m) => m.id === mid)!;

  let buffer = '';
  const flush = async () => {
    if (!buffer) return;
    const d = buffer;
    buffer = '';
    await sendRelay({ k: 'llm_d', mid, name: author, d });
  };
  const flushTimer = setInterval(() => void flush(), LLM_FLUSH_MS);

  const { listen } = await import('@tauri-apps/api/event');
  let raw = '';
  const s = appState.apiSettings;

  const unlisten = await listen<{ token: string }>('ai-token', (ev) => {
    if (!mpState.generating) return; // stop touching state after abort or unlock
    raw += ev.payload.token;
    const visible = s.isThinkingModel
      ? processThinkingOutput(raw, false).text
      : raw;
    // diff against the visible text we already emitted
    const delta = visible.slice(localMsg.text.length);
    if (delta) {
      localMsg.text += delta;
      buffer += delta;
    }
  });

  try {
    await invoke('call_ai_api', {
      payload: {
        url: s.url,
        api_key: s.apiKey,
        model: s.model,
        messages: buildLlmMessages(),
        temperature: s.temperature,
        max_tokens: s.maxTokens,
        presence_penalty: s.presencePenalty,
        top_p: s.topP,
        top_k: s.topK,
        min_p: s.minP,
        frequency_penalty: s.frequencyPenalty,
        is_thinking_model: s.isThinkingModel,
      },
    });
    if (s.isThinkingModel) {
      const { text } = processThinkingOutput(raw, true);
      const delta = text.slice(localMsg.text.length);
      if (delta) { localMsg.text = text; buffer += delta; }
    }
  } catch {
    if (!localMsg.text) localMsg.text = '⚠';
  } finally {
    unlisten();

    clearInterval(flushTimer);
    await flush();
    await sendRelay({ k: 'llm_e', mid });
    localMsg.streaming = false;
    await persistMessage(localMsg);
    mpState.generating = false;
    ws?.send(JSON.stringify({ t: 'gen_end' }));
  }
}

function buildLlmMessages(): Array<{ role: string; content: string }> {
  const s = appState.apiSettings;
  const char = mpState.sessionCharacter ?? appState.activeCharacter;
  let system = s.systemPrompt || '';
  if (char?.prompt) {
    system += `${system ? '\n\n' : ''}You are ${char.name ?? 'the character'}. ${char.prompt}`;
  }
  if (s.aiLanguage) {
    system += `${system ? '\n' : ''}Respond in ${s.aiLanguage}.`;
  }

  // 1) collect history as before, walking backwards within a character budget
  const budget = Math.max(1000, (s.contextLimit || 4096) * 3);
  let used = 0;
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let i = mpState.messages.length - 1; i >= 0; i--) {
    const m = mpState.messages[i];
    if (m.kind === 'system' || m.streaming) continue;
    if (!m.text.trim() || m.text === '⚠') continue; // skip empty or broken turns
    const content = m.kind === 'llm' ? m.text : `${m.author}: ${m.text}`;
    if (used + content.length > budget) break;
    used += content.length;
    history.push({ role: m.kind === 'llm' ? 'assistant' : 'user', content });
  }
  history.reverse();

  // 2) merge consecutive turns with the same role into one turn
  const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const msg of history) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content += `\n${msg.content}`;
    } else {
      merged.push({ ...msg });
    }
  }

  // 3) enforce template requirements:
  //    the first and the last turn must both be user turns
  if (merged[0]?.role === 'assistant') {
    merged.unshift({ role: 'user', content: '[Start]' });
  }
  if (merged.length === 0 || merged[merged.length - 1].role === 'assistant') {
    merged.push({ role: 'user', content: '[Antworte auf das Gespräch]' });
  }

  const out: Array<{ role: string; content: string }> = [];
  if (system) out.push({ role: 'system', content: system });
  return out.concat(merged);
}

function insertSorted(msg: MpMessage): void {
  mpState.messages.push(msg);
  mpState.messages.sort((a, b) => a.ts - b.ts);
}
