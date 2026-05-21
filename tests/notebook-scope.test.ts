import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transformNotebookCode } from "../src/sandbox/notebook-scope.js";

function runTransformed(code: string, scope: Record<string, unknown>): string {
    const output: string[] = [];
    const transformed = transformNotebookCode(code);
    if (transformed.errors.length > 0) throw new Error(transformed.errors.join(" "));

    const notebookAssign = (name: string, value: unknown): unknown => {
        scope[name] = value;
        return value;
    };
    const notebookDefine = (name: string, value: unknown): unknown => {
        scope[name] = value;
        return value;
    };
    const notebookWith = new Proxy(scope, {
        has(target, key) {
            return typeof key === "string" && Object.prototype.hasOwnProperty.call(target, key);
        },
    });

    const fn = new Function(
        "console",
        "__notebookWith",
        "__notebookAssign",
        "__notebookDefine",
        `with (__notebookWith) { ${transformed.code} }`,
    );
    fn({ log: (...args: unknown[]) => output.push(args.join(" ")) }, notebookWith, notebookAssign, notebookDefine);
    return output.join("\n");
}

describe("notebook-scope transform", () => {
    it("rewrites top-level variables into reusable notebook assignments", () => {
        const scope: Record<string, unknown> = Object.create(null);
        assert.equal(runTransformed("const messages = ['a', 'b']; console.log(messages.length)", scope), "2");
        assert.deepEqual(scope.messages, ["a", "b"]);
        assert.equal(runTransformed("console.log(messages.join(','))", scope), "a,b");
    });

    it("allows repeated const names as overwrites", () => {
        const scope: Record<string, unknown> = Object.create(null);
        runTransformed("const result = 1", scope);
        assert.equal(runTransformed("const result = result + 1; console.log(result)", scope), "2");
        assert.equal(scope.result, 2);
    });

    it("persists destructured bindings", () => {
        const scope: Record<string, unknown> = Object.create(null);
        runTransformed("const { a, nested: { b } } = { a: 1, nested: { b: 2 } }", scope);
        assert.equal(scope.a, 1);
        assert.equal(scope.b, 2);
    });

    it("rejects reserved API names", () => {
        const transformed = transformNotebookCode("const fs = {}");
        assert.ok(transformed.errors.some((error) => error.includes("fs")));
    });
});
