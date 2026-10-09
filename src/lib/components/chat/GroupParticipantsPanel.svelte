<script lang="ts">
  import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CharacterTab from '$lib/components/editor/character/CharacterTab.svelte';
  import { readImageAsDataUrl } from '$lib/components/editor/character/characterLogic';
  import { chatState } from '$lib/stores/chatStore.svelte';
  import { addGroupParticipant, setGroupParticipantActive, reorderGroupParticipants, updateGroupParticipant } from '$lib/stores/groupChatStore.svelte';
  import type { GroupCharacterSnapshot, GroupParticipant } from '$lib/chat/groupChatData';
  import GroupCharacterPicker from './GroupCharacterPicker.svelte';

  let { onClose, disabled = false }: { onClose: () => void; disabled?: boolean } = $props();
  const chatId = chatState.activeChatId!;
  let busy = $state(false);
  let readingAvatar = $state(false);
  let error = $state('');
  let adding = $state(false);
  let editingId = $state<string | null>(null);
  let draft = $state<GroupCharacterSnapshot | null>(null);
  let participants = $derived(chatState.activeGroupParticipants);
  let activeCount = $derived(participants.filter(item => item.is_active).length);
  let locked = $derived(busy || readingAvatar || disabled);

  async function change(action: () => Promise<void>) {
    if (locked || chatState.activeChatId !== chatId) return;
    busy = true;
    error = '';
    try { await action(); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }
  function edit(participant: GroupParticipant) {
    editingId = participant.id;
    draft = { ...participant.character_snapshot, world_info_ids: [...(participant.character_snapshot.world_info_ids ?? [])] };
    error = '';
  }
  async function avatar(file: File) {
    const currentDraft = draft;
    readingAvatar = true;
    try { const url = await readImageAsDataUrl(file); if (draft === currentDraft && draft) draft.avatarUrl = url; }
    catch { error = 'Das Avatar-Bild konnte nicht geladen werden.'; }
    finally { readingAvatar = false; }
  }
  async function save() {
    if (!draft || !editingId || !draft.name.trim() || !draft.prompt.trim()) return;
    const snapshot = { ...draft, initials: draft.name.slice(0, 1).toUpperCase() };
    const id = editingId;
    await change(async () => {
      await updateGroupParticipant(chatId, id, snapshot);
      draft = null;
      editingId = null;
    });
  }
  function move(index: number, direction: number) {
    const ids = participants.map(item => item.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    void change(() => reorderGroupParticipants(chatId, ids));
  }
</script>

<BottomSheet {onClose} dismissible={!busy && !readingAvatar} label="Teilnehmer" maxHeight="calc(var(--app-visible-height, 100dvh) * .85)">
  {#snippet header()}<h2>Teilnehmer</h2><p>{activeCount} aktiv · Änderungen gelten nur für diesen Chat.</p>{/snippet}
  {#snippet children()}
    {#if draft}
      <fieldset disabled={locked} class="border-0 p-0 min-w-0">
        <CharacterTab snapshotMode bind:name={draft.name} bind:prompt={draft.prompt} bind:greeting={draft.greeting}
          bind:worldInfoIds={draft.world_info_ids} avatarPreview={draft.avatarUrl ?? null} onAvatarFile={avatar} />
      </fieldset>
      <div class="flex justify-end gap-2 mt-4">
        <Button disabled={locked} onclick={() => { draft = null; editingId = null; }}>Abbrechen</Button>
        <Button disabled={locked || !draft.name.trim() || !draft.prompt.trim()} onclick={save}>Speichern</Button>
      </div>
    {:else}
      <div class="space-y-3">
        {#each participants as participant, index (participant.id)}
          <div class="rounded-xl border border-white/10 p-3" class:opacity-60={!participant.is_active}>
            <div class="flex items-center gap-3">
              <div class="h-10 w-10 shrink-0 rounded-xl overflow-hidden">
                {#if participant.character_snapshot.avatarUrl}
                  <img src={participant.character_snapshot.avatarUrl} alt={participant.character_snapshot.name} class="w-full h-full object-cover" />
                {:else}<div class="w-full h-full flex items-center justify-center {participant.character_snapshot.color}">{participant.character_snapshot.initials}</div>{/if}
              </div>
              <div class="min-w-0 flex-1"><p class="truncate">{participant.character_snapshot.name}</p><small class="text-gray-400">{participant.is_active ? 'Aktiv' : 'Inaktiv'} · {participant.id.slice(0, 8)}</small></div>
              <button aria-label={`${participant.character_snapshot.name} nach oben`} disabled={locked || index === 0} onclick={() => move(index, -1)} class="p-2 disabled:opacity-30">↑</button>
              <button aria-label={`${participant.character_snapshot.name} nach unten`} disabled={locked || index === participants.length - 1} onclick={() => move(index, 1)} class="p-2 disabled:opacity-30">↓</button>
            </div>
            <div class="mt-3 flex flex-wrap justify-end gap-2">
              <Button size="sm" disabled={locked} onclick={() => edit(participant)}>Bearbeiten</Button>
              <Button size="sm" disabled={locked || (participant.is_active && activeCount <= 2)} onclick={() => change(() => setGroupParticipantActive(chatId, participant.id, !participant.is_active))}>
                {participant.is_active ? 'Deaktivieren' : 'Reaktivieren'}
              </Button>
            </div>
          </div>
        {/each}
      </div>
      <p class="mt-4 text-xs text-gray-400">Mindestens zwei Teilnehmer bleiben aktiv. Deaktivierte Charaktere bleiben in bisherigen Nachrichten sichtbar.</p>
      <div class="mt-4"><Button disabled={locked} onclick={() => adding = true}>Teilnehmer hinzufügen</Button></div>
    {/if}
    {#if error}<p role="alert" class="mt-3 text-sm text-red-400">{error}</p>{/if}
  {/snippet}
</BottomSheet>
{#if adding}
  <GroupCharacterPicker existingIds={participants.map(item => item.character_id).filter((id): id is string => !!id)}
    fixedPersona={chatState.activeRoleSnapshot} onAdd={participant => addGroupParticipant(chatId, participant)} onClose={() => adding = false} />
{/if}
