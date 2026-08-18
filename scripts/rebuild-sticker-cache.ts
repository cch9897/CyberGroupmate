/**
 * 批量重建贴纸描述缓存（最新 N 个）
 * 
 * 用法: npx tsx scripts/rebuild-sticker-cache.ts [数量] [--dry-run] [--animated]
 * 默认处理最新 50 个贴纸；--animated 包含动态贴纸（ffmpeg 抽帧）
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { execSync } from "child_process";

// ─── 配置（支持环境变量覆盖） ───
const STICKERS_DIR = process.env.STICKERS_DIR || path.resolve("workspace/Downloads/stickers");
const DB_PATH = process.env.DB_PATH || path.resolve("workspace/memory.db");
const COUNT = parseInt(process.argv[2] || "50", 10);
const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_ANIMATED = process.argv.includes("--animated");

// Vision LLM 配置（通过环境变量配置，默认使用 OpenAI 兼容标准值）
const VISION_API = {
  baseUrl: process.env.VISION_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.VISION_API_KEY || "",
  model: process.env.VISION_MODEL || "gpt-4o",
};

// ─── 工具函数 ───

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function getLatestStickers(dir: string, count: number): string[] {
  const files = fs.readdirSync(dir)
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, count);
  return files.map(f => f.name);
}

function isAnimated(fileName: string): boolean {
  return fileName.endsWith(".webm") || fileName.endsWith(".tgs");
}

/** 用 ffmpeg 从动态贴纸抽第一帧（PNG），返回 buffer 或 null */
function extractFirstFrame(filePath: string): Buffer | null {
  try {
    const result = execSync(
      `ffmpeg -i "${filePath}" -frames:v 1 -f image2pipe -vcodec png -`,
      { maxBuffer: 10 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }
    );
    if (result.length > 0) return result as Buffer;
  } catch (e: any) {
    console.error(`  ⚠️ ffmpeg 抽帧失败: ${e.message?.slice(0, 100)}`);
  }
  return null;
}

/** 准备图片数据：静态贴纸直接读文件，动态贴纸 ffmpeg 抽帧 */
interface ImageData {
  buffer: Buffer;
  mimeType: string;
  b64url: string;
}

function prepareImage(filePath: string, fileName: string): ImageData | null {
  if (isAnimated(fileName)) {
    if (!INCLUDE_ANIMATED) return null;
    const frame = extractFirstFrame(filePath);
    if (!frame) return null;
    return {
      buffer: frame,
      mimeType: "image/png",
      b64url: `data:image/png;base64,${frame.toString("base64")}`,
    };
  }

  const buf = fs.readFileSync(filePath);
  let mimeType = "image/webp";
  if (fileName.endsWith(".png")) mimeType = "image/png";
  else if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) mimeType = "image/jpeg";
  else if (fileName.endsWith(".gif")) mimeType = "image/gif";
  return {
    buffer: buf,
    mimeType,
    b64url: `data:${mimeType};base64,${buf.toString("base64")}`,
  };
}

interface StickerResult {
  fileName: string;
  uniqueFileId: string;
  contentHash: string;
  description: string;
  emojis: string[];
  emoji: string;
  skipped: boolean;
  error?: string;
}

async function callVisionLLM(imageUrl: string, isAnimatedSticker: boolean): Promise<{ description: string; emojis: string[] }> {
  const hint = isAnimatedSticker
    ? "这是一个 Telegram 动态贴纸的关键帧截图。"
    : "这是一个 Telegram 贴纸图片。";

  const response = await fetch(`${VISION_API.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${VISION_API.apiKey}`,
    },
    body: JSON.stringify({
      model: VISION_API.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            {
              type: "text",
              text: `${hint}请你：
1. 用几个词简短描述贴纸表情/动作/含义。如果贴纸中有文字，结合图片内容理解并描述文字的完整内容。
2. 生成多个可用于匹配这个贴纸含义的 emoji 候选，输出为数组。候选数量无上限，但至少 2 个。

请用以下 JSON 格式回复（仅返回 JSON，不要包含其他内容）：
{"description": "描述内容", "emojis": ["emoji1", "emoji2", "..."]}`,
            },
          ],
        },
      ],
      max_tokens: 1024,   // GLM-5V-Turbo 有 thinking，需要留够 token
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "";

  // 解析 JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(objMatch ? objMatch[0] : cleaned);

  if (!parsed || typeof parsed.description !== "string" || !Array.isArray(parsed.emojis)) {
    throw new Error(`无法解析 Vision 回复: ${raw.slice(0, 150)}`);
  }

  return {
    description: parsed.description.trim(),
    emojis: parsed.emojis.filter((e: string) => typeof e === "string"),
  };
}

