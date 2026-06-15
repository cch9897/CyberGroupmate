import type { buildMetaApiContext } from "../meta-sandbox/meta-api/index.js";
import type { GlobalState } from "../main-agent/global-state.js";
import type { AttentionAccumulator } from "../accumulator/attention-accumulator.js";
import type { SandboxPool } from "../sandbox/sandbox-pool.js";

export type MetaApiContext = ReturnType<typeof buildMetaApiContext>;

export interface McpServerDeps {
    metaApi: MetaApiContext;
    globalState: GlobalState;
    accumulator: AttentionAccumulator;
    sandboxPool: SandboxPool;
    workspaceRoot: string;
}
