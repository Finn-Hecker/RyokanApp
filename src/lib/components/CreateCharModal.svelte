<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { createEventDispatcher } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  export let isOpen = false;
  export let close: () => void;

  const dispatch = createEventDispatcher();

  let name = "";
  let description = "";
  let greeting = "";
  
  let isSaving = false;

  async function handleSave() {
    if (!name || !description) return;
    
    isSaving = true;

    const newChar = {
        name,
        desc: description,
        greeting,
        initials: name.substring(0, 1).toUpperCase(),
        color: "bg-indigo-600"
    };
    
    dispatch('create', newChar);
    
    isSaving = false;
    resetForm();
    close();
  }

  function resetForm() {
    name = "";
    description = "";
    greeting = "";
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    }
  }
</script>

{#if isOpen}
  <div 
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    on:click={close}
    on:keydown={handleKeydown}
    transition:fade={{ duration: 200 }}
  >
    <div 
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      class="w-full max-w-lg bg-ryokan-surface border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      on:click|stopPropagation
      on:keydown|stopPropagation
      transition:scale={{ start: 0.95, duration: 200 }}
    >
      
      <div class="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/5">
        <h2 id="modal-title" class="text-lg font-medium text-gray-100">{m.create_char_title()}</h2>
        <button 
          on:click={close} 
          aria-label={m.create_char_close_aria()} 
          class="text-gray-500 hover:text-white transition"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="p-6 space-y-5">
        
        <div>
          <label for="char-name" class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
            {m.create_char_label_name()}
          </label>
          <input 
            id="char-name"
            type="text" 
            bind:value={name}
            placeholder={m.create_char_placeholder_name()}
            class="w-full bg-ryokan-bg border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-ryokan-accent/50 transition-colors"
          />
        </div>

        <div>
          <label for="char-desc" class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
            {m.create_char_label_desc()}
          </label>
          <textarea 
            id="char-desc"
            bind:value={description}
            rows="3"
            placeholder={m.create_char_placeholder_desc()}
            class="w-full bg-ryokan-bg border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-ryokan-accent/50 transition-colors resize-none"
          ></textarea>
        </div>

        <div>
          <label for="char-greeting" class="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
            {m.create_char_label_greeting()}
          </label>
          <textarea 
            id="char-greeting"
            bind:value={greeting}
            rows="2"
            placeholder={m.create_char_placeholder_greeting()}
            class="w-full bg-ryokan-bg border border-white/10 rounded-xl px-4 py-3 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-ryokan-accent/50 transition-colors resize-none"
          ></textarea>
        </div>

      </div>

      <div class="px-6 py-4 bg-white/5 border-t border-white/5 flex justify-end gap-3">
        <button 
          on:click={close}
          class="px-4 py-2 text-sm text-gray-400 hover:text-white transition font-medium"
        >
          {m.create_char_btn_cancel()}
        </button>
        <button 
          on:click={handleSave}
          disabled={!name || !description || isSaving}
          class="px-6 py-2 bg-ryokan-accent text-ryokan-bg rounded-full text-sm font-bold hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-ryokan-accent/20"
        >
          {#if isSaving}
            {m.create_char_btn_saving()}
          {:else}
            {m.create_char_btn_save()}
          {/if}
        </button>
      </div>

    </div>
  </div>
{/if}