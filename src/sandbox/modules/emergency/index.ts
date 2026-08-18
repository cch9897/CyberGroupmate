/**
 * modules/emergency.ts — 紧急拉黑模块
 *
 * 通过 callHost 代理到 Host 侧。让 agent 在遇到自己无法处理/无法帮助的情况时，
 * 一键把对方拉黑：向对方发送一次预设文案，之后其消息对 bot 完全不可见。
 * 仅能拉黑，无法解除（解除只走 dashboard 人工操作）。
 */

export interface EmergencyCallbacks {
    callHost: (method: string, args?: unknown[]) => Promise<unknown>;
}

let _callbacks: EmergencyCallbacks | null = null;

export function setEmergencyCallbacks(callbacks: EmergencyCallbacks): void {
    _callbacks = callbacks;
}

export const emergencyModule = {
    block: async (userId?: string, reason?: string): Promise<{
        userId: string;
        blocked: boolean;
        alreadyBlocked: boolean;
        notified: boolean;
    }> => {
        if (!_callbacks) throw new Error("Emergency module not initialized");
        const result = await _callbacks.callHost("emergency.block", [userId, reason]);
        return result as { userId: string; blocked: boolean; alreadyBlocked: boolean; notified: boolean };
    },
};
