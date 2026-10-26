import test from 'node:test';
import assert from 'node:assert/strict';
import { captureReferences, buildChatMessages, parseChatReply, validateChatProposal, splitSvgText, requestedChatRatio } from '../../src/lib/canvas/canvas-chat.ts';
const nodes = [{id:'n1',type:'text',title:'原文',metadata:{content:'LIVE-731'}},{id:'image',type:'image',title:'产品',metadata:{content:'data:private-image'}}];
const refs = captureReferences(nodes,['n1','image']);
const reply = (actions) => JSON.stringify({reply:'等待确认',actions});
const update = () => parseChatReply(reply([{kind:'update_text',nodeId:'n1',content:'NEW-9284'}]),'p1',refs,'request').proposals[0];
test('references use current node text and never send raw image payloads',()=>{
 assert.equal(refs[0].text,'LIVE-731'); assert.equal(refs[1].text,undefined);
 assert(!JSON.stringify(buildChatMessages([], 'read', refs)).includes('data:private-image')); assert.throws(()=>captureReferences(nodes,['deleted']));
 assert.equal(captureReferences([{...nodes[0],metadata:{content:'EXTERNAL-CHANGE'}}],['n1'])[0].text,'EXTERNAL-CHANGE');
});
test('multi-turn context separates old references, current state, and action receipt',()=>{
 const p={...update(),status:'cancelled'};
 const messages=buildChatMessages([{role:'user',text:'old',references:[{...refs[0],text:'OLD'}]},{role:'assistant',text:'suggestion',proposals:[p]}],'read',refs);
 assert.equal(messages.length,4);assert.equal(JSON.parse(messages[1].content).historicalReferences[0].text,'OLD');
 assert.equal(JSON.parse(messages[2].content).proposals[0].status,'cancelled');assert.equal(JSON.parse(messages[3].content).latestReferences[0].text,'LIVE-731');
});
test('valid creation/update only become pending proposals',()=>{
 const p=update();assert.equal(p.before,'LIVE-731');assert.equal(p.status,'pending');assert.equal(p.projectId,'p1');assert.equal(nodes[0].metadata.content,'LIVE-731');
 assert.equal(parseChatReply(reply([{kind:'create_text',title:'标题',content:'内容'}]),'p1',[],'create').proposals[0].id,'create-0');
});
test('malformed/unsupported/unreferenced/duplicate actions are rejected atomically',()=>{
 for(const raw of ['bad','null','{}',reply([{kind:'delete_node',content:''}]),reply([{kind:'update_text',nodeId:'other',content:'x'}]),reply([{kind:'update_text',nodeId:'image',content:'x'}]),reply([{kind:'create_text',title:'',content:'x'}]),reply([{kind:'update_text',nodeId:'n1',content:'x'},{kind:'update_text',nodeId:'n1',content:'y'}])]) assert.throws(()=>parseChatReply(raw,'p1',refs,'r'));
});
test('confirmation rejects changed content/title, missing target, wrong project and replay',()=>{
 const p=update();assert.doesNotThrow(()=>validateChatProposal(p,'p1',nodes,new Set()));
 assert.throws(()=>validateChatProposal(p,'p2',nodes,new Set()));assert.throws(()=>validateChatProposal(p,'p1',[],new Set()));
 assert.throws(()=>validateChatProposal(p,'p1',[{...nodes[0],metadata:{content:'manual edit'}}],new Set()));
 assert.throws(()=>validateChatProposal(p,'p1',[{...nodes[0],title:'renamed'}],new Set()));
 assert.throws(()=>validateChatProposal(p,'p1',nodes,new Set([p.id])));
 for(const status of ['applied','cancelled','failed']) assert.throws(()=>validateChatProposal({...p,status},'p1',nodes,new Set()));
 const create=parseChatReply(reply([{kind:'create_text',title:'标题',content:'x'}]),'p1',[],'r').proposals[0];
 assert.throws(()=>validateChatProposal(create,'p1',[{id:'chat-r-0'}],new Set()));
});
test('context overflow gives an error rather than silently losing history',()=>assert.throws(()=>buildChatMessages([],'x'.repeat(181000),[])));

test('SVG code is separated from prose without losing surrounding instructions',()=>{
 const r=splitSvgText('Before <svg viewBox="0 0 1 1"><path d="M0 0"/></svg> after');assert.equal(r.svgs.length,1);assert.equal(r.text,'Before  after');
 assert.equal(splitSvgText('plain text').svgs.length,0);
});
test('plan cards are structured, retain references and respect the latest requested ratio',()=>{
 const ratio=requestedChatRatio([{role:'user',text:'做一个5:4 banner'}],'改用蓝色');assert.equal(ratio,'5:4');
 const raw=JSON.stringify({reply:'选择一个方案',actions:[],plans:[{title:'A',description:'left',prompt:'Detailed A',ratio:'1:1',copy:[]},{title:'B',description:'center',prompt:'Detailed B',ratio:'1:1',copy:['Demo']}]});
 const result=parseChatReply(raw,'p1',refs,'request',ratio);assert.equal(result.plans.length,2);assert.equal(result.plans[0].ratio,'5:4');assert.deepEqual(result.plans[0].referenceIds,['n1','image']);
 assert.equal(result.plans[0].status,'offered');
 const bad=JSON.parse(raw);bad.plans[1].prompt='Detailed A';assert.throws(()=>parseChatReply(JSON.stringify(bad),'p1',refs,'r'));
});
test('vision content includes actual image blocks in a known reference order',()=>{
 const messages=buildChatMessages([],'design',refs,[{id:'image',dataUrl:'data:image/png;base64,TEST'}]);
 assert.equal(messages.at(-1).content[1].type,'image_url');assert.equal(messages.at(-1).content[1].image_url.url,'data:image/png;base64,TEST');
 assert.deepEqual(JSON.parse(messages.at(-1).content[0].text).imageOrder,['image']);
});
test('skills are current request context, old versions are metadata only and protocol stays authoritative',()=>{
 const skill={id:'s1',name:'brand-helper',version:2,description:'Brand',instructions:'CURRENT-INSTRUCTION',files:[{path:'references/a.md',content:'REFERENCE-BYTES'}]};
 const messages=buildChatMessages([{role:'user',text:'old',skills:[{...skill,version:1,instructions:'OLD-INSTRUCTION'}]}],'new',[],[],[skill]);
 assert.match(messages[0].content,/activeSkills/);assert(!messages[1].content.includes('OLD-INSTRUCTION'));assert.equal(JSON.parse(messages[1].content).historicalSkills[0].version,1);assert.equal(JSON.parse(messages.at(-1).content).activeSkills[0].files[0].content,'REFERENCE-BYTES');
 assert.deepEqual(JSON.parse(buildChatMessages([],'plain',[],[]).at(-1).content).activeSkills,[]);
});
