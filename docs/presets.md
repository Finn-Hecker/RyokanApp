# Native generation presets (V1)

Presets are reusable templates, stored independently under `generation_presets_v1`
in the settings table. Library entries have a local preset ID and a native document.
The exported document has `format: "ryokan.preset"` and `version: 1`; it does not
contain the library ID, connection ID, model, endpoint, credentials or capability caches.
There is no SillyTavern import, compatibility layer or passthrough metadata.

## Configuration

- `generation`: temperature, multiplicative repetitionPenalty, topP, topK, minP
  and frequencyPenalty. Each has an explicit numeric `value` and boolean `enabled`.
  Disabled settings retain their values, but are not sent through typed controls.
- `prompt`: plain `system` and `postHistory` instructions. Empty system text uses
  the existing roleplay instructions. Character, player role, memory and world
  context remain application-owned. Post-history text is a labelled instruction at
  the end of the conversation on every provider, appended to the final user turn
  or placed in a new user turn after an assistant. It is never hoisted into native
  Anthropic/Gemini system fields. Normal system prompt behavior is unchanged.
  These fields do not evaluate macros or arbitrary code.
- `providers`: blocks keyed by Ryokan provider kind, containing maxTokens,
  thinkingBudget, reasoningLevel, serviceTier and additionalParameters. Output
  limits stay provider-bound because their thinking accounting differs. Custom JSON
  preserves objects, arrays, false, zero and null, including native thinking settings.
  Existing provider validation, capability gating and custom override precedence apply.

Additive presence penalties have no typed V1 preset control; they can be expressed
through the appropriate provider's custom JSON. They must never be mapped onto
`repetitionPenalty`. Profiles still serialize the legacy `presencePenalty` spelling,
and Tauri IPC retains its legacy payload spelling, solely for backwards compatibility.
Runtime code and native presets use the correct repetition name. LM Studio maps
that capability to its documented `repeat_penalty` wire field. Ollama's compatible
endpoint advertises only additive penalties: the UI warns about multiplicative
repetition, and typed repetition is omitted there. Explicit custom additive fields
remain independent; repetition is never converted into presence penalty.

Provider references: [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions),
[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).

## Apply and edit

Create starts with the current connection's settings. Edit uses an isolated draft,
and updates the current provider block while retaining any other provider blocks.
Changing a preset does not implicitly change a connection. Apply resolves the
template into the selected profile and persists that profile before future request
snapshots. Library edits never implicitly alter connection settings or requests.

`appliedPresetId` retains the selected library association for restoration and
safe deletion. The Active badge additionally requires the entire effective
configuration to match that library entry resolved from the original manual
baseline. This includes disabled values, switches, prompts, the matching provider
block and custom JSON (compared by value, not formatting/key order). Manual edits
or library replacements that change effective settings remove the badge and allow
reapplication. Renames and changes to other provider blocks do not change the
connection's effective configuration. Modified sessions still offer Deactivate.
Imports create new IDs, so matching names never replace an applied entry.

Shared generation and prompt settings are replaced on Apply. Only the matching
provider block is applied. If it is absent, that connection's provider-specific
settings use the original manual baseline, with a notice in the UI. Endpoints, credentials, model,
context detection, memory strategy and summary connection selection stay unchanged.
The first activation persists an allowlisted `presetRestoreSnapshot` alongside
`appliedPresetId` in that connection's profile. It holds only preset-controlled
generation values and switches, provider controls, original custom JSON and prompts.
Private restore capture preserves raw custom JSON, including valid URL-valued
parameters and unfinished editor drafts; portable validation does not apply to
this local data. The allowlist excludes connection identity, model, endpoint,
credentials, context/memory policy and capability caches. Imports/exports retain
their strict validation. The baseline persists independently of the association.
Switching presets keeps this baseline and resolves each new preset against it.
Deactivate restores it exactly, clears the association and removes the snapshot,
while retaining the library entry. Deleting an associated preset, including a
modified association, performs the same restoration for every affected connection
before deleting the library entry.
Persistence errors roll back profile changes; failed library deletion restores
the previous profiles and their persisted associations and snapshots.

Changing provider kind or switching between built-in/custom mode ends the preset
session before changing identity. Shared generation/prompt settings first restore
the original manual baseline; provider-bound maxTokens/thinkingBudget values and
switches, reasoning, service tier and custom JSON reset to connection defaults.
The old association and snapshot are cleared, so neither preset blocks nor manual
provider-specific JSON leak into the new context. A later Apply starts a fresh
baseline in the new provider and resolves its matching block; a missing block
uses that new baseline. Deactivate afterwards restores that new baseline. Model
and endpoint changes within the same provider kind retain the resolved settings:
V1 blocks are keyed by provider kind, not model/endpoint, and request capabilities
continue to be evaluated for the selected model. Manual profiles without a preset
session retain their existing provider-selection behavior.

Older profiles without preset state remain manual. An older applied association
without a restore snapshot cannot recover settings already overwritten before this
feature; it cannot earn an Active badge without a baseline, and its current
settings become the baseline on the next activation.

Normal chat and multiplayer use the resulting profile snapshots. Summary generation
continues to use its selected profile's generation settings and its own summary prompt
and output cap; roleplay instructions must not change the summary task. Prompt changes
participate in the existing generation fingerprint and token budget measurement.

## Native JSON boundary

V1 imports validate the exact supported structure and refuse unsupported versions,
unknown fields, non-finite/out-of-range numbers, protected request fields and custom
authentication/transport/session fields, including nested ones. JSON files are limited
to 1 MB, prompts to 100,000 characters each and custom nesting to 20 levels. Library
writes validate before persistence and publish only after success. An unreadable
library remains unavailable for editing rather than being silently overwritten.

Export reconstructs the allowlisted document instead of serializing a connection.
Import creates a new local library ID and never applies or overwrites a preset merely
because its name matches. Import/export preserve supported configuration values;
formatting and original JSON key order are not part of the contract.
