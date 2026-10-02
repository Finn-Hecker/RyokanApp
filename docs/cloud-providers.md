# Native cloud providers

NanoGPT, Anthropic and Google Gemini use separate adapters. Existing OpenRouter,
OpenAI, Grok, Custom and local providers retain their OpenAI-compatible protocol
and separate streaming path, with explicit completion/error checks.
Profiles use the existing fields and JSON storage; no migration is required.

| Provider | Official base URL | Authentication | Chat / stream |
| --- | --- | --- | --- |
| NanoGPT | `https://api.nano-gpt.com/api/v1` | Bearer token | `/chat/completions`, OpenAI-compatible SSE |
| Anthropic | `https://api.anthropic.com/v1` | `x-api-key`, `anthropic-version: 2023-06-01` | `/messages`, Messages SSE |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key` | `/models/{id}:streamGenerateContent?alt=sse` |

All three support model listing. Anthropic and Gemini pagination is followed.
Context sizes are taken from provider metadata, with Ryokan's existing manual cap
and conservative fallback when unavailable. Native input limits are conservatively
used as the planning window; output and safety reserves are still subtracted.

## Native token limits

For Anthropic and Gemini, the output setting is the **combined thinking and answer
cap**, not visible output plus an additional thinking allowance. Explicit native
JSON settings override the corresponding generated fields, and planning follows
the same merge. With the output switch off, Ryokan sends explicit caps of **4096
for Anthropic** and **8192 for Gemini**. These are application policies, not assumed
provider defaults. A native `max_tokens` / `generationConfig.maxOutputTokens`
override also overrides this fallback.

- Anthropic manual thinking uses `thinking: {type: "enabled", budget_tokens: N}`.
  The budget must be at least 1024 and below `max_tokens`. The manual control is
  exposed only when model metadata advertises this thinking type.
- Anthropic adaptive thinking uses `thinking: {type: "adaptive"}` and
  `output_config.effort`. The effort selector contains only advertised levels.
  Adaptive thinking has no numeric thinking budget. Newer models may require it
  and reject manual thinking; model/API restrictions remain authoritative.
- Gemini uses `generationConfig.thinkingConfig.thinkingBudget`, with `0` for
  disabling thinking where supported and `-1` for dynamic thinking. It also
  supports `thinkingLevel` on the documented newer models. Both share the overall
  `maxOutputTokens` cap. Do not set a numeric budget and a level together.
- Gemini model listing advertises thinking support, but not supported effort
  levels. Numeric controls use that metadata; `thinkingLevel` is available through
  native additional JSON. Model-specific ranges and restrictions are validated
  by Google's API. A budget may guide rather than strictly fix thinking usage.

Example Gemini additional parameters:

```json
{"generationConfig":{"maxOutputTokens":8192,"thinkingConfig":{"thinkingLevel":"HIGH","includeThoughts":true}}}
```

Existing provider budget calculations and Rolling Summary consistency mechanisms
are unchanged. Summary requests carry an explicit application intent; the Rust
boundary adds only the matching provider controls. Native adapters no longer need
to know the summary policy. The shared cloud boundary continues to discard foreign
reasoning/template fields from legacy native JSON settings. Models with default or always-on thinking may
spend part of a summary's total output allowance on thinking.

## Accounting and scope

Anthropic input usage includes uncached input, cache reads and cache creation so
Ryokan's prompt accounting has the same meaning across providers. Gemini's output
usage includes candidates plus thoughts; thoughts are also reported separately.
NanoGPT's reported USD account charges are preserved when explicitly identified
as USD. Missing counts, thinking usage or prices are not estimated.

These adapters implement Ryokan's text chat. Tools, native multimodal input,
external cached Gemini content and replay of encrypted thinking signatures are
not added. Gemini requires signatures for function calling, which this adapter
does not enable. Model lists are fetched live without hard-coded model catalogs.
Anthropic sampling controls are forwarded only for documented older model
families; newer/unknown families use API sampling defaults. Unsupported sampler
semantics (such as translating multiplicative repetition penalty to Gemini's
additive presence penalty) are deliberately omitted. Native adapters require
their official base URLs; alternate compatible endpoints remain available via
Custom.

## Official API references

- [NanoGPT API host](https://docs.nano-gpt.com/introduction),
  [chat](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion),
  [models](https://docs.nano-gpt.com/api-reference/endpoint/models),
  [SSE](https://docs.nano-gpt.com/api-reference/miscellaneous/streaming-protocol)
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create),
  [models](https://platform.claude.com/docs/en/api/models/list),
  [streaming](https://platform.claude.com/docs/en/build-with-claude/streaming),
  [thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Gemini generateContent](https://ai.google.dev/api/generate-content),
  [models](https://ai.google.dev/api/models),
  [thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)

Verified against these official references on 2026-10-02. Tests use deterministic
responses and local mock HTTP/SSE servers; no paid API calls or real keys are used.

## Patch file inventory and verification

New files:

- `src-tauri/src/ai/cloud.rs`
- `src-tauri/src/ai/cloud/nanogpt.rs`
- `src-tauri/src/ai/cloud/anthropic.rs`
- `src-tauri/src/ai/cloud/gemini.rs`
- `src-tauri/src/ai/cloud/tests.rs`
- `src/lib/utils/providerTokenBudget.ts`
- `src/lib/utils/providerTokenBudget.test.mjs`
- `docs/cloud-providers.md`

Modified files:

- `src-tauri/src/ai.rs` — dispatch branches for new providers only.
- `src-tauri/src/diagnostics.rs` — three additional provider identifiers.
- `src/lib/stores/appState.svelte.ts` — provider type union.
- `src/lib/utils/apiConnections.ts` — provider display names.
- `src/lib/utils/apiParameters.ts` — request-only native budget discriminator and
  native thinking switch; existing snapshots keep the same fields and values.
- `src/lib/utils/rollingSummaryCore.ts` — early native-budget dispatch; the
  complete legacy calculation below it is unchanged.
- `src/lib/utils/generationCapabilities.ts` — new providers' scoped metadata.
- `src/lib/utils/diagnosticDecisions.ts` — additional provider identifiers.
- `src/lib/utils/diagnosticsMetadata.ts` — additional provider identifiers.
- `src/lib/components/Onboarding.svelte` — new presets and native model lookup.
- `src/lib/components/settings/ApiSection.svelte` — new provider entries.
- `src/lib/components/settings/GeneralSection.svelte` — native total-cap notice.
- `src/lib/components/settings/ThinkingBudgetControl.svelte` — native controls
  gated by capabilities, Anthropic minimum and native budget explanation.
- `src/lib/utils/rollingSummaryRuntime.test.mjs` — profile round-trip, native
  generation/IPC and pre-request context-guard tests.

Validation on the final code:

- Full Rust suite: `cargo test --offline` — **96 passed**, including main and
  documentation test targets (0 tests in those targets).
- Full frontend suite: all `*.test.mjs` under `src` and `scripts` — **137 passed**.
- **17 new Rust tests and 10 new frontend tests**, covering native normal/manual/
  adaptive/dynamic requests, explicit legacy budget expectations across all eight
  existing provider kinds, near-limit rejection, model metadata, authentication,
  fragmented UTF-8 SSE, cumulative usage/cache accounting, errors/redaction,
  cancellation during connect and idle streaming, and profile compatibility.
- `npm run check` — **0 errors, 0 warnings**.
- `npm run build` — **successful**. Vite reported warnings about the mixed
  static/dynamic event import and large bundles; no build errors.
- `git diff --check` — **passed**.

No changes to database migrations, persisted profile structure, chat message
construction, existing provider streaming, or Rolling Summary orchestration.
No dependencies were added. Live authenticated provider calls remain untested.

## Architecture review implementation

Implemented on 2026-10-02 without new dependencies or a data migration.

### Review items

| Item | Result |
| --- | --- |
| 1.1 | Shared TypeScript provider catalog for onboarding, settings, labels, provider types and diagnostic metadata. Onboarding retains model metadata and correctly persists OpenAI/xAI/Custom identities. |
| 1.2 | Compatible streaming distinguishes completion, cancellation, malformed events and transport errors. Both `finish_reason` and `[DONE]` are accepted; usage after a finish event is still read. Native streaming remains separate. |
| 1.3 | Listener installation is inside cleanup guards. Chat has a local stop flag and summaries recheck cancellation immediately before invoking Rust. Reading HTTP error bodies is cancellation-aware. |
| 1.4 | Multiplayer measures provider-bound messages, custom fields, output and safety reserves. It retains a recent user-led suffix and rejects irreducible prompts before calling the provider. |
| 1.5 | Summary requests carry explicit `purpose: summary` and the native budget discriminator. Rust translates the intent to supported endpoint controls. Native mappers no longer know summary orchestration details. |
| 1.6 | Internal stream failures distinguish network, protocol, provider and IPC errors. Native connect/stream failures record the corresponding content-free diagnostics; provider messages retain redaction. |
| 1.7 | A boolean thinking state replaces the unused full thinking buffer. Visible answer text ends thinking; subsequent thought events can restart it. |
| 2.1 | Only identical compatible sampler emission was extracted for NanoGPT and the existing compatible request builder. The redundant parameter-flag copy was removed. |
| 2.2 | Production adapters use explicit imports. Request construction and compatible stream consumption are small testable functions within the existing modules; `ai.rs` was not split into additional files. |
| 2.3 | A small internal `CloudProvider` enum replaces repeated string dispatch, with exhaustive provider matches. Public string-based IPC remains compatible. |
| 2.4 | Rust and TypeScript read the same synthetic JSON contracts. Rust checks complete final request bodies and official native URLs; TypeScript checks corresponding reserves and service-tier availability. |
| 2.5 | Additive metadata distinguishes parameter evidence, thinking support, effort choices, and native input/output limits. Undisclosed support remains unknown. Existing planning windows, saved profiles and field names remain compatible. |
| 2.6 | Content-free diagnostic events distinguish family tokenizer estimates, generic fallback tokenizer estimates and byte heuristics. Existing token counts and the count_tokens IPC result remain unchanged. |

### Deliberate scope limits

- No trait, plugin, provider registry framework or cross-language code generation.
- No merger of compatible and native streaming pipelines, nor a universal native request mapper.
- No split of `ai.rs` into numerous modules. The small shared sampler helper remains in the parent module.
- No automatic clamping to newly exposed model output limits; the provider remains authoritative. Historical profiles are not rewritten.
- No exact-tokenizer claim, additional provider token-count requests, or redesign of token-count UI. Diagnostic quality describes the backend estimates used for request planning.
- No changes to the common usage model, cache accounting, summary snapshots/revisions/CAS/rollback, cancellation identities/RAII guard or shared HTTP client.
- The pre-existing `.gitignore` edit was left untouched and is excluded from implementation statistics.

### Removed duplication

- Provider IDs, endpoints and display definitions now have one TypeScript catalog instead of separate onboarding/settings lists and a label table.
- Compatible temperature, output cap and optional sampler emission is shared with NanoGPT.
- `ApiParameterFlags` and its copy/bind function are gone; the immutable request configuration directly controls emission. Legacy duplicate token fields are still accepted but do not override that configuration.
- Message framing and additional-JSON token estimates are shared between solo/summary planning and multiplayer.
- Reading a cancellation-aware HTTP error body is shared by both transport paths.
- Summary policy no longer emits foreign fields for native adapters to strip individually; legacy native JSON filtering remains at the common cloud boundary for compatibility.

### Observable behavior changes

- New OpenAI/Grok onboarding profiles now have the correct provider kind. Previously saved incorrectly classified profiles are not silently migrated.
- A prematurely closed or malformed compatible stream now reports failure instead of silently succeeding. Complete streams ending with either a finish reason or `[DONE]`, and explicit Stop, remain accepted.
- Stop during listener installation prevents a later paid request; HTTP-error-body reads can also be stopped.
- Multiplayer may keep a shorter history because output, system prompt and safety reserves are now counted. An oversized required prompt produces a context error before network generation.
- Summary controls are endpoint-specific. OpenRouter/local controls are translated; Custom retains its previous compatibility policy. OpenAI/xAI no longer receive foreign summary fields. NanoGPT uses `reasoning_effort: none` only when advertised; native default/always-on thinking can still consume the total cap.
- Thinking indicators can finish before the answer stream finishes. Capability warnings no longer present endpoint contract omissions as model-specific negative evidence.
- Normal provider authentication, text/role mapping, sampler semantics, native thinking caps, usage/cache/cost accounting and batching remain intact.

### Validation

- Full Rust suite: 102 passed, plus main/doc targets with zero tests.
- Full frontend suite under `src` and `scripts`: 147 passed.
- Typecheck: zero errors and zero warnings.
- Production build: successful; existing warnings about mixed static/dynamic event imports and large bundles remain.
- `git diff --check`: passed.
- Seven new Rust regression tests; two old binding-only tests consolidated into one final-body test (net six more Rust tests).
- Ten new frontend regression tests.
- Shared contracts cover native defaults/manual/adaptive/dynamic thinking, custom overrides, summary intent, compatible sampler emission, tiers, and the llama.cpp thinking allowance.
- No live authenticated provider calls were made. Typecheck/build ran outside the filesystem sandbox because esbuild could not traverse the required project configuration paths inside it.
