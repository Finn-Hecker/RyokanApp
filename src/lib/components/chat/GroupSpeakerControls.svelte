<script lang="ts">
  import type { GroupParticipant } from '$lib/chat/groupChatData';
  import { MAX_GROUP_RESPONSES } from '$lib/ai/generation/groupSpeakerSelection';
  let { participants, speaker = $bindable('auto'), responses = $bindable(1), disabled = false,
    status = '', onContinue }: {
    participants: GroupParticipant[]; speaker?: string; responses?: number; disabled?: boolean;
    status?: string; onContinue: () => void;
  } = $props();
  let active = $derived(participants.filter(item => item.is_active));
  const limit = MAX_GROUP_RESPONSES;
  $effect(() => {
    if (speaker !== 'auto' && !active.some(item => item.id === speaker)) speaker = 'auto';
    if (!Number.isSafeInteger(responses) || responses < 1) responses = 1;
    if (limit && responses > limit) responses = limit;
  });
</script>
<div class="pointer-events-auto mb-2 rounded-xl border border-white/10 bg-ryokan-sidebar px-3 py-2">
  <div class="flex flex-wrap items-end gap-2">
    <label class="min-w-0 flex-1 text-xs text-gray-400">Nächste Antwort
      <select bind:value={speaker} disabled={disabled} class="control w-full">
        <option value="auto">Automatische Rotation</option>
        {#each active as participant (participant.id)}
          <option value={participant.id}>{participant.character_snapshot.name} · {participant.id.slice(0, 8)}</option>
        {/each}
      </select>
    </label>
    {#if speaker === 'auto'}
      <label class="text-xs text-gray-400">Antworten
        <select bind:value={responses} disabled={disabled} class="control">
          {#each Array.from({ length: limit }, (_, i) => i + 1) as count}<option value={count}>{count}</option>{/each}
        </select>
      </label>
    {/if}
    <button type="button" disabled={disabled || active.length < 2} onclick={onContinue}
      class="control text-ryokan-accent disabled:opacity-40">Fortsetzen</button>
  </div>
  <p class="mt-1 text-xs text-gray-500">Pro Start höchstens acht Antworten, danach stoppt die Rotation.</p>
  {#if status}<p role="status" class="mt-2 text-xs text-ryokan-accent">{status}</p>{/if}
</div>
<style>
  .control { display:block; margin-top:4px; min-height:36px; border:1px solid rgba(255,255,255,.1); border-radius:8px; padding:6px 8px; background:var(--ryokan-bg, #14141a); color:inherit; font-size:12px; }
</style>
