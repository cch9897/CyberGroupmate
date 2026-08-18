/**
 * modules/vision.ts — Vision 视觉模块
 *
 * 通过 callHost 代理到 Host 侧的 Vision 处理。
 * 让 Agent 可以"看到"workspace 内的图片文件。
 */

export interface VisionCallbacks {
    callHost: (method: string, args?: unknown[]) => Promise<unknown>;
}

let _callbacks: VisionCallbacks | null = null;

/**
 * 注入 Host 通信回调（由 sandbox-worker 调用）
 */
export function setVisionCallbacks(callbacks: VisionCallbacks): void {
    _callbacks = callbacks;
}

export const visionModule = {
    /**
     * 看图：读取一张或多张图片文件，返回每张图片的文字描述。
     * 使用 Vision LLM 分析图片内容。
     *
     * 支持两种调用形态（运行时按首个参数类型分流）：
     *   - see(...imagePaths)            默认描述
     *   - see({ prompt }, ...imagePaths) 自定义分析视角
     *
     * @param args - 首个参数为 object 时视为 options，其余/全部为图片路径
     */
    see: async (...args: unknown[]): Promise<string[]> => {
        if (!_callbacks) throw new Error("Vision module not initialized");
        const first = args[0];
        const hasOptions = typeof first === "object" && first !== null && !Array.isArray(first);
        const imagePaths = (hasOptions ? args.slice(1) : args) as string[];
        if (imagePaths.length === 0) throw new Error("vision.see() 至少需要传入一个图片路径");
        const payload: unknown[] = hasOptions ? [first, ...imagePaths] : imagePaths;
        const result = await _callbacks.callHost("vision.see", payload);
        return result as string[];
    },
};