// ─── 主流程 ───

async function main() {
  console.log(`🎭 贴纸缓存批量重建工具`);
  console.log(`📁 贴纸目录: ${STICKERS_DIR}`);
  console.log(`📊 处理数量: ${COUNT} (最新)`);
  console.log(`🔧 模式: ${DRY_RUN ? "DRY RUN" : "正式写入"} | 动态贴纸: ${INCLUDE_ANIMATED ? "启用(ffmpeg抽帧)" : "跳过"}`);
  console.log();

  // 1. 获取最新贴纸列表
  const stickers = getLatestStickers(STICKERS_DIR, COUNT);
  console.log(`📋 找到 ${stickers.length} 个贴纸文件`);

  // 2. 打开数据库
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const existingCount = db.prepare("SELECT COUNT(*) as c FROM sticker_descriptions").get() as { c: number };
  console.log(`📦 当前 sticker_descriptions 表记录数: ${existingCount.c}`);

  const results: StickerResult[] = [];
  let success = 0, skipped = 0, failed = 0;

  for (let i = 0; i < stickers.length; i++) {
    const fileName = stickers[i];
    const filePath = path.join(STICKERS_DIR, fileName);
    const uniqueFileId = fileName.replace(/\.[^.]+$/, "");
    const animated = isAnimated(fileName);

    process.stdout.write(`[${i + 1}/${stickers.length}] ${fileName}${animated ? " [动态]" : ""} ... `);

    const img = prepareImage(filePath, fileName);
    if (!img) {
      console.log(`⏭️ 跳过${animated ? " (动态贴纸，加 --animated 启用)" : ""}`);
      results.push({ fileName, uniqueFileId, contentHash: "", description: "", emojis: [], emoji: "", skipped: true });
      skipped++;
      continue;
    }

    try {
      const contentHash = sha256(img.buffer);

      // 检查是否已存在（按 content_hash）
      const existing = db.prepare(
        "SELECT unique_file_id FROM sticker_descriptions WHERE content_hash = ? LIMIT 1"
      ).get(contentHash) as { unique_file_id: string } | undefined;

      if (existing) {
        console.log(`✅ 已存在 (${existing.unique_file_id})`);
        results.push({ fileName, uniqueFileId, contentHash, description: "(existing)", emojis: [], emoji: "", skipped: true });
        skipped++;
        continue;
      }

      // 调 Vision API
      const visionResult = await callVisionLLM(img.b64url, animated);

      if (DRY_RUN) {
        console.log(`🔍 DRY RUN → "${visionResult.description}" [${visionResult.emojis.join(",")}]`);
        results.push({
          fileName, uniqueFileId, contentHash,
          description: visionResult.description,
          emojis: visionResult.emojis,
          emoji: visionResult.emojis[0] || "",
          skipped: false,
        });
      } else {
        const now = new Date().toISOString();
        const emojisJson = JSON.stringify(visionResult.emojis);
        db.prepare(`
          INSERT OR REPLACE INTO sticker_descriptions (unique_file_id, description, created_at, emoji, emojis, enabled, content_hash)
          VALUES (?, ?, ?, ?, ?, 1, ?)
        `).run(uniqueFileId, visionResult.description, now, visionResult.emojis[0] || null, emojisJson, contentHash);

        console.log(`✅ "${visionResult.description}" [${visionResult.emojis.join(",")}]`);
        results.push({
          fileName, uniqueFileId, contentHash,
          description: visionResult.description,
          emojis: visionResult.emojis,
          emoji: visionResult.emojis[0] || "",
          skipped: false,
        });
      }

      success++;
      await new Promise(r => setTimeout(r, 500));

    } catch (err: any) {
      console.log(`❌ 失败: ${err.message?.slice(0, 100)}`);
      results.push({ fileName, uniqueFileId, contentHash: "", description: "", emojis: [], emoji: "", skipped: false, error: err.message });
      failed++;
    }
  }

  // ── 汇总 ──
  const finalCount = db.prepare("SELECT COUNT(*) as c FROM sticker_descriptions").get() as { c: number };
  console.log("\n═════════════════════════════════");
  console.log(`📊 结果汇总:`);
  console.log(`   ✅ 成功: ${success}`);
  console.log(`   ⏭️ 跳过: ${skipped} (动态/已存在)`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📦 sticker_descriptions 总记录: ${finalCount.c}`);
  
  if (DRY_RUN) {
    console.log(`\n⚠️  DRY RUN 模式 — 未实际写入数据库`);
    console.log(`   去掉 --dry-run 参数即可正式执行`);
  }

  db.close();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
