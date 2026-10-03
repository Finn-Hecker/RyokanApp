// Keep this list aligned with the enabled image codecs in src-tauri/Cargo.toml.
export const AVATAR_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif';
export const CHARACTER_CARD_ACCEPT = 'image/png,.png';

export function supportedImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  const header = String.fromCharCode(...bytes.subarray(0, 12));
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'webp';
  return null;
}
