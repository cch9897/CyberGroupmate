import type { HarnessManager } from "../../harness/manager.js";
import type { HarnessNotify } from "../../harness/types.js";

type BackgroundEnqueueOptions = Omit<HarnessNotify, "content" | "source">;

export function createBackgroundApi(getHarnessManager: () => HarnessManager | null) {
    return {
        enqueue: async (content: string, source?: string, options?: BackgroundEnqueueOptions) => {
            const hm = getHarnessManager();
            if (!hm) return { queued: false, reason: "Background Agent not configured" };
            hm.enqueue({ content, source: source ?? "meta", ...(options ?? {}) });
            return { queued: true, queueLength: hm.queueLength };
        },
        getStatus: async () => {
            const hm = getHarnessManager();
            if (!hm) return { enabled: false };
            return { enabled: true, ...hm.getStatus() };
        },
    };
}
