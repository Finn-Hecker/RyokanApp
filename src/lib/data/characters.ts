import * as m from '$lib/paraglide/messages';

export const CHARACTERS = [
  { 
    id: 1,
    name: m.char_seraphina_name(), 
    desc: m.char_seraphina_desc(), 
    color: "bg-purple-500", 
    initials: "S",
    greeting: "Hey! Schön dich zu sehen. Ich bin Seraphina. Was führt dich zu mir? Erzähl mir alles!"
  },
  { 
    id: 3, 
    name: m.char_barkeeper_name(), 
    desc: m.char_barkeeper_desc(), 
    color: "bg-orange-500", 
    initials: "B",
    greeting: "Willkommen in meiner Bar. Was darf ich dir einschenken? Oder willst du erst mal nur reden?"
  }
];