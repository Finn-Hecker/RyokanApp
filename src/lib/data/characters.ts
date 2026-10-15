import * as m from '$lib/paraglide/messages';

import scenarioLyvee from '$lib/assets/avatars/lyvee.webp';
import scenarioKlea from '$lib/assets/avatars/klea.webp';
import scenarioElla from '$lib/assets/avatars/scenario_ella.webp';

export const SOLO_CHARACTERS = [
  {
    id: 1,
    mode: 'story' as const,
    name: m.scenario_lyvee_name(),
    description: m.scenario_lyvee_description(),
    prompt: m.scenario_lyvee_prompt(),
    color: "bg-amber-600",
    play_mode: 'solo' as const,
    initials: "LY",
    greeting: m.scenario_lyvee_greeting(),
    avatarUrl: scenarioLyvee,
    alternate_greetings: [],
    world_info_ids: [],
    role_policy: 'open' as const,
    bundled_roles: [],
  },
  {
    id: 2,
    mode: 'story' as const,
    name: m.scenario_klea_name(),
    description: m.scenario_klea_description(),
    prompt: m.scenario_klea_prompt(),
    color: "bg-stone-700",
    play_mode: 'solo' as const,
    initials: "KL",
    greeting: m.scenario_klea_greeting(),
    avatarUrl: scenarioKlea,
    alternate_greetings: [],
    world_info_ids: [],
    role_policy: 'open' as const,
    bundled_roles: [],
  }
];

export const MULTIPLAYER_CHARACTERS = [
  {
    id: 3,
    mode: 'character' as const,
    name: m.scenario_ella_name(),
    description: m.scenario_ella_description(),
    prompt: m.scenario_ella_prompt(),
    color: "bg-emerald-900",
    play_mode: 'multiplayer' as const,
    initials: "EL",
    greeting: m.scenario_ella_greeting(),
    avatarUrl: scenarioElla,
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

/** Only used to backfill chats predating persisted card snapshots. */
export const LEGACY_SOLO_CHARACTERS = [
  { id: 1, name: m.legacy_scenario_lyvee_name(), prompt: m.legacy_scenario_lyvee_prompt(), greeting: m.legacy_scenario_lyvee_greeting(), mode: 'character' as const },
  { id: 2, name: m.legacy_scenario_klea_name(), prompt: m.legacy_scenario_klea_prompt(), greeting: m.legacy_scenario_klea_greeting(), mode: 'character' as const },
];
