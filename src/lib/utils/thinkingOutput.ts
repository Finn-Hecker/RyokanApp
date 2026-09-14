/**
 * Strips a leading thinking block and channel-style reasoning from streamed
 * assistant output, returning only content that is safe to render.
 */
export function processThinkingOutput(raw: string, isFinished: boolean): {
    text:       string;
    isThinking: boolean;
} {
    const thinkStart = '<think>';
    const firstContentIndex = raw.search(/\S/);

    // Hold a possible opening tag back while it is split across stream chunks.
    // If the prefix later diverges from <think>, the buffered content is shown
    // normally. A <think> appearing after visible content is never special.
    if (firstContentIndex === -1) {
        return isFinished
            ? { text: stripChannelTags(raw, true), isThinking: false }
            : { text: '', isThinking: false };
    }

    const content = raw.slice(firstContentIndex);
    if (thinkStart.startsWith(content) && content !== thinkStart) {
        return isFinished
            ? { text: stripChannelTags(raw, true), isThinking: false }
            : { text: '', isThinking: false };
    }

    if (content.startsWith(thinkStart)) {
        const afterStart = content.slice(thinkStart.length);
        const thinkEnd = '</think>';
        const endIndex = afterStart.indexOf(thinkEnd);

        if (endIndex !== -1) {
            const afterThink = afterStart.slice(endIndex + thinkEnd.length).trimStart();
            return { text: stripChannelTags(afterThink, isFinished), isThinking: false };
        }

        if (isFinished) {
            // Stream ended without </think> — discard the orphaned block.
            return { text: '', isThinking: false };
        }
        return { text: '', isThinking: true };
    }

    const text = stripChannelTags(raw, isFinished);

    if (isFinished) return { text, isThinking: false };

    if (raw.includes('<|channel>') && !raw.includes('<channel|>')) {
        return { text: '', isThinking: true };
    }

    return { text, isThinking: false };
}

/**
 * Strips <|channel>…<channel|> blocks from a string. While streaming, an
 * orphaned opening tag is left untouched since the closing tag may still
 * be on its way.
 */
function stripChannelTags(content: string, isFinished: boolean): string {
    if (!content || !content.includes('<')) return content;

    let result = content.replace(/<\|channel>[\s\S]*?<channel\|>/g, '');

    const closeIdx = result.indexOf('<channel|>');
    if (closeIdx !== -1) {
        result = result.slice(closeIdx + '<channel|>'.length);
    }

    if (isFinished) {
        const openIdx = result.indexOf('<|channel>');
        if (openIdx !== -1) {
            result = result.slice(0, openIdx);
        }
    }

    return result.trimStart();
}

/** Removes reasoning markup from a finalized assistant message. */
export function stripThinkingContent(content: string): string {
    if (!content) return content;
    return processThinkingOutput(content, true).text.trimStart();
}
