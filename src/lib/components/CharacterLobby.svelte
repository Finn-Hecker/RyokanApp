<script lang="ts">
  import { currentView, activeCharacter } from '$lib/stores/appState';
  import { selectChatForCharacter } from '$lib/stores/chatStore';
  import { startNewChat } from '$lib/stores/chatStore';
  import SettingsModal from './SettingsModal.svelte';
  import * as m from '$lib/../paraglide/messages';

  const characters = [
    { id: 1, name: "Seraphina", desc: "Eine mysteriöse Magierin.", color: "bg-purple-500", initials: "S" },
    { id: 3, name: "Der Barkeeper", desc: "Hört dir immer zu.", color: "bg-orange-500", initials: "B" }
  ];

  let showSettings = false;

  async function onSelectChar(char: any) {
    activeCharacter.set(char);
    await startNewChat(char);
    currentView.set('chat');
  }
</script>

<div class="h-full overflow-y-auto p-8 pt-10 relative">
  
  <div class="absolute top-6 right-8">
    <button 
      on:click={() => showSettings = true}
      aria-label="Charakter auswählen"
      class="text-gray-500 hover:text-white transition p-2 bg-white/5 rounded-full hover:bg-white/10"
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
      <p class="text-gray-500 text-lg">Wähle deinen Begleiter für eine <span class="text-ryokan-accent">neue</span> Unterhaltung.</p>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each characters as char}
        <button 
          on:click={() => onSelectChar(char)}
          class="group relative bg-ryokan-surface rounded-2xl p-6 text-left transition-all duration-300 border border-white/5 hover:border-ryokan-accent/30 hover:shadow-2xl hover:-translate-y-1 overflow-hidden"
        >
          <div class="relative z-10 flex items-start gap-5">
             <div class="w-14 h-14 rounded-2xl {char.color} shadow-lg flex items-center justify-center shrink-0 text-white text-xl font-bold">
               {char.initials || char.name[0]}
             </div>
             <div>
               <h3 class="text-lg font-medium text-gray-200 group-hover:text-ryokan-accent transition-colors">
                 {char.name}
               </h3>
               <p class="text-sm text-gray-500 mt-1 leading-relaxed">
                 {char.desc}
               </p>
             </div>
           </div>
        </button>
      {/each}
    </div>
  </div>
</div>