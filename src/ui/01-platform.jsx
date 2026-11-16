/* ====================== bridge to the VS Code extension host ======================
   The page runs inside a VS Code webview. Everything that touches the computer (files, git, dialogs,
   clipboard, settings) is a request to the extension host: host.call(type, payload) -> Promise. */
const vscodeApi=(typeof acquireVsCodeApi==="function")?acquireVsCodeApi():null;
const host=(()=>{
  let seq=1; const waiting=new Map(), listeners=new Set();
  window.addEventListener("message",e=>{
    const m=e.data; if(!m) return;
    if(m.replyTo!=null){ const w=waiting.get(m.replyTo); if(!w) return; waiting.delete(m.replyTo);
      if(m.ok) w.res(m.result); else w.rej(new Error(m.error||"Request failed")); return; }
    listeners.forEach(f=>{ try{ f(m); }catch(err){ console.error(err); } });
  });
  return {
    call(type,payload){ return new Promise((res,rej)=>{
      if(!vscodeApi){ rej(new Error("Not running inside VS Code")); return; }
      const id=seq++; waiting.set(id,{res,rej}); vscodeApi.postMessage({id,type,payload:payload||{}}); }); },
    on(fn){ listeners.add(fn); return ()=>listeners.delete(fn); }
  };
})();

/* ============================ storage (UI preferences only) ============================ */
const store={
  get(k,d){ try{ const s=(vscodeApi&&vscodeApi.getState())||{}; return k in s?s[k]:d; }catch(e){ return d; } },
  set(k,v){ try{ const s=Object.assign({},(vscodeApi&&vscodeApi.getState())||{}); s[k]=v; vscodeApi&&vscodeApi.setState(s); }catch(e){} }
};
const EMPTY_LEARNED={rules:[],synonyms:[],mappings:[],rejected:[],ignored:{b:{},s:{}}};
/** VS Code webviews block window.confirm — ask through a VS Code dialog instead. Resolves true/false. */
function ask(message,yes){ return host.call("confirm",{message,yes}).catch(()=>false); }
function download(name,text){ return host.call("saveAs",{name,text}); }

/* ============================ small pieces ============================ */
const STATUS_META={ok:{label:"OK",cls:"b-ok"},mismatch:{label:"MISMATCH",cls:"b-bad"},case:{label:"CASE",cls:"b-warn"},
  whitespace:{label:"WHITESPACE",cls:"b-warn"},empty:{label:"EMPTY",cls:"b-warn"},encrypted:{label:"ENCRYPTED",cls:"b-pur"},
  partial:{label:"REVIEW",cls:"b-info"}};
function Badge({status}){ const m=STATUS_META[status]||{label:String(status).toUpperCase(),cls:"b-gray"}; return <span className={"badge "+m.cls}>{m.label}</span>; }
function Hi({text,q}){
  const s=String(text==null?"":text); if(!q) return <>{s}</>;
  const i=s.toLowerCase().indexOf(q.toLowerCase()); if(i<0) return <>{s}</>;
  return <>{s.slice(0,i)}<span className="hl">{s.slice(i,i+q.length)}</span>{s.slice(i+q.length)}</>;
}
function Score({v}){ return <div><div className="score"><i style={{width:Math.round(v*100)+"%"}}></i></div>
  <span className="muted" style={{fontSize:11}}>{Math.round(v*100)}% confidence</span></div>; }
