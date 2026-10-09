import { characterState, ensureLobbyCharactersLoaded, loadCharacterThumbnail } from '$lib/stores/characterStore.svelte';
import { roleState, ensureRolesLoaded, loadRoleThumbnail } from '$lib/stores/roleStore.svelte';
import { ensureWorldInfosLoaded } from '$lib/stores/worldInfoStore.svelte';
import { ensureConversationsLoaded } from '$lib/stores/chatStore.svelte';

let pendingPreparation: Promise<void> | undefined;
const decodedUrls = new Set<string>();

async function decodeImage(url: string | undefined): Promise<void> {
  if (!url || decodedUrls.has(url)) return;
  const image = new Image();
  image.src = url;
  await image.decode();
  decodedUrls.add(url);
  // Let WebView manage its decoded-image cache rather than retaining an
  // additional unbounded collection of image elements on Android.
}

/** Prepare local screen data before navigation; chat histories stay paginated. */
export function prepareLibrary(): Promise<void> {
  if (!pendingPreparation) {
    pendingPreparation = (async () => {
      await Promise.all([
        ensureLobbyCharactersLoaded(),
        ensureRolesLoaded(),
        ensureWorldInfosLoaded(),
        ensureConversationsLoaded('singleplayer'),
        ensureConversationsLoaded('multiplayer'),
      ]);

      const images = [
        ...characterState.allCharacters.map(character => async () => {
          if (character.has_avatar) await loadCharacterThumbnail(String(character.id));
          await decodeImage(character.thumbnailUrl || character.avatarUrl);
        }),
        ...roleState.roles.map(role => async () => {
          if (role.has_avatar) await loadRoleThumbnail(role.id);
          await decodeImage(role.thumbnailUrl || role.avatarUrl);
        }),
      ];
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(2, images.length) }, async () => {
        while (next < images.length) {
          const prepare = images[next++];
          try { await prepare(); } catch {
            // A corrupt avatar must not prevent opening the rest of the app.
            // Failed URLs are not cached and can be retried on another pass.
          }
        }
      }));
    })().finally(() => { pendingPreparation = undefined; });
  }
  return pendingPreparation;
}
