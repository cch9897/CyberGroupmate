import { z } from "zod";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServerDeps } from "../types.js";

export function registerSkillsTools(mcp: McpServer, deps: McpServerDeps): void {
    mcp.tool(
        "skills_list",
        "List all available skills in workspace/skills/. Returns skill names, code entry files, .d.ts docs, and SKILL.md presence.",
        async () => {
            const skillsDir = join(deps.workspaceRoot, "workspace", "skills");
            try {
                const entries = await readdir(skillsDir, { withFileTypes: true });
                const skills = [];
                for (const entry of entries) {
                    if (!entry.isDirectory() || entry.name === "node_modules") continue;
                    const skillPath = join(skillsDir, entry.name);
                    const files = await readdir(skillPath).catch((): string[] => []);
                    const hasCodeEntry = files.includes("index.ts") || files.includes("index.js");
                    const hasDts = files.some((f: string) => f.endsWith(".d.ts"));
                    const hasSkillMd = files.includes("SKILL.md");
                    skills.push({
                        name: entry.name,
                        hasCodeEntry,
                        hasDts,
                        hasSkillMd,
                        hasTs: files.includes("index.ts"),
                        hasMd: hasSkillMd,
                        files,
                    });
                }
                return { content: [{ type: "text" as const, text: JSON.stringify(skills, null, 2) }] };
            } catch (err) {
                return { content: [{ type: "text" as const, text: `Error listing skills: ${err}` }], isError: true };
            }
        },
    );

    mcp.tool(
        "skills_readFile",
        "Read a specific file from a skill directory.",
        {
            skillName: z.string().describe("Skill directory name (e.g. 'tavily', 'danbooru')"),
            fileName: z.string().describe("File name within the skill directory"),
        },
        async ({ skillName, fileName }) => {
            if (skillName.includes("..") || fileName.includes("..")) {
                return { content: [{ type: "text" as const, text: "Path traversal not allowed" }], isError: true };
            }
            const filePath = join(deps.workspaceRoot, "workspace", "skills", skillName, fileName);
            try {
                const content = await readFile(filePath, "utf-8");
                return { content: [{ type: "text" as const, text: content }] };
            } catch (err) {
                return { content: [{ type: "text" as const, text: `Error reading file: ${err}` }], isError: true };
            }
        },
    );

    mcp.tool(
        "skills_writeFile",
        "Write or update a file in a skill directory. Creates the skill directory if it doesn't exist.",
        {
            skillName: z.string().describe("Skill directory name"),
            fileName: z.string().describe("File name to write"),
            content: z.string().describe("File content"),
        },
        async ({ skillName, fileName, content }) => {
            if (skillName.includes("..") || fileName.includes("..")) {
                return { content: [{ type: "text" as const, text: "Path traversal not allowed" }], isError: true };
            }
            const skillDir = join(deps.workspaceRoot, "workspace", "skills", skillName);
            const filePath = join(skillDir, fileName);
            try {
                await mkdir(dirname(filePath), { recursive: true });
                await writeFile(filePath, content, "utf-8");
                return { content: [{ type: "text" as const, text: JSON.stringify({ written: true, path: filePath }) }] };
            } catch (err) {
                return { content: [{ type: "text" as const, text: `Error writing file: ${err}` }], isError: true };
            }
        },
    );

    mcp.tool(
        "skills_reload",
        "Trigger a hot-reload of all skills and evict idle sandbox instances so they pick up changes on next use. Call this after writing/modifying skill files.",
        async () => {
            try {
                const { reloadAllSkills, getSkillListEntries } = await import("../../sandbox/skill-loader.js");
                const { refreshModuleRegistryCache } = await import("../../subagent/code-act-executor.js");
                const loaded = await reloadAllSkills();
                const entries = getSkillListEntries(loaded);
                refreshModuleRegistryCache();
                const evicted = deps.sandboxPool.invalidateSkills();
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    reloaded: true,
                    count: entries.length,
                    skills: entries.map(e => e.name),
                    sandboxesEvicted: evicted,
                }, null, 2) }] };
            } catch (err) {
                return { content: [{ type: "text" as const, text: `Error reloading skills: ${err}` }], isError: true };
            }
        },
    );
}
