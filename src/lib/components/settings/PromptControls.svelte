<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  let { systemPrompt, postHistoryPrompt, onSystemChange, onPostHistoryChange, prefix = 'connection' }: {
    systemPrompt: string;
    postHistoryPrompt: string;
    onSystemChange: (value: string) => void;
    onPostHistoryChange: (value: string) => void;
    prefix?: string;
  } = $props();

  function updateSystem(event: Event) {
    onSystemChange((event.currentTarget as HTMLTextAreaElement).value);
  }
  function updatePostHistory(event: Event) {
    onPostHistoryChange((event.currentTarget as HTMLTextAreaElement).value);
  }
</script>

<div class="prompt-fields">
  <label class="settings-label" for="{prefix}-system-prompt">{m.preset_system_label()}</label>
  <p>{m.preset_system_hint()}</p>
  <textarea id="{prefix}-system-prompt" class="settings-input" value={systemPrompt} oninput={updateSystem} rows="5" maxlength="100000"></textarea>
  <label class="settings-label" for="{prefix}-post-history">{m.preset_post_history_label()}</label>
  <p>{m.preset_post_history_hint()}</p>
  <textarea id="{prefix}-post-history" class="settings-input" value={postHistoryPrompt} oninput={updatePostHistory} rows="3" maxlength="100000"></textarea>
</div>

<style>
  .prompt-fields { display:flex; flex-direction:column; gap:8px; }
  .settings-label { margin:12px 0 0; }
  p { margin:0; color:#85858b; font-size:12px; line-height:1.5; }
  textarea { resize:vertical; min-height:80px; }
</style>
