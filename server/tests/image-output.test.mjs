import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("exact-size output preserves every source edge and its proportions", async () => {
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
        assert.deepEqual(drawn.slice(1,5), [0,0,w,h]);
        assert.ok(Math.abs(drawn[7] / drawn[8] - w / h) < 1e-9);
        assert.ok(drawn[5] >= 0 && drawn[6] >= 0 && drawn[5] + drawn[7] <= tw + 1e-8 && drawn[6] + drawn[8] <= th + 1e-8);
    }
});
