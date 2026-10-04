<script lang="ts">
  import Select from '$lib/components/ui/Select.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { PlayMode } from '$lib/stores/characterStore.svelte';

  let { playMode = $bindable('solo') }: { playMode?: PlayMode } = $props();
</script>

<div class="play-mode-field">
  <label for="character-play-mode">{m.create_page_label_play_mode()}</label>
  <Select id="character-play-mode" label={m.create_page_label_play_mode()} bind:value={playMode}
    items={[{ id: 'solo', label: m.create_page_play_mode_solo() }, { id: 'multiplayer', label: m.create_page_play_mode_multiplayer() }]} />
</div>

<style>
  .play-mode-field {
    margin-top: 16px;
    padding: 14px 18px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
  }

  label {
    display: block;
    margin-bottom: 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #9ca3af;
  }

</style>
