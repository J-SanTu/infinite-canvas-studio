import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../src/components/canvas/creative-panel.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(savedModel, available=['backend::default','backend::chosen']) {
 const calls=[], changes=[], settings=[];
 const config={textModel:'backend::default'};
 const jsx=(type,props)=>({type,props});
 const modules={
  'react':{useState:v=>[v,()=>{}],useEffect:()=>{},useRef:v=>({current:v})},
  'react/jsx-runtime':{jsx,jsxs:jsx},
  '@/lib/canvas/creative-plan':{composeCreativePrompt:()=> 'preserved prompt'},
  '@/components/model-picker':{ModelPicker:'ModelPicker'},
  '@/stores/use-config-store':{useEffectiveConfig:()=>config,resolveConfiguredModel:(c,cap,local)=>local||c[`${cap}Model`],selectableModelsByCapability:()=>available,useConfigStore:{getState:()=>({openConfigDialog:(...v)=>settings.push(v)})}},
  '@/services/api/image':{requestImageQuestion:async c=>{calls.push(c);return JSON.stringify({description:'scene',copies:[]})}},
  './canvas-node-generation':{buildNodeGenerationContext:()=>({}),hydrateNodeGenerationContext:async c=>c,buildNodeResponseMessages:()=>[]},
  '@/types/canvas':{CanvasNodeType:{Image:'image'}}, './creative-panel.css':{}
 };
 const box={exports:{},require:id=>{assert.ok(id in modules,id);return modules[id]},window:{confirm:()=>true}};
 vm.runInNewContext(code,box);
 const creative={requirements:'test',url:'',ratio:'16:9',description:'',copies:[],roles:{},...(savedModel===undefined?{}:{model:savedModel})};
 const tree=box.exports.CreativePanel({node:{id:'n',metadata:{creative}},nodes:[],connections:[],onChange:c=>changes.push(c),onGenerateImage:async()=>{}});
 const all=[];function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(walk);return;}all.push(x);walk(x.props?.children);}walk(tree);
 return {calls,changes,settings,config,picker:all.find(x=>x.type==='ModelPicker'),run:all.find(x=>x.type==='button'&&x.props.children==='运行创意策划'),api:all.find(x=>x.type==='button'&&x.props.children==='去配置 API')};
}
test('node selection is saved without changing global model; request uses node model',async()=>{
 const r=render('backend::chosen');r.picker.props.onChange('backend::default');assert.equal(r.changes[0].creative.model,'backend::default');assert.equal(r.config.textModel,'backend::default');
 await r.run.props.onClick();assert.equal(r.calls[0].model,'backend::chosen');assert.equal(r.changes.at(-1).creative.model,'backend::chosen');
});
test('legacy node inherits default and pins it after successful planning',async()=>{const r=render();await r.run.props.onClick();assert.equal(r.calls[0].model,'backend::default');assert.equal(r.changes[0].creative.model,'backend::default');});
test('stale node model never silently falls back and is blocked before request',async()=>{const r=render('backend::removed');assert.equal(r.run.props.disabled,true);await r.run.props.onClick();assert.equal(r.calls.length,0);});
test('empty list exposes API settings and blocks requests',async()=>{const r=render(undefined,[]);r.api.props.onClick();assert.deepEqual(r.settings,[[false,'apis']]);await r.run.props.onClick();assert.equal(r.calls.length,0);});
