import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

/** Android confirms the write; desktop confirms only dispatch of the download. */
export async function exportFile(bytes: Uint8Array, filename: string, mimeType: string,
  filter: { name: string; extensions: string[] }, mobile: boolean): Promise<boolean> {
  if (mobile) {
    const uri = await save({ defaultPath: filename, filters: [filter] });
    if (uri === null) return false;
    await invoke('write_android_export', { uri, bytes: Array.from(bytes) });
    return true;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return true;
}
