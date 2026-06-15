export { HarnessManager, type HarnessManagerConfig } from "./manager.js";
export { serializeClaudeMcpConfig, serializeCopilotMcpConfig } from "./mcp-config.js";
export { ClaudeCodeLauncher } from "./launchers/claude-code.js";
export { CopilotCliLauncher } from "./launchers/copilot-cli.js";
export type { HarnessLauncher, HarnessMcpConfig, HarnessNotify, HarnessRunRecord, HarnessLaunchOptions } from "./types.js";
