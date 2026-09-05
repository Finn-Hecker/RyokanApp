import * as m from '$lib/paraglide/messages';
import maraAvatar from '$lib/assets/avatars/mara.webp';
import ilyanAvatar from '$lib/assets/avatars/ilyan.webp';

export const CHARACTERS = [
  {
    id: 1,
    name: m.char_mara_name(),
    prompt: m.char_mara_prompt(),
    color: "bg-amber-600",
    play_mode: 'solo' as const,
    initials: "M",
    greeting: m.char_mara_greeting(),
    avatarUrl: maraAvatar,
    alternate_greetings: [],
    world_info_ids: [],
  },
  {
    id: 2,
    name: m.char_ilyan_name(),
    prompt: m.char_ilyan_prompt(),
    color: "bg-stone-700",
    play_mode: 'solo' as const,
    initials: "I",
    greeting: m.char_ilyan_greeting(),
    avatarUrl: ilyanAvatar,
    alternate_greetings: [],
    world_info_ids: [],
  }
];
