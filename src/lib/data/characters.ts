import * as m from '$lib/paraglide/messages';

import scenarioBadPlan from '$lib/assets/avatars/scenario_bad_plan.webp';
import scenarioNightShift from '$lib/assets/avatars/scenario_night_shift.webp';
import scenarioIslandPrison from '$lib/assets/avatars/scenario_island_prison.webp';

export const SOLO_CHARACTERS = [
  {
    id: 1,
    name: m.scenario_bad_plan_name(),
    description: m.scenario_bad_plan_description(),
    prompt: m.scenario_bad_plan_prompt(),
    color: "bg-amber-600",
    play_mode: 'solo' as const,
    initials: "BP",
    greeting: m.scenario_bad_plan_greeting(),
    avatarUrl: scenarioBadPlan,
    alternate_greetings: [],
    world_info_ids: [],
  },
  {
    id: 2,
    name: m.scenario_night_shift_name(),
    description: m.scenario_night_shift_description(),
    prompt: m.scenario_night_shift_prompt(),
    color: "bg-stone-700",
    play_mode: 'solo' as const,
    initials: "NS",
    greeting: m.scenario_night_shift_greeting(),
    avatarUrl: scenarioNightShift,
    alternate_greetings: [],
    world_info_ids: [],
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
  }
];

export const CHARACTERS = [
  ...SOLO_CHARACTERS,
  ...MULTIPLAYER_CHARACTERS
];