import { useEffect, useState } from "react";
import { Input, Button, App } from "antd";
import { X, Search, PanelsTopLeft, History, Plus, Image as ImageIcon } from "lucide-react";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
import { useThemeStore } from "@/stores/use-theme-store";
import { localForageStorage } from "@/lib/localforage-storage";
import { listGenerationRuns, type GenerationRun } from "@/services/api/generation-runs";
import { useAssetStore } from "@/stores/use-asset-store";

export type WorkflowTemplate = { id: string; title: string; nodes: CanvasNodeData[]; connections: CanvasConnection[] };
const key = "canvas:workflow-templates:v1";
const builtins: WorkflowTemplate[] = [{id:"builtin-product",title:"产品宣传图",nodes:[
    {id:"reference",type:CanvasNodeType.Image,title:"产品参考图",position:{x:0,y:0},width:150,height:150},
    {id:"brief",type:CanvasNodeType.Text,title:"创作要求",position:{x:0,y:240},width:300,height:200,metadata:{content:"描述产品、目标受众、使用场景与画面要求。保留参考图片中的真实产品结构。"}},
    {id:"config",type:CanvasNodeType.Config,title:"生成配置",position:{x:400,y:100},width:340,height:260,metadata:{generationMode:"image",count:1}},
],connections:[{id:"ref",fromNodeId:"reference",toNodeId:"config"},{id:"txt",fromNodeId:"brief",toNodeId:"config"}]}];

async function durableNodes(nodes: CanvasNodeData[]) {
    return Promise.all(nodes.map(async n=> {
        let content=n.metadata?.content;
        if(content?.startsWith("blob:")) {
            const blob=await (await fetch(content)).blob();
            content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
        }
        return {...n, metadata:{...n.metadata,content}};
    }));
}
export function CanvasLibraryPanel({mode,nodes,connections,onClose,onInsert,onLocateRun}:{mode:"templates"|"history";nodes:CanvasNodeData[];connections:CanvasConnection[];onClose:()=>void;onInsert:(t:WorkflowTemplate)=>void;onLocateRun:(run:GenerationRun)=>void}) {
    const dark=useThemeStore(s=>s.theme)==="dark";
    const assets=useAssetStore(s=>s.assets);
    const {message}=App.useApp();
    const [templates,setTemplates]=useState<WorkflowTemplate[]>([]);
    const [runs,setRuns]=useState<GenerationRun[]>([]);
    const [query,setQuery]=useState("");
    const [tab,setTab]=useState("all");
    const [loading,setLoading]=useState(false);
    const [error,setError]=useState("");
    const [name,setName]=useState("");
    const [saving,setSaving]=useState(false);
    useEffect(()=>{let active=true;setError("");setLoading(true);setQuery("");setTab("all");
        const load=async()=>{try {
            if(mode==="templates") {const response=await fetch("/api/canvas/navigation");if(!response.ok)throw new Error("模板加载失败");const stored=await response.json();const legacy=await localForageStorage.getItem(key);const saved=stored.templates || (legacy?JSON.parse(legacy):[]);if(!stored.templates && legacy)await fetch("/api/canvas/navigation",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({templates:saved})});if(active)setTemplates(saved);}
            else {const data=await listGenerationRuns({limit:100});if(active)setRuns(data.runs);}
        }catch(e){if(active)setError(e instanceof Error?e.message:"加载失败");}finally{if(active)setLoading(false);}};
        void load();return()=>{active=false;};
    },[mode]);
    const save=async()=>{if(!name.trim()||!nodes.length)return;setSaving(true);try{
        const entry={id:`template-${Date.now()}`,title:name.trim(),nodes:await durableNodes(nodes),connections};
        const next=[entry,...templates];const response=await fetch("/api/canvas/navigation",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({templates:next})});if(!response.ok)throw new Error("模板保存失败");setTemplates(next);setName("");message.success("模板已保存到本机");
    }catch(e){message.error(e instanceof Error?e.message:"保存失败");}finally{setSaving(false);}};
    useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};document.addEventListener("keydown",esc);return()=>document.removeEventListener("keydown",esc);},[onClose]);
    const choices=mode==="templates"?[["all","全部"],["builtin","内置模板"],["mine","我的模板"]]:[["all","全部"],["image","图片"],["video","视频"],["audio","音频"],["text","文本"]];
    return <div className={`canvas-navigation ${dark?"is-dark":""}`} data-canvas-no-zoom onPointerDown={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()}>
        <aside className="canvas-library-panel" aria-label={mode==="templates"?"工作流模板面板":"生成历史面板"}>
            <header><span className="flex items-center gap-2">{mode==="templates"?<PanelsTopLeft size={18}/>:<History size={18}/>} {mode==="templates"?"工作流模板":"生成历史"}</span><button aria-label="关闭侧面板" onClick={onClose}><X size={18}/></button></header>
            <div className="px-3"><Input prefix={<Search size={15}/>} value={query} placeholder="搜索" onChange={e=>setQuery(e.target.value)}/><div className="canvas-search-filters">{choices.map(([id,title])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{title}</button>)}</div></div>
            <div className="canvas-library-body">
                {loading?<p>正在加载…</p>:error?<p role="alert">{error}</p>:mode==="templates"?<>
                    {(tab==="mine"?templates:tab==="builtin"?builtins:[...builtins,...templates]).filter(t=>t.title.includes(query)).map(t=><button key={t.id} onClick={()=>onInsert(t)}><PanelsTopLeft size={24} className="mb-3 opacity-60"/>{t.title}<small>{t.nodes.length} 个节点 · {t.connections.length} 条连线 · 点击添加到画布</small></button>)}
                    {tab==="mine"&&!templates.length&&<p className="text-xs opacity-60">还没有保存的模板</p>}
                </>:<>
                    {runs.filter(r=>(tab==="all"||r.capability===tab)&&`${r.modelId} ${r.operation} ${r.createdAt}`.includes(query)).map(r=>{
                        const asset=assets.find(a=>r.outputAssetIds.includes(a.id));
                        return <button key={r.id} onClick={()=>onLocateRun(r)} disabled={!r.projectId&&!r.targetNodeId}>
                            {asset?.coverUrl?<img src={asset.coverUrl} className="mb-2 h-24 w-full rounded-lg object-cover"/>:<ImageIcon size={24} className="mb-2 opacity-50"/>}
                            {r.modelId||r.capability}<small>{new Date(r.createdAt).toLocaleString()} · {({succeeded:"已完成",failed:"失败",retryable_failed:"可重试",running:"生成中",queued:"排队中",draft:"草稿",canceled:"已取消"})[r.status]}</small>
                            {r.errorMessageSafe&&<small>{r.errorMessageSafe}</small>}
                        </button>;
                    })}
                    {!runs.length&&<p className="text-xs opacity-60">还没有生成记录。生成后会显示在这里。</p>}
                </>}
            </div>
            {mode==="templates"&&<div className="border-t border-current/10 p-3 space-y-2"><Input placeholder="当前画布的模板名称" value={name} onChange={e=>setName(e.target.value)}/><Button block icon={<Plus size={14}/>} loading={saving} disabled={!name.trim()||!nodes.length||loading} onClick={save}>保存当前画布为模板</Button></div>}
        </aside>
    </div>;
}
