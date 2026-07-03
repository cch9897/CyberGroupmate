import type { ChildProcess } from "node:child_process";

export interface HarnessLaunchOptions {
    prompt: string;
    systemPrompt: string;
    mcpConfig: HarnessMcpConfig;
    workDir: string;
    model?: string;
    maxBudgetUsd?: number;
    extraArgs?: string[];
}

export type HarnessMcpServerType = "streamable-http" | "stdio";

export interface HarnessMcpServerConfig {
    type: HarnessMcpServerType;
    url?: string;
    headers?: Record<string, string>;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface HarnessMcpConfig {
    mcpServers: Record<string, HarnessMcpServerConfig>;
}

export interface HarnessLauncher {
    name: string;
    start(options: HarnessLaunchOptions): Promise<ChildProcess>;
}

export interface HarnessNotify {
    content: string;
    source?: string;
    actorId?: string;
    runId?: string;
    triggerReason?: string;
    sourceChatId?: string;
    sourceChatTitle?: string;
    taskId?: string;
    metadata?: Record<string, unknown>;
}

export type HarnessRunEventStream = "system" | "stdout" | "stderr";

export interface HarnessRunEvent {
    id: number;
    timestamp: number;
    stream: HarnessRunEventStream;
    kind: string;
    text?: string;
    event?: Record<string, unknown>;
}

export interface HarnessRunRecord {
    id: string;
    startedAt: number;
    endedAt?: number;
    exitCode?: number | null;
    trigger: "scheduled" | "enqueued";
    pendingCount: number;
    harness: string;
    mcpServers?: string[];
    logPath?: string;
    harnessHome?: string;
    instructionPath?: string;
    pid?: number;
    durationMs?: number;
    costUsd?: number;
    stderrTail?: string;
    resultSummary?: string;
    events: HarnessRunEvent[];
    eventCount: number;
}
