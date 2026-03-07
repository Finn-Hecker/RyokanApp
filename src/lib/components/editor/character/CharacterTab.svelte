<script lang="ts">
  import AvatarPicker from './AvatarPicker.svelte';
  import CharacterFormFields from './CharacterFormFields.svelte';

  let {
    name = $bindable(''),
    description = $bindable(''),
    personality = $bindable(''),
    scenario = $bindable(''),
    greeting = $bindable(''),
    mes_example = $bindable(''),
    creator_notes = $bindable(''),
    alternate_greetings = $bindable([]),
    worldInfoIds = $bindable([]),
    avatarPreview = null,
    onAvatarFile
  }: {
    name?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    greeting?: string;
    mes_example?: string;
    creator_notes?: string;
    alternate_greetings?: string[];
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
  bind:description
  bind:personality
  bind:scenario
  bind:greeting
  bind:mes_example
  bind:worldInfoIds
  alternate_greetings={alternate_greetings}
  onAltGreetingsChange={(updated) => (alternate_greetings = updated)}
  onAltGreetingsAdd={()     => (alternate_greetings = [...alternate_greetings, ''])}
  onAltGreetingsRemove={(index) => (alternate_greetings = alternate_greetings.filter((_, i) => i !== index))}
/>