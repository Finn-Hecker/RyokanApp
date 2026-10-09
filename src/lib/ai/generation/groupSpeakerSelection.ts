import type { GroupParticipant } from '../../chat/groupChatData.ts';
import type { Message } from '../../chat/messageData.ts';

export const MAX_GROUP_RESPONSES = 8;

/** Deterministic, bounded rotation. Selection never makes a model request. */
export function selectGroupSpeakers(participants: readonly GroupParticipant[], history: readonly Message[],
    selection: { participantIds?: readonly string[]; maxResponses?: number }): string[] {
    const active = participants.filter(item => item.is_active);
    if (active.length < 2) throw new Error('Group chats require at least two characters');
    const ids = active.map(item => item.id);
    if (selection.participantIds !== undefined) {
        if (selection.maxResponses !== undefined) throw new Error('Choose manual or automatic speakers');
        const selected = [...selection.participantIds];
        if (!selected.length || selected.length > MAX_GROUP_RESPONSES
            || new Set(selected).size !== selected.length || selected.some(id => !ids.includes(id))) {
            throw new Error('Invalid manual group speaker selection');
        }
        return selected;
    }
    const count = selection.maxResponses ?? 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GROUP_RESPONSES) {
        throw new Error(`Automatic replies must be between 1 and ${MAX_GROUP_RESPONSES}`);
    }
    const lastSpeaker = history.findLast(message => message.role === 'assistant')?.participant_id;
    const start = (ids.indexOf(lastSpeaker ?? '') + 1) % ids.length;
    return Array.from({ length: count }, (_, index) => ids[(start + index) % ids.length]);
}
