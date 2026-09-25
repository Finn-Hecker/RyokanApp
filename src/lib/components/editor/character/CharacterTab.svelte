<script lang="ts">
  import AvatarPicker from './AvatarPicker.svelte';
  import CharacterFormFields from './CharacterFormFields.svelte';
  import CharacterPlayMode from './CharacterPlayMode.svelte';
  import type { PlayMode } from '$lib/stores/characterStore.svelte';
  import type { BundledRoleSnapshot, RolePolicy } from '$lib/stores/characterStore.svelte';
  import BundledRolesPicker from './BundledRolesPicker.svelte';

  let {
    name = $bindable(''),
    prompt = $bindable(''),
    greeting = $bindable(''),
    alternate_greetings = $bindable([]),
    playMode = $bindable('solo'),
    worldInfoIds = $bindable([]),
    rolePolicy = $bindable('open'),
    bundledRoles = [],
    avatarPreview = null,
    onAvatarFile,
    onAddRole,
    onRemoveRole,
  }: {
    name?: string;
    prompt?: string;
    greeting?: string;
    alternate_greetings?: string[];
    playMode?: PlayMode;
    worldInfoIds?: string[];
    rolePolicy?: RolePolicy;
    bundledRoles?: BundledRoleSnapshot[];
    avatarPreview?: string | null;
    onAvatarFile?: (file: File) => void;
    onAddRole?: (roleId: string) => Promise<void> | void;
    onRemoveRole?: (snapshotId: string) => Promise<void> | void;
  } = $props();
</script>

<AvatarPicker
  {avatarPreview}
  onFileSelected={(file) => onAvatarFile?.(file)}
/>

<CharacterFormFields
  bind:name
  bind:prompt
  bind:greeting
  bind:worldInfoIds
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

<BundledRolesPicker bind:rolePolicy {bundledRoles} onAdd={onAddRole} onRemove={onRemoveRole} />

<CharacterPlayMode bind:playMode />
