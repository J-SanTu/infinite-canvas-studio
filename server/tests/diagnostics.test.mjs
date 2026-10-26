import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { createDiagnosticLogger, registerLogSecret } from '../lib/diagnostic-log.js';

const root = mkdtempSync(join(tmpdir(), 'santu-logs-'));
test.after(() => rmSync(root, {recursive:true,force:true}));
test('writes immediately, preserves nested network cause and redacts secrets in logs and exported ZIP', () => {
 const logger = createDiagnosticLogger({directory:join(root,'privacy')});
 registerLogSecret('opaque-fixture-private-key');
 const cause = Object.assign(new Error('getaddrinfo ENOTFOUND gateway.test'), {code:'ENOTFOUND'});
 const error = new TypeError('fetch failed at https://user:pass@gateway.test/v1?api_key=hidden#secret opaque-fixture-private-key', {cause});
 assert.equal(logger.write('error','upstream.request.error',{error, apiKey:'fixture-secret', headers:{Authorization:'Bearer other-private',Cookie:'session=private'}, prompt:'private prompt', imageData:'private image', detail:'sk-fixture-abcdef01234'}),true);
 const status = logger.status();
 assert.equal(status.lastError,null);
 const raw = readFileSync(join(status.directory,status.files[0].name),'utf8');
 assert.match(raw,/ENOTFOUND/); assert.match(raw,/cause/);
 assert.doesNotMatch(raw,/opaque-fixture-private-key|fixture-secret|other-private|session=private|private prompt|private image|sk-fixture|user:pass|api_key=hidden/);
 const archive = unzipSync(logger.exportZip());
 const all = Object.values(archive).map(strFromU8).join('\n');
 assert.match(all,/ENOTFOUND/); assert.doesNotMatch(all,/opaque-fixture-private-key|private prompt/);
});
test('rolls files by size and day and enforces retention without deleting unrelated files', () => {
 let date = new Date('2026-10-16T01:00:00Z');
 const directory=join(root,'rotation');
 const logger=createDiagnosticLogger({directory,maxFileBytes:500,maxTotalBytes:1800,retentionDays:30,now:()=>date});
 logger.write('info','start');
 writeFileSync(join(directory,'keep.txt'),'keep');
 const old='diagnostic-2020-01-01-old.jsonl'; writeFileSync(join(directory,old),'old'); utimesSync(join(directory,old),new Date('2020-01-01'),new Date('2020-01-01'));
 for(let i=0;i<12;i++) logger.write('info','operation',{index:i,description:'x'.repeat(200)});
 assert.ok(logger.status().files.length>=2);
 assert.ok(logger.status().files.reduce((n,f)=>n+f.bytes,0)<=1800);
 assert.ok(!readdirSync(directory).includes(old)); assert.ok(readdirSync(directory).includes('keep.txt'));
 date=new Date('2026-10-17T01:00:00Z'); logger.write('info','next.day');
 assert.ok(logger.status().files.some(f=>f.name.startsWith('diagnostic-2026-10-17')));
});
test('filesystem failures never throw into business operations and are visible in status', () => {
 const path=join(root,'not-a-directory');writeFileSync(path,'file');
 const logger=createDiagnosticLogger({directory:path});
 assert.equal(logger.write('info','start'),false);
 assert.ok(logger.status().lastError);
 assert.throws(()=>logger.exportZip(),/日志不可读/);
});
