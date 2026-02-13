import * as m from '$lib/paraglide/messages';

export const CHARACTERS = [
  { 
    id: 1,
    name: m.char_yumi_name(), 
    desc: m.char_yumi_desc(), 
    color: "bg-rose-500",
    initials: "Y",
    greeting: m.char_yumi_greeting()
  },
  { 
    id: 2, 
    name: m.char_kaito_name(), 
    desc: m.char_kaito_desc(), 
    color: "bg-indigo-600",
    initials: "K",
    greeting: m.char_kaito_greeting()
  }
];