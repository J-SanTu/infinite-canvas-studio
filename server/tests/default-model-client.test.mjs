import { fileURLToPath } from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const memory=new Map();
globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
globalThis.window={localStorage};
const vite=await createServer({ configFile: false, resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } }, optimizeDeps: { noDiscovery: true, include: [] },server:{middlewareMode:true,hmr:false},appType:'custom'});
const {useConfigStore,resolveModelRequestConfig}=await vite.ssrLoadModule('/src/stores/use-config-store.ts');
const {restoreDefaultModels,saveDefaultModel,retryDefaultModels}=await vite.ssrLoadModule('/src/services/default-model-preferences.ts');
const originalFetch=globalThis.fetch;
let disk={imageModel:'',textModel:'text-default::old',videoModel:'',audioModel:'',defaultModelsRevision:'r1'};
let fail=false;let revision=1;
globalThis.fetch=async (_url,init)=>{
 await new Promise(r=>setTimeout(r,5));
 if(fail)throw Error('synthetic storage failure');
 if(init){const input=JSON.parse(init.body);disk={...disk,...input,defaultModelsRevision:`r${++revision}`};}
 return {ok:true,json:async()=>({defaults:{...disk}})};
};
test.after(async()=>{globalThis.fetch=originalFetch;delete globalThis.window;delete globalThis.localStorage;await vite.close();});
test('restore gates generation; serial autosaves survive component-free operation and failed write retries',async()=>{
 assert.throws(()=>resolveModelRequestConfig(useConfigStore.getState().config,'text-default::old'),/恢复/);
 fail=true;await restoreDefaultModels();assert.equal(useConfigStore.getState().defaultsReady,false);assert.match(useConfigStore.getState().defaultsError,/恢复失败/);
 fail=false;await restoreDefaultModels();assert.equal(useConfigStore.getState().config.textModel,'text-default::old');
 await Promise.all([saveDefaultModel('textModel','text-default::a'),saveDefaultModel('textModel','text-default::b'),saveDefaultModel('imageModel','image-default::image')]);
 assert.equal(disk.textModel,'text-default::b');assert.equal(useConfigStore.getState().config.model,'image-default::image');assert.deepEqual(useConfigStore.getState().pendingDefaults,{});
 fail=true;await saveDefaultModel('audioModel','audio-default::voice');
 assert.equal(useConfigStore.getState().defaultsSaveStatus,'error');assert.equal(useConfigStore.getState().pendingDefaults.audioModel,'audio-default::voice');assert.equal(disk.audioModel,'');
 fail=false;retryDefaultModels();await saveDefaultModel('videoModel','video-default::video');
 assert.equal(disk.audioModel,'audio-default::voice');assert.equal(useConfigStore.getState().defaultsSaveStatus,'saved');
 const revisionBefore=disk.defaultModelsRevision;
 useConfigStore.setState(s=>({defaultsReady:false,config:{...s.config,textModel:'stale-browser-value'}}));
 await restoreDefaultModels();assert.equal(useConfigStore.getState().config.textModel,'text-default::b');assert.equal(useConfigStore.getState().config.defaultModelsRevision,revisionBefore);
 useConfigStore.getState().syncApiModels({text:{models:['b'],channels:[{id:'text-default',models:['b'],modelsStatus:'error'}]}});
 assert.equal(useConfigStore.getState().config.textModel,'text-default::b');
 assert.throws(()=>resolveModelRequestConfig(useConfigStore.getState().config,'text-default::b'),/尚未验证/);
});
