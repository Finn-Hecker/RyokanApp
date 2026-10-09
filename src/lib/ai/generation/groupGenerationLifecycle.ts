/** Kept separate from stores to let navigation cancel work without import cycles. */
let active: { chatId: string; controller: AbortController } | null = null;

export function beginGroupGeneration(chatId: string): AbortController {
    if (active) throw new Error('A group generation is already running');
    const controller = new AbortController();
    active = { chatId, controller };
    return controller;
}

export function stopGroupGeneration(chatId?: string): void {
    if (active && (!chatId || active.chatId === chatId)) active.controller.abort();
}

export function finishGroupGeneration(controller: AbortController): void {
    if (active?.controller === controller) active = null;
}
