import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as fflate from 'fflate';
const source=await readFile(new URL('../../src/services/batch-white-export.ts',import.meta.url),'utf8');
const sandbox={exports:{},fetch,require:()=>fflate,Uint8Array};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
const image=(folder,status='done')=>({folder,status,outputName:`${folder}-1.jpg`,url:'data:image/jpeg;base64,/9j/2Q=='});
test('folder archive includes only completed pictures from that folder and keeps filenames',async()=>{
 const bytes=await sandbox.exports.createBatchArchive([image('A'),image('B'),{...image('A','failed'),outputName:'A-2.jpg'}],'A');
 const entries=fflate.unzipSync(bytes);assert.deepEqual(Object.keys(entries),['A/A-1.jpg']);
 assert.deepEqual([...entries['A/A-1.jpg']],[255,216,255,217]);
});
test('archive excludes failures, rejects empty selection and path collisions',async()=>{
 await assert.rejects(sandbox.exports.createBatchArchive([image('A','failed')]),/没有可下载/);
 await assert.rejects(sandbox.exports.createBatchArchive([image('A'),image('A')]),/文件名冲突/);
 assert.equal(sandbox.exports.safeExportName('../A'),'.._A');
});
