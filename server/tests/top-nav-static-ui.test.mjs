import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const topNavUrl = new URL("../../src/components/layout/app-top-nav.tsx", import.meta.url);
const userActionsUrl = new URL("../../src/components/layout/user-status-actions.tsx", import.meta.url);
const mobileNavUrl = new URL("../../src/components/layout/mobile-nav-drawer.tsx", import.meta.url);

test("desktop navigation exposes local settings without account administration", async () => {
    const source = await readFile(topNavUrl, "utf8");
    const nav = source.match(/<nav[\s\S]*?<\/nav>/)?.[0] || "";

    assert.ok(nav);
    assert.doesNotMatch(nav, /<Dropdown|MoreHorizontal|更多导航/);
    assert.match(source, /<UserStatusActions[\s\S]*?showConfig=\{false\}[\s\S]*?utilityAction=\{[\s\S]*?<Dropdown/);
    assert.match(source, /aria-label="更多导航"/);
    assert.match(source, /hidden size-7[^"]*md:inline-flex/);
    assert.match(source, /label: "本地设置"/);
    assert.doesNotMatch(source, /运营报表|员工管理|admin\/users|admin\/operations/);
});

test("mobile drawer and canvas-compatible local settings remain available", async () => {
    const [actions, mobile] = await Promise.all([readFile(userActionsUrl, "utf8"), readFile(mobileNavUrl, "utf8")]);

    assert.match(actions, /showConfig = true/);
    assert.match(actions, /\{showConfig \? \(/);
    assert.match(actions, /\{utilityAction\}/);
    assert.match(mobile, /navigationTools\.map/);
    assert.doesNotMatch(mobile, /\/admin\//);
});
