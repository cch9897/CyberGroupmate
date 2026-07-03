export const SEND_INTERRUPTED_MARKER = "__CGM_SEND_INTERRUPTED__";

export interface PendingMessageSignal {
    getVersion(): number;
    getPendingCount(): number;
    onChange(listener: () => void): () => void;
    waitForChange(sinceVersion: number, timeoutMs: number): Promise<boolean>;
}

export interface InterruptedSendPayload {
    method: string;
    chatId: string;
    text: string;
}

const pendingSignals = new Map<string, PendingMessageSignal>();

export function registerPendingMessageSignal(chatId: string, signal: PendingMessageSignal): () => void {
    pendingSignals.set(chatId, signal);
    return () => {
        if (pendingSignals.get(chatId) === signal) {
            pendingSignals.delete(chatId);
        }
    };
}

export function getPendingMessageSignal(chatId: string): PendingMessageSignal | undefined {
    return pendingSignals.get(chatId);
}

export class SendInterruptedError extends Error {
    constructor(readonly payload: InterruptedSendPayload) {
        super(`${SEND_INTERRUPTED_MARKER}${JSON.stringify(payload)}`);
        this.name = "SendInterruptedError";
    }
}

export function parseSendInterruptedPayload(text: string): InterruptedSendPayload | null {
    const index = text.indexOf(SEND_INTERRUPTED_MARKER);
    if (index < 0) return null;

    const afterMarker = text.slice(index + SEND_INTERRUPTED_MARKER.length);
    const firstLine = afterMarker.split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine) return null;

    try {
        const parsed = JSON.parse(firstLine) as Partial<InterruptedSendPayload>;
        if (
            typeof parsed.method === "string" &&
            typeof parsed.chatId === "string" &&
            typeof parsed.text === "string"
        ) {
            return {
                method: parsed.method,
                chatId: parsed.chatId,
                text: parsed.text,
            };
        }
    } catch {
        return null;
    }
    return null;
}
