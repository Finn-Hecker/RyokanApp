<script lang="ts">
  import AvatarPicker from './AvatarPicker.svelte';
  import CharacterFormFields from './CharacterFormFields.svelte';
  import type { PlayMode } from '$lib/stores/characterStore.svelte';

  let {
    name = $bindable(''),
    prompt = $bindable(''),
    greeting = $bindable(''),
    alternate_greetings = $bindable([]),
    playMode = $bindable('solo'),
    worldInfoIds = $bindable([]),
    avatarPreview = null,
    onAvatarFile
  }: {
    name?: string;
    prompt?: string;
    greeting?: string;
    alternate_greetings?: string[];
    playMode?: PlayMode;
    worldInfoIds?: string[];
    avatarPreview?: string | null;
    onAvatarFile?: (file: File) => void;
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
  bind:playMode
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
