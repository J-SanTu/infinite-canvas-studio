import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridgeUrl = new URL("../../public/director-bridge.html", import.meta.url);
const bundleUrl = new URL("../../public/monoform/assets/index-tvYA_XCr.js", import.meta.url);

test("Director PNG capture returns to canvas without a browser download", async () => {
    const bundle = await readFile(bundleUrl, "utf8");

    assert.match(bundle, /type:`export`,kind:`image`,blob:/);
    assert.match(bundle, /摄像机截图已添加到画布/);
    assert.doesNotMatch(bundle, /monoform-shot-\$\{o\}-frame-/);
    assert.match(bundle, /\.download=`\$\{t\.name\.replace/);
});

test("Director lock icon reflects the current red locked and blue unlocked state", async () => {
    const bridge = await readFile(bridgeUrl, "utf8");

    assert.match(bridge, /\.director-view-lock\[aria-pressed="true"\][^{]*\{[^}]*color:#ef4444/s);
    assert.match(bridge, /path\.setAttribute\("d", nextLocked \? VISUALLY_CLOSED_LOCK_PATH : VISUALLY_OPEN_LOCK_PATH\)/);
    assert.match(bridge, /dataset\.viewLocked = next \? "1" : "0"/);
    assert.match(bridge, /dataset\.viewLocked !== "1" \|\| !isCanvasInput\(event\)/);
});
