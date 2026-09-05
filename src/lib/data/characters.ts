import * as m from '$lib/paraglide/messages';
import emmaAvatar from '$lib/assets/avatars/emma.webp';
import kaelenAvatar from '$lib/assets/avatars/kaelen.webp';

export const CHARACTERS = [
  { 
    id: 1,
    name: m.char_emma_name(), 
    prompt: [m.char_emma_desc(), m.char_emma_personality(), m.char_emma_scenario(), m.char_emma_example()].filter(Boolean).join('\n\n'),
    color: "bg-amber-600",
    initials: "E",
    greeting: m.char_emma_greeting(),
    avatarUrl: emmaAvatar,
    world_info_ids: ['wi-emma-campus'],
  },
  { 
    id: 2, 
    name: m.char_kaelen_name(), 
    prompt: [m.char_kaelen_desc(), m.char_kaelen_personality(), m.char_kaelen_scenario(), m.char_kaelen_example()].filter(Boolean).join('\n\n'),
    color: "bg-stone-700",
    initials: "K",
    greeting: m.char_kaelen_greeting(),
    avatarUrl: kaelenAvatar,
    world_info_ids: ['wi-kaelen-guild'],
  }
];