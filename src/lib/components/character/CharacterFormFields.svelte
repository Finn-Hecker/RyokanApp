<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import AltGreetings from './AltGreetings.svelte';
  import { createEventDispatcher } from 'svelte';

  export let name = '';
  export let description = '';
  export let personality = '';
  export let scenario = '';
  export let greeting = '';
  export let mes_example = '';
  export let alternate_greetings: string[] = [];

  const dispatch = createEventDispatcher<{
    altGreetingsChange: string[];
    altGreetingsAdd: void;
    altGreetingsRemove: number;
  }>();

  const fieldWrap = 'bg-white/[0.03] border border-white/[0.06] rounded-2xl p-1 focus-within:border-ryokan-accent/50 focus-within:bg-white/[0.05] transition-colors hover:border-white/[0.09]';
  const labelClass = 'block text-[10px] uppercase tracking-wider text-gray-500 px-4 pt-3';
  const textareaClass = 'w-full bg-transparent border-none text-gray-300 px-4 pb-3 pt-1 text-sm focus:ring-0 placeholder-gray-700 resize-none leading-relaxed';
</script>

<div class="space-y-6">

  <div class={fieldWrap}>
    <label for="character-name" class={labelClass}>{m.create_page_label_name()}</label>
    <input
      id="character-name"
      type="text"
      bind:value={name}
      class="w-full bg-transparent border-none text-white px-4 pb-3 pt-1 text-lg focus:ring-0 placeholder-gray-700"
      placeholder={m.create_page_placeholder_name()}
    />
  </div>

  <div class={fieldWrap}>
    <label for="character-description" class={labelClass}>{m.create_page_label_desc()}</label>
    <textarea
      id="character-description"
      bind:value={description}
      rows="6"
      class={textareaClass}
      placeholder={m.create_page_placeholder_desc()}></textarea>
  </div>

  <div class={fieldWrap}>
    <label for="character-greeting" class={labelClass}>{m.create_page_label_greeting()}</label>
    <textarea
      id="character-greeting"
      bind:value={greeting}
      rows="4"
      class={textareaClass}
      placeholder={m.create_page_placeholder_greeting()}></textarea>
  </div>

  <AltGreetings
    greetings={alternate_greetings}
    on:change={(e) => dispatch('altGreetingsChange', e.detail)}
    on:add={() => dispatch('altGreetingsAdd')}
    on:remove={(e) => dispatch('altGreetingsRemove', e.detail)}
  />

  <div class="pt-6 pb-2">
    <h3 class="text-[10px] font-bold text-ryokan-accent uppercase tracking-[0.2em] px-4">
      {m.create_page_header_advanced()}
    </h3>
  </div>

  <div class={fieldWrap}>
    <label for="char-personality" class={labelClass}>{m.create_page_label_personality()}</label>
    <textarea
      id="char-personality"
      bind:value={personality}
      rows="3"
      class={textareaClass}
      placeholder={m.create_page_placeholder_personality()}></textarea>
  </div>

  <div class={fieldWrap}>
    <label for="char-scenario" class={labelClass}>{m.create_page_label_scenario()}</label>
    <textarea
      id="char-scenario"
      bind:value={scenario}
      rows="3"
      class={textareaClass}
      placeholder={m.create_page_placeholder_scenario()}></textarea>
  </div>

  <div class={fieldWrap}>
    <label for="char-mes-example" class={labelClass}>{m.create_page_label_mes_example()}</label>
    <textarea
      id="char-mes-example"
      bind:value={mes_example}
      rows="4"
      class="{textareaClass} font-mono text-xs"
      placeholder={m.create_page_placeholder_mes_example()}></textarea>
  </div>

</div>