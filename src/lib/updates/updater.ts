import { writable } from 'svelte/store';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';

type Phase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing';
type UpdateHandle = {
  version: string;
  download: (callback: (event: DownloadEvent) => void, options: { timeout: number }) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
};
export type UpdateState = {
  phase: Phase; supported: boolean; initialized: boolean; currentVersion: string;
  version: string; downloaded: number; total?: number;
  error: '' | 'check' | 'download' | 'install' | 'init';
};

// One owner for native resources; survives Settings unmounts and serializes operations.
export function createUpdater(deps: {
  getVersion: () => Promise<string>;
  supported: () => Promise<boolean>;
  check: (options: { timeout: number }) => Promise<UpdateHandle | null>;
}) {
  let state: UpdateState = { phase: 'idle', supported: false, initialized: false,
    currentVersion: '', version: '', downloaded: 0, error: '' };
  const store = writable(state);
  const set = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; store.set(state); };
  let handle: UpdateHandle | null = null;
  let initialization: Promise<void> | undefined;
  const busy = () => ['checking', 'downloading', 'installing'].includes(state.phase);
  async function dispose() {
    const previous = handle;
    handle = null;
    await previous?.close().catch(() => {});
  }
  async function check() {
    if (!state.supported || busy() || state.phase === 'ready') return;
    set({ phase: 'checking', error: '', version: '', downloaded: 0, total: undefined });
    await dispose();
    try {
      handle = await deps.check({ timeout: 15000 });
      // Stable channel only, even if release metadata is accidentally mispublished.
      if (handle && !/^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(handle.version)) await dispose();
      set({ phase: handle ? 'available' : 'current', version: handle?.version ?? '' });
    } catch { set({ phase: 'idle', error: 'check' }); }
  }
  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const [currentVersion, supported] = await Promise.all([deps.getVersion(), deps.supported()]);
        set({ currentVersion, supported, initialized: true, error: '' });
        await check();
      } catch { set({ error: 'init' }); initialization = undefined; }
    })();
    return initialization;
  }
  async function download() {
    if (!handle || state.phase !== 'available') return;
    set({ phase: 'downloading', error: '', downloaded: 0, total: undefined });
    try {
      await handle.download(event => {
        if (event.event === 'Started') set({ total: event.data.contentLength });
        if (event.event === 'Progress') set({ downloaded: state.downloaded + event.data.chunkLength });
        // Finished means bytes arrived, NOT that signature verification succeeded.
      }, { timeout: 300000 });
      set({ phase: 'ready' });
    } catch {
      await dispose();
      set({ phase: 'idle', error: 'download' });
    }
  }
  async function install() {
    if (!handle || state.phase !== 'ready') return;
    set({ phase: 'installing', error: '' });
    try {
      // Windows launches its installer, exits, and the installer relaunches Ryokan.
      await handle.install();
    } catch {
      await dispose();
      set({ phase: 'idle', error: 'install' });
    }
  }
  return { subscribe: store.subscribe, initialize, check, download, install };
}
