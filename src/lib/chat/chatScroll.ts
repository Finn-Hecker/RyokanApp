const SENT_MESSAGE_VIEWPORT_POSITION = 0.65;
const VIEWPORT_TOP_PADDING = 16;

/**
 * Performs the single intentional scroll used after the local user sends a
 * message. No incoming-message or streaming path should call this helper.
 */
export function positionSentChatMessage(
  container: HTMLElement | null,
  messageId: string,
): void {
  if (!container) return;

  const message = container.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  );
  if (!message) return;

  const containerRect = container.getBoundingClientRect();
  const messageRect = message.getBoundingClientRect();
  const targetBottom = containerRect.top
    + container.clientHeight * SENT_MESSAGE_VIEWPORT_POSITION;
  let scrollAmount = messageRect.bottom - targetBottom;

  // Keep the top of an unusually tall message visible while reserving the
  // lower part of the viewport for the response that may follow.
  if (scrollAmount > 0) {
    const topRoom = Math.max(
      0,
      messageRect.top - containerRect.top - VIEWPORT_TOP_PADDING,
    );
    scrollAmount = Math.min(scrollAmount, topRoom);
  }

  if (Math.abs(scrollAmount) < 0.5) return;
  container.scrollBy({ top: scrollAmount, behavior: 'auto' });
}
