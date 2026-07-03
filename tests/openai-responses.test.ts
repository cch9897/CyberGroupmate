import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectResponseFromStream } from "../src/core/llm/openai-responses.js";

describe("OpenAI Responses stream collection", () => {
    it("accepts Premature close after response.completed", async () => {
        async function* stream() {
            yield { type: "response.output_text.delta", delta: "hel" };
            yield { type: "response.output_text.delta", delta: "lo" };
            yield {
                type: "response.completed",
                response: {
                    output_text: "hello",
                    usage: {
                        input_tokens: 1,
                        output_tokens: 2,
                        total_tokens: 3,
                    },
                },
            };
            throw new Error("Premature close");
        }

        const result = await collectResponseFromStream(stream() as any);

        assert.equal(result.output_text, "hello");
        assert.deepEqual(result.usage, {
            input_tokens: 1,
            output_tokens: 2,
            total_tokens: 3,
        });
    });

    it("does not accept Premature close before response.completed", async () => {
        async function* stream() {
            yield { type: "response.output_text.delta", delta: "partial" };
            throw new Error("Premature close");
        }

        await assert.rejects(
            collectResponseFromStream(stream() as any),
            /Premature close/,
        );
    });
});
