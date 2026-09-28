import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function fixture(exportFailures = 0) {
 const stores = new Map(), reads = [];
 const forage = { createInstance({storeName}) {
   if (!stores.has(storeName)) stores.set(storeName, new Map());
   const data=stores.get(storeName);
   return { getItem: async k=>{ reads.push(k); return data.get(k) ?? null; }, setItem: async(k,v)=>{data.set(k, structuredClone(v));return v;}, removeItem:async k=>data.delete(k), keys:async()=>[...data.keys()], iterate:async fn=>{for(const [k,v] of data) fn(v,k);} };
 }};
 const releases=[], started=[], configs=[];
 let active=0,max=0,compressionCalls=0;
 const requestEdit=async(_config,_prompt,refs)=> {
   configs.push(_config);started.push(refs[0].id);active++;max=Math.max(max,active);
   await new Promise(resolve=>releases.push(()=>{active--;resolve();}));
   return [{dataUrl:'generated'}];
 };
 const mocks = {
   localforage:forage,
   '@/stores/use-config-store':{useConfigStore:{getState:()=>({config:{tinifyApiKey:''}})}},
   '@/services/api/image':{requestEdit},
   '@/services/backend-api-status':{},
 };
 const source=await readFile(new URL('../../src/services/batch-white-tasks.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source+`\nfileDataUrl=async()=>"source";exportJpeg=async()=>{ if (exportFailuresLeft-- > 0) throw Object.assign(new Error("1254×1254"),{name:"NativeResolutionError"}); return "jpg"; };compressWithTinify=async()=>{ compressionHook();return "compressed"; };`, {compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const sandbox={exportFailuresLeft:exportFailures,exports:{},require:id=>mocks[id],console,compressionHook:()=>compressionCalls++};
 vm.runInNewContext(code,sandbox);
 const task={id:'task1',title:'test',createdAt:1,updatedAt:1,size:'800x800',compress:false,items:[0,1,2,3].map(id=>({id:String(id),folder:'A',sourceName:`${id}.jpg`,outputName:`A-${id}.jpg`,file:{size:20},status:'waiting'}))};
 return {api:sandbox.exports,task,stores,reads,releases,started,configs,max:()=>max,compressionCalls:()=>compressionCalls};
}
const tick=()=>new Promise(setImmediate);
test('two workers persist results after page subscription is removed, reject duplicate execution',async()=>{
 const f=await fixture();let notifications=0;
 const unsubscribe=f.api.subscribeBatch(()=>notifications++);
 const running=f.api.executeBatch(f.task,{},f.task.items.map(x=>x.id));
 await tick();assert.deepEqual(f.started,['0','1']);
 unsubscribe();const before=notifications;
 await assert.rejects(f.api.executeBatch(f.task,{},['0']),/后台处理/);
 f.releases[1]();await tick();assert.deepEqual(f.started,['0','1','2']);
 f.releases[2]();await tick();assert.deepEqual(f.started,['0','1','2','3']);
 f.releases[0]();f.releases[3]();await running;
 const saved=await f.api.batchStore.getItem('task:task1');
 assert.equal(saved.items.filter(x=>x.status==='done').length,4);
 assert.equal(f.max(),2);assert.equal(notifications,before);assert.equal(f.api.isBatchRunning(),false);
});
test('compression retry uses saved JPG and never calls image generation; indexed history contains no image payloads',async()=>{
 const f=await fixture();f.task.items=f.task.items.slice(0,1).map(x=>({...x,status:'done',url:'jpg',error:'compression failed'}));
 await f.api.executeBatch(f.task,{},['0'],true);
 const saved=await f.api.batchStore.getItem('task:task1');
 assert.equal(f.started.length,0);assert.equal(f.compressionCalls(),1);
 assert.equal(saved.items[0].url,'compressed');assert.equal(saved.items[0].error,undefined);
 await f.api.listTasks();f.reads.length=0;
 const summaries=await f.api.listTasks();
 assert.equal(f.reads.some(x=>x.startsWith('task:')),false);
 assert.equal(summaries[0].items[0].url,undefined);assert.equal(summaries[0].items[0].file,undefined);
});

test('opening an interrupted compression preserves JPEG for compression-only recovery',async()=>{
 const f=await fixture();f.task.items=[{...f.task.items[0],status:'processing',stage:'压缩中',url:'jpg'}];
 await f.api.persistTask(f.task);
 const task=await f.api.loadTask(f.task.id);
 assert.equal(task.items[0].status,'done');assert.equal(task.items[0].url,'jpg');
 assert.match(task.items[0].error,/仅重试压缩/);
});

test('batch requests canvas 4K preset once, exports selected size without super-resolution',async()=>{
 const f=await fixture();f.task.items=f.task.items.slice(0,1);f.task.size='1600x1600';
 const running=f.api.executeBatch(f.task,{},['0']);await tick();f.releases[0]();await running;
 assert.deepEqual(f.started,['0']);assert.equal(f.configs[0].quality,'high');assert.equal(f.configs[0].size,'1:1');
 const saved=await f.api.batchStore.getItem('task:task1');assert.equal(saved.items[0].status,'done');assert.equal(saved.items[0].url,'jpg');
});
test('export errors retain the generated image without additional model calls',async()=>{
 const f=await fixture(1);f.task.items=f.task.items.slice(0,1);
 const running=f.api.executeBatch(f.task,{},['0']);await tick();f.releases[0]();await running;
 const saved=await f.api.batchStore.getItem('task:task1');assert.deepEqual(f.started,['0']);assert.equal(saved.items[0].status,'failed');assert.equal(saved.items[0].url,'generated');
});
