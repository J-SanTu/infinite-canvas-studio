import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("exact-size output fills the target using centered cover, matching 1.0", async () => {
    let source;
    let drawn;
    const sandbox = {
        exports: {},
        Image: class { set src(_) { [this.width, this.height] = source; this.onload(); } },
        document: { createElement() { return {
            getContext() { return { fillRect() {}, drawImage(...args) { drawn = args; } }; },
            toDataURL() { return `${this.width}x${this.height}`; },
        }; } },
    };
    const code = await readFile(new URL("../../src/lib/canvas/canvas-image-data.ts", import.meta.url), "utf8");
    vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
    for (const [w, h, tw, th] of [[1024,1024,2160,3840], [1600,900,2160,3840], [900,1600,3840,2160], [2160,3840,2160,3840], [1000,1500,5461,8192]]) {
        source = [w, h];
        assert.equal(await sandbox.exports.resizeDataUrlToExactSize("source", { width: tw, height: th }), `${tw}x${th}`);
        assert.deepEqual(drawn.slice(5), [0,0,tw,th]);
        const [sx,sy,sw,sh] = drawn.slice(1,5);
        assert.ok(sx >= 0 && sy >= 0 && sx + sw <= w && sy + sh <= h);
        assert.ok(Math.abs(sx - (w-sw)/2) <= 0.5 && Math.abs(sy - (h-sh)/2) <= 0.5);
        assert.ok(Math.abs(sw/sh - tw/th) < 0.002);
    }
});

test("normalization keeps matching images and tries AI before resize fallback", async () => {
    const code = await readFile(new URL("../../src/services/api/image.ts", import.meta.url), "utf8");
    const start = code.indexOf("async function normalizeImagesToRequestedSize(");
    const end = code.indexOf("async function requestOutputSizeSuperResolution(", start);
    let aiCalls = 0, resizeCalls = 0, fail = false;
    const sandbox = {
        exports: {},
        parseImageDimensions: () => ({ width: 2160, height: 3840 }),
        imageToDataUrl: async ({ dataUrl }) => dataUrl,
        readImageMeta: async (url) => url.endsWith("exact") ? { width: 2160, height: 3840 } : { width: 1024, height: 1024 },
        requestOutputSizeSuperResolution: async () => { aiCalls++; if (fail) throw new Error("upstream failure"); return { dataUrl: "data:image/exact" }; },
        resizeDataUrlToExactSize: async () => { resizeCalls++; return "data:image/resized"; },
    };
    vm.runInNewContext(ts.transpileModule(code.slice(start,end) + "\nexports.normalize = normalizeImagesToRequestedSize;", { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
    const context = { config: { apiFormat: "openai" }, prompt: "poster", aiSuperResolve: true };
    const run = async (url) => (await sandbox.exports.normalize([{ id: "original-id", dataUrl: url }], "2160x3840", context))[0];
    assert.equal((await run("data:image/exact")).dataUrl, "data:image/exact");
    assert.equal(aiCalls, 0);
    assert.equal((await run("data:image/square")).dataUrl, "data:image/exact");
    assert.equal(aiCalls, 1);
    assert.equal(resizeCalls, 0);
    fail = true;
    const result = await run("data:image/square");
    assert.equal(result.id, "original-id");
    assert.equal(result.dataUrl, "data:image/resized");
    assert.equal(aiCalls, 2);
    assert.equal(resizeCalls, 1);
});
