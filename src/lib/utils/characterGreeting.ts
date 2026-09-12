export function selectInitialGreeting(character: {
  name: string;
  greeting?: string;
  alternate_greetings?: string[] | string;
}): string | null {
  const greetings: string[] = [];
  if (character.greeting?.trim()) greetings.push(character.greeting);

  try {
    const alternates = typeof character.alternate_greetings === 'string'
      ? JSON.parse(character.alternate_greetings)
      : character.alternate_greetings;
    if (Array.isArray(alternates)) {
      greetings.push(...alternates.filter(
        (greeting): greeting is string => typeof greeting === 'string' && greeting.trim().length > 0,
      ));
    }
  } catch (error) {
    console.warn('Could not parse alternative greetings:', error);
  }

  if (greetings.length === 0) return null;
  return greetings[Math.floor(Math.random() * greetings.length)]
    .replace(/\{\{char\}\}/gi, character.name)
    .replace(/\{\{user\}\}/gi, 'User');
}
