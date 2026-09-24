import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { createUpdater } from '../utils/updater';

export const updater = createUpdater({ getVersion, supported: () => invoke<boolean>('supports_updates'), check });
