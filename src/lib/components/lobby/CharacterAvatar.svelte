<script lang="ts">
  import { loadCharacterAvatar } from '$lib/stores/characterStore.svelte';

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
  // avatar has loaded, char.avatarUrl becomes truthy and this element is
  // removed from the DOM, so there's nothing left to watch — no explicit
  // "stop observing once loaded" branch needed beyond that.
  let fallbackEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!char.has_avatar || char.avatarUrl || !fallbackEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadCharacterAvatar(String(char.id));
          observer.disconnect();
        }
      },
      { rootMargin: '300px' } // start the fetch slightly before the card is actually on screen
    );

    observer.observe(fallbackEl);
    return () => observer.disconnect();
  });
</script>

{#if char.avatarUrl}
  <img src={char.avatarUrl} alt={char.name} class={imgClass} />
  {#if gradientClass}
    <div class="absolute inset-0 {gradientClass}"></div>
  {/if}
{:else}
  <div
    bind:this={fallbackEl}
    class="w-full h-full {char.color} flex items-center justify-center text-white font-bold {fallbackTextClass} opacity-80"
  >{char.initials}</div>
{/if}