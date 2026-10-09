<script lang="ts">
  import { onMount } from 'svelte';
  import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CharacterAvatar from '$lib/components/lobby/CharacterAvatar.svelte';
  import { characterState, ensureLobbyCharactersLoaded, type Character } from '$lib/stores/characterStore.svelte';
  import { ensureRolesLoaded, roleState } from '$lib/stores/roleStore.svelte';
  import type { ChatRoleSnapshot } from '$lib/stores/chatStore.svelte';
  import { createGroupChat, type GroupParticipantInput } from '$lib/stores/groupChatStore.svelte';
  import { selectInitialGreeting } from '$lib/chat/characterGreeting';
  import { groupPersonaOptions } from '$lib/chat/groupPersonaOptions';

  let { initialCharacter = null, initialPersona = undefined, existingIds = [], fixedPersona = undefined, onAdd, onCreated, onClose }: {
    initialCharacter?: Character | null;
    initialPersona?: ChatRoleSnapshot | null;
    existingIds?: string[];
    fixedPersona?: ChatRoleSnapshot | null;
    onAdd?: (participant: GroupParticipantInput) => Promise<void>;
    onCreated?: () => void;
    onClose: () => void;
  } = $props();
  let selectedIds = $state<string[]>(initialCharacter ? [String(initialCharacter.id)] : []);
  let search = $state('');
  let title = $state('');
  let personaKey = $state(initialPersona === undefined ? '' : JSON.stringify(initialPersona ? [initialPersona.name, initialPersona.prompt] : null));
  let busy = $state(false);
  let loading = $state(true);
  let error = $state('');
  let cards = $derived(characterState.allCharacters.filter(card => card.play_mode === 'solo'
    && !existingIds.includes(String(card.id)) && (!characterState.hiddenCharacterIds.has(String(card.id)) || selectedIds.includes(String(card.id)))));
  let selected = $derived(selectedIds.map(id => cards.find(card => String(card.id) === id)).filter((card): card is Character => !!card));
  let options = $derived(groupPersonaOptions(selected, roleState.roles).filter(option => fixedPersona === undefined
    || (option.persona === null ? fixedPersona === null : !!fixedPersona && option.persona.name === fixedPersona.name && option.persona.prompt === fixedPersona.prompt)));
  let chosen = $derived(options.find(option => option.key === personaKey));
  let canSave = $derived(!loading && !busy && selected.length >= (onAdd ? 1 : 2) && !!chosen);
  $effect(() => {
    if (loading) return;
    if (!options.some(option => option.key === personaKey)) {
      const defaultRole = roleState.roles.find(role => role.id === roleState.defaultRoleId);
      personaKey = (options.find(option => defaultRole && option.persona?.name === defaultRole.name
        && option.persona.prompt === defaultRole.prompt) ?? options[0])?.key ?? '';
    }
  });
  onMount(() => {
    void Promise.all([ensureLobbyCharactersLoaded(), ensureRolesLoaded()])
      .catch(() => { error = 'Charaktere oder Personas konnten nicht geladen werden.'; })
      .finally(() => { loading = false; });
  });
  function toggle(card: Character) {
    const id = String(card.id);
    selectedIds = selectedIds.includes(id) ? selectedIds.filter(item => item !== id)
      : onAdd ? [id] : [...selectedIds, id];
    error = '';
  }
  async function save() {
    if (!canSave || !chosen) return;
    busy = true;
    error = '';
    const participants = selected.map((card, index): GroupParticipantInput => ({
      character_id: String(card.id), role_selection: chosen!.selections[index],
      initial_message: selectInitialGreeting(card) ?? '',
      character_snapshot: { id: String(card.id), name: card.name, prompt: card.prompt,
        greeting: card.greeting, initials: card.initials, color: card.color,
        avatarUrl: card.avatarUrl, world_info_ids: [...(card.world_info_ids ?? [])] },
    }));
    try {
      if (onAdd) { await onAdd(participants[0]); onClose(); }
      else { await createGroupChat(participants, title); onCreated?.(); }
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }
</script>

<BottomSheet {onClose} dismissible={!busy} label={onAdd ? 'Teilnehmer hinzufügen' : 'Gruppenchat erstellen'} maxHeight="calc(var(--app-visible-height, 100dvh) * .85)">
  {#snippet header()}
    <h2>{onAdd ? 'Teilnehmer hinzufügen' : 'Gruppenchat erstellen'}</h2>
    <p>{onAdd ? 'Die gemeinsame Persona dieses Chats muss zur Card passen.' : 'Wähle mindestens zwei Charaktere und eine gemeinsame Persona.'}</p>
  {/snippet}
  {#snippet children()}
    <fieldset disabled={busy || loading} class="space-y-4 border-0 p-0 min-w-0">
      {#if !onAdd}<label class="block text-sm">Titel (optional)<input bind:value={title} class="field" /></label>{/if}
      <label class="block text-sm">Charakter suchen<input bind:value={search} class="field" type="search" /></label>
      <p class="text-sm text-gray-400" aria-live="polite">{loading ? 'Lädt…' : `${selected.length} ausgewählt`}</p>
      <div class="space-y-2">
        {#each cards.filter(card => card.name.toLowerCase().includes(search.toLowerCase())) as card (card.id)}
          <button type="button" class="card" class:selected={selectedIds.includes(String(card.id))} aria-pressed={selectedIds.includes(String(card.id))} onclick={() => toggle(card)}>
            <span class="w-10 h-10 shrink-0 rounded-xl overflow-hidden"><CharacterAvatar char={card} fallbackTextClass="text-sm" /></span>
            <span class="min-w-0 flex-1 truncate">{card.name}</span>
            <span aria-hidden="true">{selectedIds.includes(String(card.id)) ? '✓' : '+'}</span>
          </button>
        {/each}
        {#if !cards.length}<p class="text-sm text-gray-400">Keine weiteren sichtbaren Character Cards verfügbar.</p>{/if}
      </div>
      <label class="block text-sm">Gemeinsame Persona
        <select bind:value={personaKey} class="field">
          {#each options as option (option.key)}<option value={option.key}>{option.persona?.name ?? 'Ohne Persona'}</option>{/each}
        </select>
      </label>
      {#if selected.length && !options.length}<p class="text-sm text-amber-400">Diese Cards erlauben keine gemeinsame Persona. Wähle andere Charaktere oder passe ihre gebündelten Rollen in der Bibliothek an.</p>{/if}
    </fieldset>
    {#if error}<p role="alert" class="mt-3 text-sm text-red-400">{error}</p>{/if}
  {/snippet}
  {#snippet footer(close)}
    <div class="sheet-footer-actions">
      <Button disabled={busy} onclick={close}>Abbrechen</Button>
      <Button variant="primary" disabled={!canSave} onclick={save}>{busy ? 'Speichert…' : onAdd ? 'Hinzufügen' : 'Chat starten'}</Button>
    </div>
  {/snippet}
</BottomSheet>
<style>
  .field { display:block; width:100%; margin-top:6px; padding:10px; border:1px solid var(--sheet-divider); border-radius:10px; background:var(--sheet-surface); color:var(--sheet-text); }
  .card { display:flex; align-items:center; gap:12px; width:100%; padding:10px; border:1px solid var(--sheet-divider); border-radius:12px; text-align:left; color:var(--sheet-text); }
  .card.selected { border-color:var(--sheet-selected-border); background:var(--sheet-selected); }
</style>
