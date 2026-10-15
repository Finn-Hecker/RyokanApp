<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { AVATAR_IMAGE_ACCEPT } from '$lib/utils/imageFormats';

  let {
    avatarPreview = null,
    storyCover = false,
    onFileSelected
  }: {
    avatarPreview?: string | null;
    storyCover?: boolean;
    onFileSelected?: (file: File) => void;
  } = $props();

  let avatarInput = $state<HTMLInputElement | null>(null);

  function onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) onFileSelected?.(file);
  }

  export function triggerClick() {
    avatarInput?.click();
  }
</script>

<input
  type="file"
  bind:this={avatarInput}
  onchange={onFileChange}
  accept={AVATAR_IMAGE_ACCEPT}
  hidden
/>

<div class="flex flex-col items-center gap-4 py-4">
  <button
    onclick={triggerClick}
    aria-label={m.create_page_aria_avatar()}
    class="relative w-32 h-32 md:w-40 md:h-40 rounded-full bg-white/5 border border-white/10 overflow-hidden group hover:border-ryokan-accent transition-all active:scale-95 shadow-2xl"
  >
    {#if avatarPreview}
      <img src={avatarPreview} alt={m.create_page_alt_avatar()} class="w-full h-full object-cover" />
    {:else}
      <div class="w-full h-full flex items-center justify-center text-gray-600 group-hover:text-gray-400">
        {#if storyCover}
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--sheet-text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 11.5C9.5 9.8 6.5 9.3 3 10v10c3.5-.7 6.5-.2 9 1.5 2.5-1.7 5.5-2.2 9-1.5V10c-3.5-.7-6.5-.2-9 1.5Zm0 0v10"/>
            <path d="m12 2 .9 2.6L15.5 5.5l-2.6.9L12 9l-.9-2.6L8.5 5.5l2.6-.9Z" stroke="var(--accent)" stroke-width="1.2"/>
          </svg>
        {:else}
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        {/if}
      </div>
    {/if}

    <div class="absolute bottom-0 inset-x-0 h-8 bg-black/60 flex items-center justify-center">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    </div>
  </button>

  <p class="text-xs text-gray-500">{m.create_page_avatar_hint()}</p>
</div>
