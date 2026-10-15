<script lang="ts">
  import AvatarPicker from './AvatarPicker.svelte';
  import CharacterFormFields from './CharacterFormFields.svelte';
  import CharacterPlayMode from './CharacterPlayMode.svelte';
  import type { PlayMode } from '$lib/stores/characterStore.svelte';
  import type { BundledRoleSnapshot, RolePolicy } from '$lib/stores/characterStore.svelte';
  import BundledRolesPicker from './BundledRolesPicker.svelte';
  import type { CardMode } from '$lib/chat/cardMode';

  let {
    name = $bindable(''),
    prompt = $bindable(''),
    greeting = $bindable(''),
    alternate_greetings = $bindable([]),
    playMode = $bindable('solo'),
    mode = $bindable('character'),
    worldInfoIds = $bindable([]),
    rolePolicy = $bindable('open'),
    bundledRoles = [],
    avatarPreview = null,
    snapshotMode = false,
    onAvatarFile,
    onAddRole,
    onRemoveRole,
  }: {
    name?: string;
    prompt?: string;
    greeting?: string;
    alternate_greetings?: string[];
    playMode?: PlayMode;
    mode?: CardMode;
    worldInfoIds?: string[];
    rolePolicy?: RolePolicy;
    bundledRoles?: BundledRoleSnapshot[];
    avatarPreview?: string | null;
    snapshotMode?: boolean;
    onAvatarFile?: (file: File) => void;
    onAddRole?: (roleId: string) => Promise<void> | void;
    onRemoveRole?: (snapshotId: string) => Promise<void> | void;
  } = $props();

  $effect(() => {
    if (playMode === 'multiplayer') mode = 'character';
  });
</script>

<AvatarPicker
  {avatarPreview}
  storyCover
  onFileSelected={(file) => onAvatarFile?.(file)}
/>

<CharacterFormFields
  {mode}
  bind:name
  bind:prompt
  bind:greeting
  bind:worldInfoIds
  showAlternateGreetings={!snapshotMode}
  alternate_greetings={alternate_greetings}
  onAltGreetingsChange={(updated) => (alternate_greetings = updated)}
  onAltGreetingsAdd={() =>
    (alternate_greetings = [...alternate_greetings, ''])
  }
  onAltGreetingsRemove={(index) =>
    (alternate_greetings =
      alternate_greetings.filter((_, i) => i !== index))
  }
/>

{#if !snapshotMode}
{#if mode !== 'story'}
<BundledRolesPicker bind:rolePolicy {bundledRoles} onAdd={onAddRole} onRemove={onRemoveRole} />
{/if}

<CharacterPlayMode bind:playMode />
{/if}
