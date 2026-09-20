import * as m from '$lib/paraglide/messages';

import scenarioBadPlan from '$lib/assets/avatars/scenario_bad_plan.webp';
import scenarioNightShift from '$lib/assets/avatars/scenario_night_shift.webp';
import scenarioIslandPrison from '$lib/assets/avatars/scenario_island_prison.webp';

export const SOLO_CHARACTERS = [
  {
    id: 1,
    name: m.scenario_lyvee_name(),
    description: m.scenario_lyvee_description(),
    prompt: m.scenario_lyvee_prompt(),
    color: "bg-amber-600",
    play_mode: 'solo' as const,
    initials: "LY",
    greeting: m.scenario_lyvee_greeting(),
    avatarUrl: scenarioBadPlan,
    alternate_greetings: [],
    world_info_ids: [],
    role_policy: 'open' as const,
    bundled_roles: [],
  },
  {
    id: 2,
    name: m.scenario_klea_name(),
    description: m.scenario_klea_description(),
    prompt: m.scenario_klea_prompt(),
    color: "bg-stone-700",
    play_mode: 'solo' as const,
    initials: "KL",
    greeting: m.scenario_klea_greeting(),
    avatarUrl: scenarioNightShift,
    alternate_greetings: [],
    world_info_ids: [],
    role_policy: 'open' as const,
    bundled_roles: [],
  }
];

export const MULTIPLAYER_CHARACTERS = [
  {
    id: 3,
    name: m.scenario_island_prison_name(),
    description: m.scenario_island_prison_description(),
    prompt: m.scenario_island_prison_prompt(),
    color: "bg-sky-900",
    play_mode: 'multiplayer' as const,
    initials: "IP",
    greeting: m.scenario_island_prison_greeting(),
    avatarUrl: scenarioIslandPrison,
    alternate_greetings: [],
    world_info_ids: [],
    role_policy: 'open' as const,
    bundled_roles: [],
  }
];

export const CHARACTERS = [
  ...SOLO_CHARACTERS,
  ...MULTIPLAYER_CHARACTERS
];
