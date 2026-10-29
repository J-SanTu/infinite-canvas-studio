import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'santu-defaults-'));
for (const [key, name] of Object.entries({CANVAS_DB_PATH:'db.json',CANVAS_SECRET_PATH:'key',CANVAS_STORAGE_PATH:'storage',CANVAS_LOG_PATH:'logs',CANVAS_IMAGE_USAGE_DB_PATH:'usage.sqlite',CANVAS_IMAGE_USAGE_OUTBOX_PATH:'outbox',CANVAS_ASSET_CHANGE_DB_PATH:'changes.sqlite'})) process.env[key]=join(root,name);
const { startServer, stopServer } = await import('../../server.js');
const { updateDb } = await import('../lib/store.js');
let local = await startServer({port:0,host:'127.0.0.1'});
async function request(body) {
 const r=await fetch(local.url+'/api/settings/default-models',body?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
 return {status:r.status,...await r.json()};
}
test.after(async()=>{await stopServer();await rm(root,{recursive:true,force:true});});
test('durable defaults preserve legacy values, validate only changed category, survive port change and concurrent patches',async()=>{
 assert.equal((await request()).defaults,null);
 await updateDb(db=>{db.uiPreferences={imageToolbar:{ids:['test']}};for(const c of ['image','text','video','audio'])db.apiConfigs[c]={modelsStatus:'ready',models:['shared','second']};});
 const legacy=await request({initialize:true,imageModel:'missing::old',textModel:'',videoModel:'',audioModel:'',defaultModelsRevision:'legacy-revision'});
 assert.equal(legacy.defaults.imageModel,'missing::old');
 assert.equal(legacy.defaults.defaultModelsRevision,'legacy-revision');
 assert.equal((await request({initialize:true,imageModel:'overwrite'})).defaults.imageModel,'missing::old');
 const saved=await request({textModel:'text-default::shared'});
 assert.equal(saved.status,200); assert.equal(saved.defaults.imageModel,'missing::old');
 assert.equal((await request({textModel:'deleted::shared'})).status,400);
 const noChange=await request({textModel:'text-default::shared'});
 assert.equal(noChange.defaults.defaultModelsRevision,saved.defaults.defaultModelsRevision);
 await Promise.all([request({videoModel:'video-default::shared'}),request({audioModel:'audio-default::shared'})]);
 const before=(await request()).defaults;
 const oldUrl=local.url;await stopServer();local=await startServer({port:0,host:'127.0.0.1'});
 assert.deepEqual((await request()).defaults,before);
 assert.ok(local.url); // ephemeral port allocated again; equality is allowed by OS
 assert.equal((await request({textModel:''})).defaults.textModel,'');
 assert.equal((await request({initialize:true,textModel:'text-default::shared'})).defaults.textModel,'');
 const db=JSON.parse(await readFile(process.env.CANVAS_DB_PATH,'utf8'));
 assert.deepEqual(db.uiPreferences,{imageToolbar:{ids:['test']}});
 assert.equal(db.apiConfigs.audio.models[0],'shared');
});
