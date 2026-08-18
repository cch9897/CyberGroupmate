/**
 * modules/vision.d.ts — Vision 视觉模块类型定义
 *
 * 提供图片识别能力，让 Agent 可以"看到"图片并理解其内容。
 * 图片路径限定在 workspace/ 目录下。
 *
 * vision: VisionModule — 全局可用
 */

/** vision.see 的可选配置 */
interface VisionSeeOptions {
    /**
     * 自定义分析视角/指令。不传时使用默认描述（"详细描述图片内容"）。
     * 传入后会以该 prompt 分析所有传入的图片，适合特定任务（数人数、提取文字/代码、配色分析等）。
     * 使用自定义 prompt 时结果保留原始换行格式（便于代码/列表输出）；默认描述则折叠为单行。
     */
    prompt?: string;
}

interface VisionModule {
    /**
     * 看图：读取一张或多张图片文件，返回每张图片的文字描述。
     * 使用 Vision LLM 分析图片内容，支持 JPEG、PNG、WebP 等常见格式。
     *
     * @param imagePaths - 图片文件路径（支持绝对路径或相对于 workspace/ 的相对路径），可传入多个参数
     * @returns 每张图片的详细文字描述数组（与输入路径一一对应）
     *
     * @example
     * // 查看单张图片
     * const [desc] = await vision.see("screenshots/page.png");
     * console.log(desc);
     *
     * @example
     * // 同时查看多张图片
     * const descriptions = await vision.see("img1.jpg", "img2.png", "data/chart.png");
     * descriptions.forEach((d, i) => console.log(`图片${i+1}: ${d}`));
     */
    see(...imagePaths: string[]): Promise<string[]>;

    /**
     * 看图（自定义分析）：用指定 prompt 分析图片，而不是默认的"描述内容"。
     *
     * @param options - 分析配置（目前支持 prompt 字段）
     * @param imagePaths - 图片文件路径，可传入多个
     * @returns 每张图片按 prompt 分析得到的文字数组（与输入路径一一对应）
     *
     * @example
     * // 数图片里的人数
     * const [count] = await vision.see({ prompt: "数一下图里有多少人，只回答数字" }, "photo.jpg");
     *
     * @example
     * // 提取图片里的代码（保留原格式）
     * const [code] = await vision.see({ prompt: "完整提取图片中的代码，保持原格式" }, "screenshot.png");
     *
     * @example
     * // 同一 prompt 分析多张图片
     * const results = await vision.see({ prompt: "描述配色方案" }, "design1.png", "design2.png");
     */
    see(options: VisionSeeOptions, ...imagePaths: string[]): Promise<string[]>;
}

declare const vision: VisionModule;
