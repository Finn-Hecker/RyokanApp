# Architecture

Ryokan runs a Svelte frontend in a Tauri WebView. Rust owns HTTP requests and
SQLite persistence. Multiplayer guests use the frontend in a browser; the host
executes AI requests. The relay transports encrypted content.

## Entry points and ownership

| Area | Entry points | Responsibility |
| --- | --- | --- |
| App shell | `src/routes/+layout.svelte`, `+page.svelte`; `src/lib/stores/navigation.ts` | Startup, navigation and lazy screen loading |
| Shared state | `src/lib/stores/appState.svelte.ts`, `chatStore.svelte.ts` | Connections/settings, active chat, messages and conversation library |
| Chat UI | `src/lib/components/chat/ChatRoom.svelte` | Send, retry, edit, stop and display coordination |
| Connections | `src/lib/ai/connections/apiConnections.ts`, `connectionCore.ts`, `providers.ts` | Persistence/detection orchestration, pure connection policy and provider catalog |
| AI requests | `src/lib/ai/generation/chatApi.ts` | Immutable request snapshots, scoped stream listeners and Tauri invocation |
| Prompts | `src/lib/ai/prompt/chatPromptBuilder.ts`, `promptBuilder.ts`, `textRules.ts` | Message assembly, character/role/world-info context and text transforms |
| Token planning | `src/lib/ai/tokens/requestBudget.ts`, `providerTokenBudget.ts`, `tokenEstimate.ts` | Request accounting, provider output reserves and local estimates |
| Memory | `src/lib/ai/summary/rollingSummary.svelte.ts`, `rollingSummaryCore.ts` | Runtime summary coordination and pure budget/commit/revision rules |
| Chat helpers | `src/lib/chat/` | Message decoding, greetings, scroll behavior and Markdown rendering |
| Application services | `src/lib/settings/settings.ts`, `diagnostics/`, `updates/` | Settings IPC, privacy-preserving diagnostics and updater lifecycle |
| Multiplayer | `src/lib/stores/multiplayer.svelte.ts` | Room state, cryptography, relay protocol, reconnection, host generation and local history |
| Native app | `src-tauri/src/lib.rs` | Tauri setup and command registration |
| Native AI | `src-tauri/src/ai.rs`, `src-tauri/src/ai/` | HTTP, provider wire protocols, context/model metadata and streaming |
| Persistence | `src-tauri/src/database/mod.rs` and domain modules | Schema/migrations and SQLite operations |

`components/` and `stores/` retain their existing public exports. Domain modules
are imported directly using `$lib/...` in application code; pure modules and
Node tests also use explicit relative TypeScript imports. General UI/platform
helpers remain in `utils/`. Tests are colocated with the code they exercise.

## Singleplayer generation

1. `ChatRoom.svelte` captures the active conversation and persists the user
   message through `chatStore.svelte.ts` and Rust database commands.
2. It snapshots connection settings and text rules, then calls
   `checkAndSummarizeIfNeeded` in `ai/summary/rollingSummary.svelte.ts`.
3. The summary coordinator loads history, measures the request and, if needed,
   generates/commits a summary. Revision checks, cancellation and compare-and-swap
   persistence prevent stale work from overwriting newer conversation state.
4. `chatApi.runGeneration` builds the final prompt through `chatPromptBuilder`,
   installs listeners scoped by generation ID, and invokes `call_ai_api`.
5. Rust `ai.rs` dispatches the compatible or native provider request. Tokens and
   thinking updates return through `ai-token` / `ai-thinking-token`; usage is
   returned with the command result. The chat store persists the assistant reply
   and swipe-specific usage. The summary coordinator remembers its usage anchor.

Summary generation must finish before chat generation. Keep the current request
IDs, listener cleanup, stop semantics and settings snapshots when changing this
flow. Local token estimates and provider-reported usage have distinct meanings.

## Connections and model/context metadata

`SettingsPage.svelte` / `ApiSection.svelte` use `apiConnections.ts` and
`settings/settings.ts` to load/save profiles and settings. `appState` exposes the
active connection. Provider identity and model metadata determine available
parameters; `connectionCore.ts` resolves context limits and summary connections.

`fetch_models` and `detect_context` remain registered at `ai.rs`. Model catalog
handling delegates to `ai/models.rs`; context detection delegates to
`ai/context.rs`. Native adapters in `ai/cloud/` retain their provider-specific
contracts. `ai/pricing.rs` enriches advertised model metadata.

## Native AI modules

- `ai.rs`: command boundary, shared HTTP client, request/event DTOs, cancellation,
  stream batching and generation execution.
- `ai/parameters.rs`: protected custom fields, sampling, reasoning and service-tier
  translation. Preserve the exact provider request body.
- `ai/usage.rs`: provider-reported counts, cost/tier/model metadata and sparse
  stream accumulation; no inferred usage.
- `ai/models.rs`: model DTOs, catalog normalization and advertised capabilities.
- `ai/context.rs`: runtime/advertised context detection and its provenance.
- `ai/cloud.rs` and `ai/cloud/`: native provider protocols and stream consumption.
- `ai/tests.rs`: existing cross-cutting request/stream regression tests. Model and
  context tests stay with their respective modules.

## Multiplayer and persistence

`PlayLobby.svelte` and `MultiplayerRoom.svelte` call the multiplayer store to
create/join/resume rooms. It encrypts relay content, verifies host envelopes,
updates `mpState`, and persists local session history through Rust. Host AI
generation uses its own relay batching and request budgeting. The room key stays
client-side; the host authorization token is sent to the relay.

Chat/character/role/world-info stores invoke their matching database commands.
`database/mod.rs` owns initialization and migrations. Character-card import/export
is handled by the separate Rust import/export modules. No schemas, command names,
relay protocols or persistence formats change in this refactor.

## Validation

See `AGENTS.md` for commands. `npm test` discovers all frontend test files,
including component/store VM harnesses. Pure domain tests exercise production
functions directly; summary runtime tests mock Tauri and Svelte state creation.
Rust tests include provider streaming, shared provider fixtures, migrations and
persistence. The frontend production build also validates lazy module resolution.
