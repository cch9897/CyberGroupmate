# Telegram 媒体下载与 GIF/视频分析指南

## 基础：下载媒体并保存到磁盘

**⚠️ 关键规则：必须用 `fs.writeFileBinary()`，不能用 `fs.writeFile()`**

`telegram.downloadMedia()` 返回 `{ buffer: string; size: number }`，其中 `buffer` 是 **base64 编码**的字符串。
`fs.writeFile()` 只会将 base64 字符串当 UTF-8 文本写入，导致文件损坏无法打开。

```typescript
// ✅ 正确
const data = await telegram.downloadMedia(
    msg.mediaInfo.fileId, chatId, msg.id, msg.mediaInfo.uniqueFileId
);
fs.writeFileBinary("workspace/Downloads/photo.jpg", data.buffer);

// ❌ 错误：文件会损坏
// fs.writeFile("workspace/Downloads/photo.jpg", data.buffer);
```

保存后可以用 `vision.see()` 分析，或 `telegram.sendMedia()` 转发。

---

## GIF / 短视频分析：避免 60 秒超时

GIF 和短视频分析（用 ffmpeg 抽帧）如果帧数过多会超时。遵循以下策略：

### 默认策略：抽 4-6 帧

```typescript
// 使用 shell 调用 ffmpeg 抽关键帧，控制在 4-6 帧
const { execSync } = require("child_process");
const gifPath = "workspace/Downloads/animation.gif";
const framesDir = "workspace/Downloads/frames";

// 先确保目录存在
fs.mkdir(framesDir);

// 均匀抽取 5 帧（-vf fps=1 表示每秒1帧，-frames:v 5 限制总帧数）
// 对于 GIF，用 select 滤镜均匀采样
execSync(`ffmpeg -i ${gifPath} -vf "select=not(mod(n\\,5))" -vsync vfr -frames:v 5 ${framesDir}/frame_%02d.jpg -y 2>/dev/null`);

// 查看生成了哪些帧
const frames = fs.readdir(framesDir).filter(f => f.endsWith(".jpg"));
const framePaths = frames.map(f => `${framesDir}/${f}`);

// 分析
const descriptions = await vision.see(...framePaths);
```

### 如果已有下载好的文件（复用，避免重复下载）

```typescript
// 先检查是否已存在，已有就跳过下载
const localPath = "workspace/Downloads/anim_" + msg.mediaInfo.uniqueFileId + ".mp4";
if (!fs.exists(localPath)) {
    const data = await telegram.downloadMedia(
        msg.mediaInfo.fileId, chatId, msg.id, msg.mediaInfo.uniqueFileId
    );
    fs.writeFileBinary(localPath, data.buffer);
}
// 然后抽帧分析...
```

### 先发进度，再深分析

```typescript
// 先告知用户在处理
await telegram.sendText(chatId, "稍等，Miu看看这个…");

// 然后做分析（避免用户等待焦虑）
const data = await telegram.downloadMedia(...);
// ...
```

### 帧数选取原则

| 文件类型 | 建议帧数 | 说明 |
|---------|---------|------|
| 短 GIF（<3s）| 4 帧 | 均匀分布即可 |
| 长 GIF（>5s）| 5-6 帧 | 开头/中间/结尾各取一帧 |
| 短视频（<30s）| 4-5 帧 | 不必每秒一帧 |
| 长视频（>30s）| 6 帧上限 | 均匀采样，关注关键时刻 |

**绝对不要抽超过 8 帧**，14 帧以上基本必然超时。

---

## 常见问题排查

### 文件损坏（图片打不开/显示乱码）
- 原因：用了 `fs.writeFile()` 写入 base64 字符串
- 修复：改用 `fs.writeFileBinary(path, data.buffer)`

### ffmpeg 抽帧超时
- 原因：帧数过多（>8 帧）或文件过大
- 修复：降低帧数到 4-6，或先发进度消息再处理

### downloadMedia 报错 "file reference expired"
- 原因：fileId 过期，需要从原始消息重新获取
- 修复：传入 `chatId` 和 `messageId` 参数，系统会自动 refetch
