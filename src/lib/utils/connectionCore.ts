export type ContextStrategy = 'economy' | 'balanced' | 'maximum';
export const SAME_AS_CHAT_CONNECTION = 'same_as_chat';
export const CONSERVATIVE_CONTEXT_FALLBACK = 8192;
const MIN_VALID_CONTEXT = 1024;
const MAX_VALID_CONTEXT = 16_777_216;

export interface ContextInputs {
  detectedContext: { tokens: number; provenance: string } | null;
  manualContextCap: number | null;
}

export function validContextSize(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= MIN_VALID_CONTEXT && Number(value) <= MAX_VALID_CONTEXT;
}

export function resolvedHardContextLimit(connection: ContextInputs): number {
  const detected = connection.detectedContext;
  const automatic = detected && detected.provenance !== 'theoretical' && validContextSize(detected.tokens) ? detected.tokens : null;
  const manual = validContextSize(connection.manualContextCap) ? connection.manualContextCap : null;
  if (automatic != null && manual != null) return Math.min(automatic, manual);
  return automatic ?? manual ?? CONSERVATIVE_CONTEXT_FALLBACK;
}

/** Square-root growth gives small models most of their capacity, but progressively
 * reduces the fraction assigned to huge windows. All strategies remain soft-capped. */
export function deriveWorkingContextTarget(hardLimit: number, strategy: ContextStrategy): number {
  const hard = validContextSize(Math.floor(hardLimit)) ? Math.floor(hardLimit) : CONSERVATIVE_CONTEXT_FALLBACK;
  const base = 8192;
  const policies = {
    economy: { smallShare: 0.5, growth: 0.55, ceiling: 32_768 },
    balanced: { smallShare: 0.85, growth: 1.15, ceiling: 98_304 },
    maximum: { smallShare: 1, growth: 2.75, ceiling: 262_144 },
  } as const;
  const policy = policies[strategy];
  if (hard <= base) return Math.max(1024, Math.min(hard, Math.floor(hard * policy.smallShare)));
  const nonlinear = base + policy.growth * Math.sqrt((hard - base) * base);
  return Math.min(hard, policy.ceiling, Math.max(base, Math.round(nonlinear / 1024) * 1024));
}

export function connectionIdentity(providerKind: string, url: string, model: string): string {
  return `${providerKind}\n${url.trim()}\n${model.trim()}`;
}

export function acceptDetectedContext<T extends { tokens: number }>(previous: T | null, candidate: T | null): T | null {
  return candidate && validContextSize(candidate.tokens) ? candidate : previous;
}

export function deleteConnectionSafely<T extends { id: string }>(connections: T[], activeId: string, deleteId: string): { connections: T[]; activeId: string } {
  if (connections.length <= 1) return { connections, activeId };
  const index = connections.findIndex(connection => connection.id === deleteId);
  if (index < 0) return { connections, activeId };
  const nextConnections = connections.filter(connection => connection.id !== deleteId);
  const nextActiveId = activeId === deleteId ? nextConnections[Math.min(index, nextConnections.length - 1)].id : activeId;
  return { connections: nextConnections, activeId: nextActiveId };
}

export function normalizeSummaryConnectionId<T extends { id: string }>(
  connections: T[],
  selectedId: string | null | undefined,
): string {
  return selectedId && selectedId !== SAME_AS_CHAT_CONNECTION
    && connections.some(connection => connection.id === selectedId)
    ? selectedId
    : SAME_AS_CHAT_CONNECTION;
}

export function adaptiveSummaryOutputCap(strategy: ContextStrategy): number {
  if (strategy === 'economy') return 512;
  if (strategy === 'maximum') return 2048;
  return 1024;
}

export function shouldTriggerSummary(projectedTokens: number, workingTarget: number): boolean {
  return projectedTokens > workingTarget;
}

export function summaryCompressionGoal(workingTarget: number): number {
  return Math.max(1, Math.floor(workingTarget * 0.8));
}

export function resolveSummaryConnection<T extends { id: string }>(
  connections: T[],
  selectedId: string,
  chatConnection: T,
): T {
  if (selectedId === SAME_AS_CHAT_CONNECTION) return chatConnection;
  return connections.find(connection => connection.id === selectedId) ?? chatConnection;
}

export function resolveMemorySettings<T extends { id: string }>(
  connections: T[],
  enabledValue: string | undefined,
  selectedId: string | undefined,
): { longTermMemory: boolean; summaryConnectionId: string } {
  return {
    longTermMemory: enabledValue !== 'false',
    summaryConnectionId: normalizeSummaryConnectionId(connections, selectedId),
  };
}
