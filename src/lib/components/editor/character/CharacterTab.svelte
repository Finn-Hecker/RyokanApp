<script lang="ts">
  import AvatarPicker from './AvatarPicker.svelte';
  import CharacterFormFields from './CharacterFormFields.svelte';

  let {
    name = $bindable(''),
    prompt = $bindable(''),
    greeting = $bindable(''),
    alternate_greetings = $bindable([]),
    playMode = $bindable('both'),
    worldInfoIds = $bindable([]),
    avatarPreview = null,
    onAvatarFile
  }: {
    name?: string;
    prompt?: string;
    greeting?: string;
    alternate_greetings?: string[];
    playMode?: 'solo' | 'multiplayer' | 'both';
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
