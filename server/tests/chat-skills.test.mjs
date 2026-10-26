import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validateSkill,parseSkillMarkdown,importSkillFiles} from '../lib/chat-skill-schema.js';
const root=await mkdtemp(join(tmpdir(),'santu-chat-skills-'));process.env.CANVAS_DB_PATH=join(root,'app-db.json');
const {saveChatSkill,listChatSkills,deleteChatSkill}=await import('../lib/chat-skills.js');
test.after(()=>rm(root,{recursive:true,force:true}));
const input={name:'banner-helper',description:'品牌图文策划',instructions:'Use exact brand colors.',files:[{path:'references/colors.md',content:'#1A5FA9'}],enabled:true};
test('validates name, resources, total size and disallows executable attachments',()=>{
 assert.equal(validateSkill(input).files[0].content,'#1A5FA9');
 for(const patch of [{name:'Bad Name'},{instructions:''},{files:[{path:'../secrets.md',content:'x'}]},{files:[{path:'scripts/run.js',content:'alert(1)'}]},{files:[{path:'x.md',content:'x'},{path:'X.md',content:'y'}]},{files:[{path:'a.md',content:'a'.repeat(40000)},{path:'b.md',content:'b'.repeat(30000)}]}])assert.throws(()=>validateSkill({...input,...patch}));
});
test('Markdown supports plain text, BOM/CRLF, quoted and block frontmatter',()=>{
 const parsed=parseSkillMarkdown('\uFEFF---\r\nname: brand-guide\r\ndescription: >\r\n  Use brand\r\n  colors\r\n---\r\n# Guidance\r\nStay exact.','SKILL.md');assert.equal(parsed.name,'brand-guide');assert.equal(parsed.description,'Use brand colors');assert.match(parsed.instructions,/Stay exact/);
 assert.equal(parseSkillMarkdown('---\nname: "quoted-skill"\ndescription: "Name: value"\n---\nHello','a.md').description,'Name: value');
 assert.equal(parseSkillMarkdown('# Skill\nSimple guidance.','plain.md').description,'Simple guidance.');assert.throws(()=>parseSkillMarkdown('---\nname: missing','a.md'));
});
test('folder import requires one root and preserves nested reference content',()=>{
 const data=importSkillFiles([{path:'SKILL.md',content:'---\nname: folder-test\ndescription: test\n---\nRead references/colors.md'},{path:'references/colors.md',content:'Exact blue'}]);assert.equal(data.files[0].content,'Exact blue');
 assert.throws(()=>importSkillFiles([{path:'a.md',content:'a'},{path:'b.md',content:'b'}]));assert.throws(()=>importSkillFiles([{path:'nested/SKILL.md',content:'x'}]));
});
test('CRUD persists, duplicate names rejected, concurrent updates use versions',async()=>{
 const {skill}=await saveChatSkill(input);assert.equal(skill.version,1);assert.equal((await listChatSkills()).skills.length,1);
 await assert.rejects(saveChatSkill(input),e=>e.statusCode===409);
 const {skill:updated}=await saveChatSkill({...input,instructions:'New exact copy',expectedVersion:1},skill.id);assert.equal(updated.version,2);
 await assert.rejects(saveChatSkill({...input,expectedVersion:1},skill.id),e=>e.statusCode===409);
 const disk=JSON.parse(await readFile(process.env.CANVAS_DB_PATH,'utf8'));assert.equal(disk.chatSkills[0].instructions,'New exact copy');assert.equal(disk.chatSkills[0].files[0].content,'#1A5FA9');
 await assert.rejects(deleteChatSkill(skill.id,1),e=>e.statusCode===409);await deleteChatSkill(skill.id,2);assert.equal((await listChatSkills()).skills.length,0);
});
