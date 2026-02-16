<script lang="ts">
  import { currentView } from '$lib/stores/appState';
  import { createCharacter } from '$lib/stores/characterStore';
  import { fade } from 'svelte/transition';
  import { invoke } from '@tauri-apps/api/core';
  import * as m from '$lib/paraglide/messages';

  let name = "";
  let description = "";
  let personality = "";
  let scenario = "";
  let greeting = "";
  let mes_example = "";
  let creator_notes = "";
  let alternate_greetings: string[] = [];
  
  let isSaving = false;
  let avatarPreview: string | null = null;
  let isDragging = false;

  let importInput: HTMLInputElement;
  let avatarInput: HTMLInputElement;

  async function handleSave() {
    if (!name || !description) return;
    const validAltGreetings = alternate_greetings.filter(g => g.trim().length > 0);
    isSaving = true;
    const newChar = {
        name,
        desc: description,
        personality,
        scenario,
        greeting,
        alternate_greetings: validAltGreetings,
        mes_example,
        creator_notes,
        initials: name.substring(0, 1).toUpperCase(),
        color: "bg-indigo-600",
        avatar: avatarPreview ?? null
    };
    
    await createCharacter(newChar);
    isSaving = false;
    goBack();
  }

  function goBack() {
    currentView.set('lobby');
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer?.files[0]) processImport(e.dataTransfer.files[0]);
  }
  
  function addAltGreeting() {
      alternate_greetings = [...alternate_greetings, ""];
  }
  
  function removeAltGreeting(index: number) {
      alternate_greetings = alternate_greetings.filter((_, i) => i !== index);
  }

  function processAvatar(file: File) {
      if (!file.type.includes('image')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
          avatarPreview = e.target?.result as string;
      };
      reader.readAsDataURL(file);
  }

  async function processImport(file: File) {
      if (!file.type.includes('image')) return;
      
      processAvatar(file);
      
      try {
          const arrayBuffer = await file.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          
          const metadata = await invoke<any>('parse_character_card', { 
              imageData: Array.from(uint8Array) 
          });
          console.log("Import successful:", metadata);

          if (metadata.name) name = metadata.name;
          if (metadata.description) description = metadata.description;
          if (metadata.personality) personality = metadata.personality;
          if (metadata.scenario) scenario = metadata.scenario;
          if (metadata.first_mes) greeting = metadata.first_mes;
          if (metadata.alternate_greetings && metadata.alternate_greetings.length > 0) {
              alternate_greetings = metadata.alternate_greetings;
          }
          if (metadata.mes_example) mes_example = metadata.mes_example;
          if (metadata.creator_notes) creator_notes = metadata.creator_notes;
      } catch (err) {
          console.warn("Import Info:", err);
      }
  }
</script>

<div 
  class="h-full w-full bg-ryokan-bg text-gray-200 flex flex-col relative"
  in:fade={{ duration: 200 }}
  role="region"
  aria-label={m.create_page_aria_region()}
  on:dragover|preventDefault={() => isDragging = true}
  on:dragleave={() => isDragging = false}
  on:drop={onDrop}
