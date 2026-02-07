<script lang="ts">
  import { currentView, activeCharacter } from '$lib/stores/appState';

  const characters = [
    { id: 1, name: "Seraphina", desc: "Eine mysteriöse Magierin.", color: "bg-purple-500", initials: "S" },
    { id: 3, name: "Der Barkeeper", desc: "Hört dir immer zu.", color: "bg-orange-500", initials: "B" }
  ];

  function selectChar(char: any) {
    activeCharacter.set(char);
    currentView.set('chat');
  }
</script>

<div class="h-full overflow-y-auto p-8 pt-28">
  
  <div class="max-w-5xl mx-auto">
    <header class="mb-12">
      <h1 class="text-4xl font-medium text-gray-100 mb-3 tracking-tight">Willkommen im Ryokan</h1>
      <p class="text-gray-500 text-lg">Wähle deinen Begleiter für eine Unterhaltung.</p>
    </header>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each characters as char}
        <button 
          on:click={() => selectChar(char)}
          class="group relative bg-ryokan-surface rounded-2xl p-6 text-left transition-all duration-300
                 border border-white/5 hover:border-ryokan-accent/30 hover:shadow-2xl hover:-translate-y-1 overflow-hidden"
        >
          <div class="absolute top-0 right-0 p-32 bg-ryokan-accent/5 rounded-full blur-3xl -mr-16 -mt-16 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

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