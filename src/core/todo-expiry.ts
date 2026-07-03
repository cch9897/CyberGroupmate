import { timestampInputToIso } from "./timezone.js";

export const DEFAULT_TODO_TTL_DAYS = 30;

export interface TodoExpiryInput {
    dueAt?: string | number | Date | null;
    forever?: boolean | null;
}

export function resolveTodoDueAt(input: TodoExpiryInput | undefined): string | null {
    if (input?.forever === true) {
        return null;
    }

    if (
        input
        && Object.prototype.hasOwnProperty.call(input, "dueAt")
        && input.dueAt != null
        && input.dueAt !== ""
    ) {
        const dueAt = timestampInputToIso(input.dueAt);
        if (!dueAt) {
            throw new Error(`Invalid todo dueAt: ${input.dueAt}`);
        }
        return dueAt;
    }

    return new Date(Date.now() + DEFAULT_TODO_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
