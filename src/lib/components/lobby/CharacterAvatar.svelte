<script lang="ts">
  import { loadCharacterThumbnail } from '$lib/stores/characterStore.svelte';

  let {
    char,
    imgClass = 'w-full h-full object-cover',
    fallbackTextClass = 'text-2xl',
    gradientClass = ''
  }: {
    char: any;
    imgClass?: string;
    fallbackTextClass?: string;
    gradientClass?: string;
  } = $props();

  // Only the fallback (initials) placeholder is ever observed. Once a real
  // avatar has loaded, imageUrl becomes truthy and this element is
  // removed from the DOM, so there's nothing left to watch — no explicit
  // "stop observing once loaded" branch needed beyond that.
  let fallbackEl: HTMLDivElement | undefined = $state();
  const imageUrl = $derived(char.thumbnailUrl || char.avatarUrl);

  $effect(() => {
    if (!char.has_avatar || imageUrl || !fallbackEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadCharacterThumbnail(String(char.id));
          observer.disconnect();
        }
      },
      { rootMargin: '300px' } // start the fetch slightly before the card is actually on screen
    );

    observer.observe(fallbackEl);
    return () => observer.disconnect();
  });
</script>

{#if imageUrl}
  <img src={imageUrl} alt={char.name} class={imgClass} decoding="async" />
  {#if gradientClass}
    <div class="absolute inset-0 {gradientClass}"></div>
  {/if}
{:else}
  <div
    bind:this={fallbackEl}
    class="w-full h-full {char.color} flex items-center justify-center text-white font-bold {fallbackTextClass} opacity-80"
  >{char.initials}</div>
{/if}
