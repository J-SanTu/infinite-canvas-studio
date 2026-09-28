import test from 'node:test';
import assert from 'node:assert/strict';
import { compressJpeg } from '../lib/tinify.js';
const jpg=Buffer.from([255,216,255,217]);
const getConfig=async()=>({apiKey:'test-only-secret'});
test('Tinify backend authenticates both calls and returns JPEG bytes',async()=>{
 const calls=[];
 const output=await compressJpeg(jpg,{getConfig,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  return calls.length===1?{ok:true,json:async()=>({output:{url:'https://api.tinify.com/output/abc'}})}:{ok:true,arrayBuffer:async()=>jpg};
 }});
 assert.deepEqual(output,jpg);assert.equal(calls.length,2);
 assert.equal(calls[0].options.headers.Authorization,calls[1].options.headers.Authorization);
 assert.equal(calls[1].options.redirect,'error');
});
test('Tinify rejects invalid images, missing keys and unexpected output hosts',async()=>{
 await assert.rejects(compressJpeg(Buffer.from('bad'),{getConfig}),/JPG/);
 await assert.rejects(compressJpeg(jpg,{getConfig:async()=>null}),/本地设置/);
 await assert.rejects(compressJpeg(jpg,{getConfig,fetchImpl:async()=>({ok:true,json:async()=>({output:{url:'https://example.com/leak'}})})}),/无效/);
 await assert.rejects(compressJpeg(jpg,{getConfig,fetchImpl:async()=>({ok:false,status:429})}),/429/);
});
