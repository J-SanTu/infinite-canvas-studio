import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
test('JPG export rejects low native resolution and preserves aspect ratio when reducing',async()=>{
 const source=await readFile(new URL('../../src/services/batch-white-tasks.ts',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function exportJpeg('));
 let dimensions=[1024,1024],drawn,revoked=0;
 const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){drawn=args}}),toDataURL:(mime)=>mime};
 const sandbox={exports:{},fetch:async()=>({ok:true,blob:async()=>({})}),URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revoked++},window:{Image:class{set src(_){[this.naturalWidth,this.naturalHeight]=dimensions;this.onload()}}},document:{createElement:()=>canvas}};
 vm.runInNewContext(ts.transpileModule(fn+'\nexports.run=exportJpeg;', {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
 await assert.rejects(sandbox.exports.run('source',1600),/1024×1024/);
 assert.equal(drawn,undefined);assert.equal(revoked,1);
 dimensions=[2048,2048];assert.equal(await sandbox.exports.run('source',1600),'image/jpeg');
 assert.equal(canvas.width,1600);assert.equal(canvas.height,1600);
 assert.deepEqual(drawn.slice(1),[0,0,1600,1600]);
});