function EditCell({value,onSave,diff,q}){
  const [ed,setEd]=useState(false), [v,setV]=useState(value);
  useEffect(()=>setV(value),[value]);
  if(!ed) return (<div className="editcell"><span className={"v"+(diff?" diff":"")}><Hi text={value} q={q}/></span>
    <button className="pen" title="edit this value" onClick={e=>{e.stopPropagation();setEd(true);}}>✎</button></div>);
  return (<div style={{display:"flex",gap:4,alignItems:"flex-start"}} onClick={e=>e.stopPropagation()}>
    <textarea className="inp" rows={String(v).length>60?3:1} style={{flex:1,minWidth:120}} autoFocus value={v} onChange={e=>setV(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(); if(v!==value) onSave(v); setEd(false);} if(e.key==="Escape"){setV(value);setEd(false);} }}/>
    <button className="btn sm pri" onClick={()=>{ if(v!==value) onSave(v); setEd(false); }}>✓</button>
    <button className="btn sm gh" onClick={()=>{setV(value);setEd(false);}}>✕</button></div>);
}
/** a key that opens the file at that line when clicked */
function KeyLink({side,k,q,root,env}){
  return <span className="keylink" title="Open in the editor" onClick={e=>{ e.stopPropagation(); host.call("reveal",{env:env||window.__cmcEnv,side,key:k,root:root!=null?root:(window.__cmcRoots||{})[env||window.__cmcEnv]||""}).catch(()=>{}); }}><Hi text={k} q={q}/></span>;
}

/* ============================ pop-ups ============================ */
const LEVEL={error:{icon:"⛔",cls:"lv-err",label:"Must fix"},warn:{icon:"⚠",cls:"lv-warn",label:"Check"},info:{icon:"ℹ",cls:"lv-info",label:"Note"}};
function IssueList({issues,max}){
  const list=(issues||[]).slice().sort((a,b)=>["error","warn","info"].indexOf(a.level)-["error","warn","info"].indexOf(b.level));
  if(!list.length) return null;
  const shown=list.slice(0,max||50);
  return (<div className="issues">{shown.map((i,n)=>(<div key={n} className={"issue "+LEVEL[i.level].cls}>
    <span className="ic">{LEVEL[i.level].icon}</span><span>{i.msg}</span></div>))}
    {list.length>shown.length&&<div className="hint">…and {list.length-shown.length} more</div>}</div>);
}
/** one modal at a time. show({title, body, issues, ok, cancel, danger}) → Promise<boolean> */
const dialogs={set:null};
function showDialog(o){ return new Promise(res=>{ if(!dialogs.set){ res(false); return; } dialogs.set(Object.assign({},o,{done:v=>{ dialogs.set(null); res(v); }})); }); }
/** warn about issues before doing something: errors block, warnings ask, nothing → true at once */
async function confirmIssues(title,issues,okLabel){
  const real=(issues||[]).filter(i=>i.level!=="info");
  if(!real.length) return true;
  const blocked=real.some(i=>i.level==="error");
  return showDialog({title:blocked?title+" — can't do this yet":title, issues:real,
    body:blocked?"Fix the items marked ⛔ first.":"This looks like a mistake. Check before you continue.",
    ok:blocked?null:(okLabel||"Continue anyway"), cancel:blocked?"OK, go back":"Go back and fix", danger:!blocked});
}
function DialogHost(){
  const [d,setD]=useState(null);
  useEffect(()=>{ dialogs.set=setD; return ()=>{ dialogs.set=null; }; },[]);
  useEffect(()=>{ if(!d) return; const k=e=>{ if(e.key==="Escape") d.done(false); }; window.addEventListener("keydown",k); return ()=>window.removeEventListener("keydown",k); },[d]);
  if(!d) return null;
  return (<div className="modal-back" onClick={()=>d.done(false)}><div className={"modal"+(d.wide?" wide":"")} role="dialog" onClick={e=>e.stopPropagation()}>
    <div className="modal-h">{d.title}</div>
    <div className="modal-b">{d.body&&<div style={{marginBottom:10}}>{d.body}</div>}{d.content}<IssueList issues={d.issues}/></div>
    <div className="modal-f">{d.cancel!==false&&<button className="btn" onClick={()=>d.done(false)}>{d.cancel||"Cancel"}</button>}
      {d.ok&&<button className={"btn "+(d.danger?"warnbtn":"pri")} autoFocus onClick={()=>d.done(true)}>{d.ok}</button>}</div>
  </div></div>);
}
