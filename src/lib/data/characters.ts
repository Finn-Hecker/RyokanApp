import * as m from '$lib/paraglide/messages';
import emmaAvatar from '$lib/assets/avatars/emma.png';
import kaelenAvatar from '$lib/assets/avatars/kaelen.png';

export const CHARACTERS = [
  { 
    id: 1,
    name: m.char_emma_name(), 
    desc: m.char_emma_desc(), 
    personality: m.char_emma_personality(),
    scenario: m.char_emma_scenario(),
    mes_example: m.char_emma_example(), 
    color: "bg-amber-600",
    initials: "E",
    greeting: m.char_emma_greeting(),
    avatarUrl: emmaAvatar
  },
  { 
    id: 2, 
    name: m.char_kaelen_name(), 
    desc: m.char_kaelen_desc(), 
    personality: m.char_kaelen_personality(),
    scenario: m.char_kaelen_scenario(),
    mes_example: m.char_kaelen_example(), 
    color: "bg-stone-700",
    initials: "K",
    greeting: m.char_kaelen_greeting(),
    avatarUrl: kaelenAvatar
  }
];