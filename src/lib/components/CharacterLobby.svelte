<script lang="ts">
  import { currentView, activeCharacter } from '$lib/stores/appState';
  import { allCharacters, loadCharacters } from '$lib/stores/characterStore';
  import { startNewChat } from '$lib/stores/chatStore';
  import SettingsModal from './SettingsModal.svelte';
  import * as m from '$lib/paraglide/messages';
  import { onMount } from 'svelte';

  let showSettings = false;

  onMount(async () => {
      await loadCharacters();
  });

  async function onSelectChar(char: any) {
    activeCharacter.set(char);
    await startNewChat(char);
    currentView.set('chat');
  }

  function onOpenCreate() {
    currentView.set('create');
  }
</script>

<div class="h-full overflow-y-auto p-8 pt-10 relative">
  
<div class="absolute top-6 right-8 flex items-center gap-3">
    
    <button 
      on:click={onOpenCreate}
      class="group flex items-center justify-center gap-2 h-10 w-10 md:w-32 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-ryokan-accent/30 text-gray-400 hover:text-white transition-all rounded-full active:scale-95"
    >
      <svg class="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      
      <span class="text-sm font-medium tracking-wide truncate max-w-[70px] hidden md:block">
        {m.lobby_btn_open_create_char()}
      </span> 
    </button>

    <button 
      on:click={() => showSettings = true}
      aria-label={m.lobby_btn_open_settings()}
      class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-white transition bg-white/5 rounded-full hover:bg-white/10 active:scale-95"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    </button>
  </div>

  <SettingsModal isOpen={showSettings} close={() => showSettings = false} />

  <div class="max-w-5xl mx-auto mt-16">
    <header class="mb-12">
      <h1 class="text-4xl font-medium text-gray-100 mb-3 tracking-tight">{m.welcome_title()}</h1>
      <p class="text-gray-500 text-lg">
        {m.lobby_subtitle_pre()} <span class="text-ryokan-accent">{m.lobby_subtitle_highlight()}</span> {m.lobby_subtitle_post()}
      </p>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each $allCharacters as char}
        <button 
          on:click={() => onSelectChar(char)}
          class="group w-full bg-ryokan-surface hover:bg-white/5 border border-white/5 hover:border-ryokan-accent/30 rounded-2xl p-4 transition-all duration-200 active:scale-[0.98] text-left"
        >
          <div class="flex items-center gap-4">
             <div class="w-12 h-12 rounded-xl {char.avatar ? '' : char.color} shadow-lg flex items-center justify-center shrink-0 text-white font-bold text-lg group-hover:scale-105 transition-transform overflow-hidden border border-white/10">
               {#if char.avatarUrl}
                <img 
                  src={char.avatarUrl}  
                  alt={char.name} 
                  class="w-full h-full object-cover" 
                />
                {:else}
                    {char.initials}
                {/if}
             </div>

             <div class="flex-1 min-w-0">
               <h3 class="text-base font-semibold text-gray-200 truncate group-hover:text-ryokan-accent transition-colors">
                 {char.name}
               </h3>
               
               <p class="text-sm text-gray-500 mt-0.5 line-clamp-2 leading-snug">
                 {char.desc}
               </p>
             </div>
          </div>
        </button>
      {/each}
    </div>
  </div>
</div>