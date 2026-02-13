import * as m from '$lib/paraglide/messages';

export const CHARACTERS = [
  { 
    id: 1,
    name: m.char_seraphina_name(), 
    desc: m.char_seraphina_desc(), 
    color: "bg-purple-500", 
    initials: "S",
    greeting: m.char_seraphina_greeting(),
  },
  { 
    id: 3, 
    name: m.char_barkeeper_name(), 
    desc: m.char_barkeeper_desc(), 
    color: "bg-orange-500", 
    initials: "B",
    greeting: m.char_barkeeper_greeting(),
  }
];