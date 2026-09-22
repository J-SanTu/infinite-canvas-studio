import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { readProductPage } from "../lib/creative-product-page.js";
const types = { CanvasNodeType: { Creative: "creative", Image: "image", Config: "config" } };
const source = await readFile(new URL("../../src/lib/canvas/creative-plan.ts", import.meta.url), "utf8");
const sandbox = { exports: {}, require: () => types };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
const { composeCreativePrompt, creativeSources } = sandbox.exports;
test("copy edits and deletions preserve manual scene changes without stale text", () => {
    const c = { description: "产品位于右侧，白天", ratio: "16:9", copies: [{ role: "CTA", text: "Shop Now" }] };
    assert.match(composeCreativePrompt(c), /Shop Now/);
    c.copies[0].text = "Find Your Part";
    const updated = composeCreativePrompt(c);
    assert.match(updated, /产品位于右侧，白天/);
    assert.match(updated, /Find Your Part/);
    assert.doesNotMatch(updated, /Shop Now/);
    c.copies = [];
    assert.doesNotMatch(composeCreativePrompt(c), /Find Your Part/);
    assert.equal(composeCreativePrompt({ ...c, description: "" }), "");
});
test("creative sources resolve direct and configuration connections", () => {
    const nodes = [
        { id: "plan", type: "creative" },
        { id: "image", type: "image" },
        { id: "config", type: "config" },
    ];
    assert.equal(creativeSources("image", nodes, [{ fromNodeId: "plan", toNodeId: "image" }])[0].id, "plan");
    assert.equal(
        creativeSources("image", nodes, [
            { fromNodeId: "image", toNodeId: "config" },
            { fromNodeId: "plan", toNodeId: "config" },
        ])[0].id,
        "plan",
    );
    assert.equal(creativeSources("image", nodes, []).length, 0);
});
test("product reader rejects non-web schemes and private addresses", async () => {
    for (const url of ["file:///etc/passwd", "http://example.com", "https://127.0.0.1", "https://192.168.1.1", "https://user:pass@example.com"]) await assert.rejects(readProductPage(url));
});
test("downstream inherits both images once and receives no obsolete prompt", async () => {
    const resources = await readFile(new URL("../../src/lib/canvas/canvas-resource-references.ts", import.meta.url), "utf8");
    const rs = { exports: {}, require: (id) => (id.includes("types/canvas") ? types : { imageReferenceLabel: (i) => `图${i}`, seedanceReferenceLabel: () => "" }) };
    vm.runInNewContext(ts.transpileModule(resources, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, rs);
    const gen = await readFile(new URL("../../src/components/canvas/canvas-node-generation.ts", import.meta.url), "utf8");
    const gs = { exports: {}, require: (id) => (id.includes("types/canvas") ? types : id.includes("canvas-resource") ? rs.exports : { isDirectorReferenceImage: () => false }) };
    vm.runInNewContext(ts.transpileModule(gen, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, gs);
    const nodes = [
        { id: "p", type: "creative", metadata: { prompt: "new copy" } },
        { id: "a", type: "image", metadata: { content: "data:image/a" } },
        { id: "b", type: "image", metadata: { content: "data:image/b" } },
        { id: "out", type: "image" },
    ];
    const edges = [
        { fromNodeId: "p", toNodeId: "out" },
        { fromNodeId: "a", toNodeId: "p" },
        { fromNodeId: "b", toNodeId: "p" },
        { fromNodeId: "a", toNodeId: "out" },
    ];
    const result = gs.exports.buildNodeGenerationContext("out", nodes, edges, "obsolete copy");
    assert.equal(result.prompt, "new copy");
    assert.equal(result.referenceImages.length, 2);
});
