<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export let character: any = null;
</script>

<div class="flex items-start gap-2.5 mb-6 animate-fade-in">

  <div class="shrink-0 w-8 h-8 rounded-full overflow-hidden ring-1 ring-white/10 mt-0.5">
    {#if character?.avatarUrl}
      <img src={character.avatarUrl} alt={character.name} class="w-full h-full object-cover" />
    {:else}
      <div class="w-full h-full {character?.color ?? 'bg-ryokan-surface'} flex items-center justify-center text-white font-bold text-xs">
        {character?.initials ?? (character?.name?.[0]?.toUpperCase() ?? 'A')}
      </div>
    {/if}
  </div>

  <div class="flex flex-col items-start">
    <div class="flex items-center space-x-3 text-gray-500 px-4 py-2 rounded-xl border border-white/5 shadow-inner">
      <span class="relative flex h-2.5 w-2.5">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-ryokan-accent opacity-50"></span>
        <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-ryokan-accent/80"></span>
      </span>
      <span class="text-xs font-medium italic tracking-wide">{m.chat_thinking()}</span>
    </div>
  </div>
</div>