>

  {#if isDragging}
    <div class="absolute inset-0 z-50 bg-ryokan-accent/20 backdrop-blur-sm border-4 border-ryokan-accent border-dashed m-4 rounded-3xl flex items-center justify-center pointer-events-none" transition:fade>
      <div class="bg-ryokan-bg p-6 rounded-2xl shadow-xl border border-ryokan-accent text-ryokan-accent font-bold text-xl">
        {m.create_page_drop_zone()}
      </div>
    </div>
  {/if}

  <header class="h-16 border-b border-white/5 flex items-center justify-between px-4 md:px-8 shrink-0 bg-ryokan-bg/95 backdrop-blur z-20 sticky top-0">
    <button 
        on:click={goBack}
        aria-label={m.create_page_aria_back()}
        class="p-2 -ml-2 rounded-full text-gray-400 hover:text-white transition-colors active:scale-95"
    >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    
    <span class="font-medium text-sm md:text-base">{m.create_page_title()}</span>

    <div class="flex items-center gap-3">
    
        <button 
            on:click={() => importInput.click()}
            aria-label={m.create_page_aria_import()}
            class="p-2 text-ryokan-accent hover:bg-ryokan-accent/10 rounded-full transition-colors"
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        </button>

        <button 
            on:click={handleSave}
            disabled={!name || isSaving}
            class="text-sm font-bold text-ryokan-bg bg-white px-4 py-1.5 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
            {#if isSaving} ... {:else} {m.create_page_btn_done()} {/if}
        </button>
    </div>
  </header>

  <div class="flex-1 overflow-y-auto overflow-x-hidden">
    <div class="max-w-xl mx-auto p-4 md:p-8 space-y-8 pb-32">
        
        <input type="file" bind:this={importInput} on:change={(e: any) => e.target.files?.[0] && processImport(e.target.files[0])} accept="image/png,image/webp" hidden />
        <input type="file" bind:this={avatarInput} on:change={(e: any) => e.target.files?.[0] && processAvatar(e.target.files[0])} accept="image/*" hidden />

        <div class="flex flex-col items-center gap-4 py-4">
            <button 
                on:click={() => avatarInput.click()}
                aria-label={m.create_page_aria_avatar()}
                class="relative w-32 h-32 md:w-40 md:h-40 rounded-full bg-white/5 border border-white/10 overflow-hidden group hover:border-ryokan-accent transition-all active:scale-95 shadow-2xl"
            >
                {#if avatarPreview}
                    <img src={avatarPreview} alt={m.create_page_alt_avatar()} class="w-full h-full object-cover" />
                {:else}
                    <div class="w-full h-full flex items-center justify-center text-gray-600 group-hover:text-gray-400">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                {/if}
                
                <div class="absolute bottom-0 inset-x-0 h-8 bg-black/60 flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                </div>
            </button>
            <p class="text-xs text-gray-500">{m.create_page_avatar_hint()}</p>
        </div>

        <div class="space-y-6">
            
            <div class="bg-white/[0.03] border border-white/5 rounded-2xl p-1 focus-within:border-ryokan-accent/50 focus-within:bg-white/[0.05] transition-colors">
                <label for="character-name" class="block text-[10px] uppercase tracking-wider text-gray-500 px-4 pt-3">{m.create_page_label_name()}</label>
                <input 
                    id="character-name"
                    type="text" 
                    bind:value={name}
                    class="w-full bg-transparent border-none text-white px-4 pb-3 pt-1 text-lg focus:ring-0 placeholder-gray-700"
                    placeholder={m.create_page_placeholder_name()}
                />
            </div>

            <div class="bg-white/[0.03] border border-white/5 rounded-2xl p-1 focus-within:border-ryokan-accent/50 focus-within:bg-white/[0.05] transition-colors">
                <label for="character-description" class="block text-[10px] uppercase tracking-wider text-gray-500 px-4 pt-3">{m.create_page_label_desc()}</label>
                <textarea 
                    id="character-description"
                    bind:value={description}
                    rows="6"
                    class="w-full bg-transparent border-none text-gray-300 px-4 pb-3 pt-1 text-sm focus:ring-0 placeholder-gray-700 resize-none leading-relaxed"
                    placeholder={m.create_page_placeholder_desc()}
                ></textarea>
            </div>

            <div class="bg-white/[0.03] border border-white/5 rounded-2xl p-1 focus-within:border-ryokan-accent/50 focus-within:bg-white/[0.05] transition-colors">
                <label for="character-greeting" class="block text-[10px] uppercase tracking-wider text-gray-500 px-4 pt-3">{m.create_page_label_greeting()}</label>
                <textarea 
                    id="character-greeting"
                    bind:value={greeting}
                    rows="4"
                    class="w-full bg-transparent border-none text-gray-300 px-4 pb-3 pt-1 text-sm focus:ring-0 placeholder-gray-700 resize-none leading-relaxed"
                    placeholder={m.create_page_placeholder_greeting()}
                ></textarea>
                
            </div>

            {#if alternate_greetings.length > 0}
                <div class="space-y-4" transition:fade>
                    {#each alternate_greetings as _, i}
                        <div class="bg-white/[0.03] border border-white/5 rounded-2xl p-1 focus-within:border-ryokan-accent/50 focus-within:bg-white/[0.05] transition-colors relative group">
                            <div class="flex items-center justify-between px-4 pt-3">
                                <label 
                                    for="alt-greeting-{i}"
                                    class="block text-[10px] uppercase tracking-wider text-gray-500"
                                >
                                    {m.create_page_label_alt_greeting({ index: i + 1 })}
                                </label>
                                <button 
                                    on:click={() => removeAltGreeting(i)}
                                    class="text-gray-600 hover:text-red-400 opacity-50 hover:opacity-100 transition-all p-1"
                                    title={m.create_page_title_delete()}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                            <textarea 
                                id="alt-greeting-{i}"
                                bind:value={alternate_greetings[i]}
                                rows="3"
                                class="w-full bg-transparent border-none text-gray-300 px-4 pb-3 pt-1 text-sm focus:ring-0 placeholder-gray-700 resize-none leading-relaxed"
                                placeholder={m.create_page_placeholder_alt_greeting()}
                            ></textarea>
                        </div>
                    {/each}
                </div>
            {/if}

            <button 
                on:click={addAltGreeting}
                class="flex items-center gap-2 text-xs font-medium text-ryokan-accent/70 hover:text-ryokan-accent px-4 py-2 rounded-lg hover:bg-ryokan-accent/10 transition-colors w-max"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                {m.create_page_btn_add_alt()}
            </button>
            <div class="pt-6 pb-2">
                <h3 class="text-[10px] font-bold text-ryokan-accent uppercase tracking-[0.2em] px-4">{m.create_page_header_advanced()}</h3>
            </div>

            <div class="bg-white/[0.03] border border-white/5 rounded-2xl p-1 focus-within:border-ryokan-accent/50 focus-within:bg-white/[0.05] transition-colors">
                <label for="char-personality" class="block text-[10px] uppercase tracking-wider text-gray-500 px-4 pt-3">{m.create_page_label_personality()}</label>
                <textarea 
                    id="char-personality" bind:value={personality} rows="3"
                    class="w-full bg-transparent border-none text-gray-300 px-4 pb-3 pt-1 text-sm focus:ring-0 placeholder-gray-700 resize-none leading-relaxed"
                    placeholder={m.create_page_placeholder_personality()}
                ></textarea>
            </div>

            <div class="bg-white/[0.03] border border-white/5 rounded-2xl p-1 focus-within:border-ryokan-accent/50 focus-within:bg-white/[0.05] transition-colors">
                <label for="char-scenario" class="block text-[10px] uppercase tracking-wider text-gray-500 px-4 pt-3">{m.create_page_label_scenario()}</label>
                <textarea 
                    id="char-scenario" bind:value={scenario} rows="3"
                    class="w-full bg-transparent border-none text-gray-300 px-4 pb-3 pt-1 text-sm focus:ring-0 placeholder-gray-700 resize-none leading-relaxed"
                    placeholder={m.create_page_placeholder_scenario()}
                ></textarea>
            </div>

            <div class="bg-white/[0.03] border border-white/5 rounded-2xl p-1 focus-within:border-ryokan-accent/50 focus-within:bg-white/[0.05] transition-colors">
                <label for="char-mes-example" class="block text-[10px] uppercase tracking-wider text-gray-500 px-4 pt-3">{m.create_page_label_mes_example()}</label>
                <textarea 
                    id="char-mes-example" bind:value={mes_example} rows="4"
                    class="w-full bg-transparent border-none text-gray-300 px-4 pb-3 pt-1 text-sm focus:ring-0 placeholder-gray-700 resize-none leading-relaxed font-mono text-xs"
                    placeholder={m.create_page_placeholder_mes_example()}
                ></textarea>
            </div>

        </div>
    </div>
  </div>
</div>