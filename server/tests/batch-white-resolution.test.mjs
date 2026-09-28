import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
test('export scales small and large images to every selected size without cropping or GPU',async()=>{
 const source=await readFile(new URL('../../src/services/batch-white-tasks.ts',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function exportJpeg('));
 let dimensions=[1254,1254],drawn,revoked=0;
 const context={fillRect(){},drawImage(...args){drawn=args}};
 const canvas={width:0,height:0,getContext:()=>context,toDataURL:(mime)=>mime};
 const sandbox={exports:{},fetch:async()=>({ok:true,blob:async()=>({})}),URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revoked++},window:{Image:class{set src(_){[this.naturalWidth,this.naturalHeight]=dimensions;this.onload()}}},document:{createElement:()=>canvas}};
 vm.runInNewContext(ts.transpileModule(fn+'\nexports.run=exportJpeg;', {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
 for(const native of [1254,2880]) for(const size of [800,1600,2000]) {
  dimensions=[native,native];assert.equal(await sandbox.exports.run('source',size),'image/jpeg');
  assert.equal(canvas.width,size);assert.equal(canvas.height,size);assert.deepEqual(drawn.slice(1),[0,0,size,size]);
 }
 dimensions=[2000,1000];await sandbox.exports.run('source',1600);assert.deepEqual(drawn.slice(1),[0,400,1600,800]);
 assert.equal(context.imageSmoothingQuality,'high');assert.equal(revoked,7);
 await assert.rejects(sandbox.exports.run('source',NaN),/不支持/);
});
