import type { Role } from '$lib/stores/roleStore.svelte';
import defaultPersonaAvatar from '$lib/assets/avatars/persona.png';
import * as m from '$lib/paraglide/messages';

export const DEFAULT_ROLES: Role[] = [
  {
    id: 'default-1',
    name: m.role_default_name(),
    bio: '',
    pronouns: 'they/them',
    avatarUrl: defaultPersonaAvatar,
  },
];