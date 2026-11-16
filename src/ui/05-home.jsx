/* ============================== variables of the current environment ============================== */
/** One row per variable: a matched pair, a connection group, a key only on one side, or a key missing here that
 *  another environment has. Used by Home (search + attention) and Variables. */
function buildVars(an,envName){
  if(!an) return [];
  const a=an.a, out=[];
  a.pairs.forEach(p=>out.push({id:"p:"+p.b.key+"|"+p.s.key,kind:"pair",b:p.b.key,s:p.s.key,bv:p.b.value,sv:p.s.value,status:p.cmp.status,msg:p.cmp.msg}));
  a.composites.forEach(c=>out.push({id:"g:"+c.s.key,kind:"group",b:c.parts.map(x=>x.b.key).join(", "),s:c.s.key,bv:c.parts.map(x=>x.b.value).join(" · "),sv:c.s.value,
    status:c.status==="mismatch"?"mismatch":"ok",msg:c.msg||"Connection group: "+c.parts.length+" BW5 keys vs one Spring URL",parts:c.parts.map(x=>x.b.key)}));
  const inGroups=new Set(); a.composites.forEach(c=>{ inGroups.add("s:"+c.s.key); c.parts.forEach(x=>inGroups.add("b:"+x.b.key)); });
  a.onlyB.forEach(o=>{ if(!inGroups.has("b:"+o.e.key)) out.push({id:"b:"+o.e.key,kind:"onlyB",b:o.e.key,bv:o.e.value,status:"onlyB",msg:"Only in BW5"}); });
  a.onlyS.forEach(o=>{ if(!inGroups.has("s:"+o.e.key)) out.push({id:"s:"+o.e.key,kind:"onlyS",s:o.e.key,sv:o.e.value,status:"onlyS",msg:"Only in Spring"}); });
  ["bw5","spring"].forEach(side=>an.missing[side].forEach(m=>out.push({id:"m:"+side+":"+m.key,kind:"missing",side,b:side==="bw5"?m.key:null,s:side==="spring"?m.key:null,
    status:"missing",msg:"Missing in "+envName+" — "+(side==="bw5"?"BW5":"Spring")+" key exists in "+m.from.map(x=>x.env).join(", "),from:m.from})));
  return out;
}
const VSTAT={mismatch:{l:"MISMATCH",c:"b-bad",r:0},missing:{l:"MISSING HERE",c:"b-bad",r:1},case:{l:"CASE",c:"b-warn",r:2},whitespace:{l:"SPACES",c:"b-warn",r:2},
  empty:{l:"EMPTY",c:"b-warn",r:3},partial:{l:"REVIEW",c:"b-info",r:4},onlyB:{l:"ONLY BW5",c:"b-info",r:5},onlyS:{l:"ONLY SPRING",c:"b-pur",r:5},
  encrypted:{l:"ENCRYPTED",c:"b-pur",r:6},ok:{l:"OK",c:"b-ok",r:7}};
const VBadge=({s})=>{ const m=VSTAT[s]||{l:s,c:"b-gray"}; return <span className={"badge "+m.c}>{m.l}</span>; };
const isProblem=v=>["mismatch","missing","case","whitespace","empty"].indexOf(v.status)>=0;
function searchVars(vars,q){
  const t=String(q||"").trim().toLowerCase(); if(!t) return vars;
  const hit=x=>x!=null&&String(x).toLowerCase().indexOf(t)>=0;
  const score=v=>(String(v.b||"").toLowerCase()===t||String(v.s||"").toLowerCase()===t)?0:(hit(v.b)||hit(v.s))?1:2;
  return vars.filter(v=>hit(v.b)||hit(v.s)||hit(v.bv)||hit(v.sv)).sort((a,b)=>score(a)-score(b)||(VSTAT[a.status]||{r:9}).r-(VSTAT[b.status]||{r:9}).r);
}
/** what to prefill when the user types a name that doesn't exist yet */
function guessNew(q){ const t=String(q||"").trim(); if(!t||/\s/.test(t)) return null;
  return /\./.test(t)||!/_/.test(t)?{bKey:t}:{sKey:t}; }

/* ============================== HOME ============================== */
function HomeTab(p){
  const {hs,envName,envList,parsedAll,analyses,changes,setAddSpec,setTab,switchEnv,pullLatest,busy,setFocusVar,q,setQ,fileOf}=p;
  const [hq,setHq]=useState("");
  const inputRef=useRef(null);
  useEffect(()=>{ const k=e=>{ if(e.key==="/"&&document.activeElement.tagName!=="INPUT"&&document.activeElement.tagName!=="TEXTAREA"){ e.preventDefault(); inputRef.current&&inputRef.current.focus(); } };
    window.addEventListener("keydown",k); return ()=>window.removeEventListener("keydown",k); },[]);
  const an=analyses[envName];
  const vars=useMemo(()=>buildVars(an,envName),[an,envName]);
  if(!hs||!envList.length) return <div className="card"><div className="empty"><span className="spin"></span> Reading your files…</div></div>;
  const results=hq.trim()?searchVars(vars,hq):[];
  const exact=results.some(v=>[v.b,v.s].some(k=>k&&k.toLowerCase()===hq.trim().toLowerCase()));
  const guess=!exact?guessNew(hq):null;
  const open=v=>{ setFocusVar(v.id); setQ(""); setTab("vars"); };
  const myEdits=changes.filter(c=>c.env===envName).length;
  const missingN=an?an.missing.bw5.length+an.missing.spring.length:0;
  /* the attention list */
  const att=[];
  if(an){
    an.w.filter(w=>w.type==="Duplicate key").forEach(w=>att.push({sev:0,badge:"DUPLICATE KEY",cls:"b-bad",key:w.key,text:(w.side==="bw5"?"BW5":"Spring")+": "+w.msg,
      act:"Open",fn:()=>host.call("reveal",{env:envName,side:w.side,key:w.key}).catch(()=>{})}));
    an.a.composites.filter(c=>c.status==="mismatch").forEach(c=>att.push({sev:1,badge:"GROUP",cls:"b-bad",key:c.s.key,text:c.msg,act:"Check",fn:()=>setTab("groups")}));
    vars.filter(v=>v.kind==="pair"&&isProblem(v)).forEach(v=>att.push({sev:v.status==="mismatch"?1:3,badge:VSTAT[v.status].l,cls:VSTAT[v.status].c,key:v.b+"  ⇄  "+v.s,text:v.msg,act:"Fix",fn:()=>open(v)}));
    vars.filter(v=>v.kind==="missing").forEach(v=>att.push({sev:2,badge:"MISSING HERE",cls:"b-bad",key:v.b||v.s,text:v.msg,act:"Add here",fn:()=>open(v)}));
    an.w.filter(w=>w.sev==="high"&&w.type==="Unresolved reference").forEach(w=>att.push({sev:2,badge:"BROKEN ${…}",cls:"b-warn",key:w.key,text:w.msg,act:"Open",fn:()=>host.call("reveal",{env:envName,side:w.side,key:w.key}).catch(()=>{})}));
  }
  att.sort((a,b)=>a.sev-b.sev);
  const Stat=({n,l,color,onClick})=>(<div className="stat" onClick={onClick}><div className="n" style={{color}}>{n}</div><div className="l">{l}</div></div>);
  return (<div>
    <div className="hero">
      <h2>Find a variable</h2>
      <div className="hint" style={{marginBottom:10}}>Search by name or value in <b>{envName}</b> — both files at once. Type a new name to add it everywhere. Press <code className="inline">/</code> to jump here.</div>
      <input ref={inputRef} className="searchbox" autoFocus placeholder="e.g. jndi, 10.230.85.142, ods_database_URL, new.feature.flag…" value={hq} onChange={e=>setHq(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter"){ if(results[0]) open(results[0]); else if(guess) setAddSpec(guess); } if(e.key==="Escape") setHq(""); }}/>
      {hq.trim()&&(<div className="results">
        {results.slice(0,8).map(v=>(<div key={v.id} className="res" onClick={()=>open(v)}>
          <div><VBadge s={v.status}/></div>
          <div><div className="kk2">{v.b?<Hi text={v.b} q={hq}/>:<span className="missing">no BW5 key</span>}</div><div className="vv2">{v.bv!=null?<Hi text={String(v.bv)} q={hq}/>:""}</div></div>
          <div><div className="kk2">{v.s?<Hi text={v.s} q={hq}/>:<span className="missing">no Spring key</span>}</div><div className="vv2">{v.sv!=null?<Hi text={String(v.sv)} q={hq}/>:""}</div></div>
          <div><button className="btn sm">Open</button></div></div>))}
        {results.length>8&&<div className="res" onClick={()=>{ setQ(hq); setTab("vars"); }}><div></div><div className="hint">…{results.length-8} more — show all in Variables</div><div></div><div></div></div>}
        {guess&&(<div className="res" onClick={()=>setAddSpec(guess)} style={{background:"rgba(63,185,80,.06)"}}><div><span className="badge b-ok">NEW</span></div>
          <div><b>＋ Add “{hq.trim()}” as a new variable</b><div className="hint">in BW5 and Spring, in every environment — you set each value</div></div><div></div><div><button className="btn sm pri">Add…</button></div></div>)}
        {!results.length&&!guess&&<div className="res"><div></div><div className="hint">Nothing found.</div><div></div><div></div></div>}
      </div>)}
    </div>

    {!an&&(<div className="banner">⚠ “{envName}” can't be compared yet — {(!fileOf(envName,"bw5")?"the BW5 file":"")+((!fileOf(envName,"bw5")&&!fileOf(envName,"spring"))?" and ":"")+(!fileOf(envName,"spring")?"the Spring file":"")} {(!fileOf(envName,"bw5")&&!fileOf(envName,"spring"))?"are":"is"} not set up.
      <button className="btn sm pri" onClick={()=>setTab("files")}>Set up files</button></div>)}

    {an&&<div className="stats">
      <Stat n={an.problems+an.dups} l="Problems" color={an.problems+an.dups?"var(--bad)":"var(--ok)"} onClick={()=>{ setQ(""); setFocusVar("filter:problems"); setTab("vars"); }}/>
      <Stat n={missingN} l={"Missing in "+envName} color={missingN?"var(--orange)":"var(--ok)"} onClick={()=>{ setQ(""); setFocusVar("filter:missing"); setTab("vars"); }}/>
      <Stat n={an.a.review.length} l="Pairs to confirm" color={an.a.review.length?"var(--info)":"var(--ok)"} onClick={()=>setTab("review")}/>
      <Stat n={changes.length} l="Edits to send" color={changes.length?"var(--warn)":"var(--tx3)"} onClick={()=>setTab("changes")}/>
    </div>}

    <div className="home2">
      <div className="card"><h3>Needs your attention <span className="sub">{envName}{att.length?" · "+att.length:""}</span></h3>
        <div>{att.slice(0,10).map((x,i)=>(<div key={i} className="att"><span className={"badge "+x.cls} style={{flexShrink:0}}>{x.badge}</span>
          <div className="what"><div className="k">{x.key}</div><div className="hint">{x.text}</div></div>
          <button className="btn sm" onClick={x.fn}>{x.act}</button></div>))}
          {an&&!att.length&&<div className="empty"><div className="big">✓</div>Nothing needs attention in {envName}.</div>}
          {att.length>10&&<div className="att"><div className="what hint">…and {att.length-10} more</div><button className="btn sm gh" onClick={()=>setTab("vars")}>See all</button></div>}
        </div></div>
      <div>
        <div className="card" style={{marginBottom:14}}><h3>Environments</h3><div className="pad">
          {envList.map(e=>{ const x=analyses[e.env]; const nEd=changes.filter(c=>c.env===e.env).length; const okFiles=fileOf(e.env,"bw5")&&fileOf(e.env,"spring");
            return (<div key={e.env} className={"envcard"+(e.env===envName?" on":"")} onClick={()=>switchEnv(e.env)}>
              <div className="nm"><span className="envdot" style={{background:!x?"var(--tx3)":x.problems||x.dups?"var(--bad)":"var(--ok)"}}></span>{e.env}
                {e.env===envName&&<span className="badge b-ok">current</span>}</div>
              <div className="hint" style={{marginTop:3}}>{!okFiles?"files not set up":x?(x.problems+x.dups)+" problem(s) · "+(x.missing.bw5.length+x.missing.spring.length)+" missing · "+x.a.review.length+" to confirm":"empty file"}{nEd?" · ✎ "+nEd+" edit(s)":""}</div>
            </div>); })}
        </div></div>
        <div className="card"><h3>Quick actions</h3><div className="pad qa">
          <button className="btn pri" onClick={()=>setAddSpec({})}>＋ Add a new variable (both sides, all environments)</button>
          <button className="btn" disabled={!!busy} onClick={pullLatest}>⤓ Pull latest {(hs&&hs.baseBranch)||"master"} for all repositories</button>
          <button className="btn" disabled={!changes.length} onClick={()=>setTab("changes")}>⎇ Review &amp; send {changes.length||""} edit(s)</button>
          <button className="btn gh" onClick={()=>setTab("files")}>⚙ Files, paths and environments</button>
        </div></div>
      </div>
    </div>
  </div>);
}

/* ============================== VARIABLES ============================== */
function VariablesTab(p){
  const {envName,envList,parsedAll,analyses,changes,editValue,putChanges,addTwin,setAddSpec,focusVar,setFocusVar,q,setQ,fileOf,checkEnvs,twinOf}=p;
  const an=analyses[envName];
  const vars=useMemo(()=>buildVars(an,envName),[an,envName]);
  const [filter,setFilter]=useState("all");
  const [openId,setOpenId]=useState(null);
  const [lim,setLim]=useState(200);
  useEffect(()=>{ if(!focusVar) return; if(/^filter:/.test(focusVar)){ setFilter(focusVar.slice(7)); setOpenId(null); } else { setOpenId(focusVar); setFilter("all"); } setFocusVar(null); },[focusVar]);
  useEffect(()=>{ if(!openId) return; setTimeout(()=>{ const el=document.querySelector('[data-vid="'+CSS.escape(openId)+'"]'); if(el) el.scrollIntoView({block:"center"}); },50); },[openId]);
  if(!an) return <div className="card"><div className="empty">Set up both files of “{envName}” on the Files tab first.</div></div>;
  const edited=new Set(changes.filter(c=>c.env===envName).map(c=>c.side+":"+c.key));
  const FILTERS=[["all","All",()=>true],["problems","Problems",isProblem],["missing","Missing here",v=>v.kind==="missing"],["onlyB","Only BW5",v=>v.kind==="onlyB"],
    ["onlyS","Only Spring",v=>v.kind==="onlyS"],["groups","Connection groups",v=>v.kind==="group"],["edited","Edited",v=>edited.has("bw5:"+v.b)||edited.has("spring:"+v.s)],["ok","OK",v=>v.status==="ok"]];
  const fl=FILTERS.find(f=>f[0]===filter)||FILTERS[0];
  const rows=searchVars(vars,q).filter(fl[2]);
  const sorted=q?rows:rows.slice().sort((a,b)=>(VSTAT[a.status]||{r:9}).r-(VSTAT[b.status]||{r:9}).r||String(a.b||a.s).localeCompare(String(b.b||b.s)));
  return (<div>
    <div className="toolbar">
      <input className="inp" style={{flex:1,minWidth:260}} placeholder={"Search "+vars.length+" variables in "+envName+" by name or value…"} value={q} onChange={e=>setQ(e.target.value)}/>
      <button className="btn pri" onClick={()=>setAddSpec(guessNew(q)||{})}>＋ Add variable</button>
    </div>
    <div className="chips">{FILTERS.map(f=>{ const n=vars.filter(f[2]).length; return <span key={f[0]} className={"chip"+(filter===f[0]?" on":"")} onClick={()=>setFilter(f[0])}>{f[1]} {n}</span>; })}</div>
    <div className="card"><div className="tblwrap"><table><thead><tr><th style={{width:120}}>Status</th><th>BW5 key</th><th>BW5 value</th><th>Spring key</th><th>Spring value</th></tr></thead>
      <tbody>{sorted.slice(0,lim).map(v=>{ const isOpen=openId===v.id;
        return (<React.Fragment key={v.id}>
          <tr className={"vrow"+(isOpen?" open":"")} data-vid={v.id} onClick={()=>setOpenId(isOpen?null:v.id)}>
            <td><VBadge s={v.status}/>{(edited.has("bw5:"+v.b)||edited.has("spring:"+v.s))&&<div className="badge b-warn" style={{marginTop:4}}>EDITED</div>}</td>
            <td className="k">{v.b?<Hi text={v.b} q={q}/>:<span className="missing">—</span>}</td><td className="v">{v.bv!=null?<Hi text={String(v.bv)} q={q}/>:""}</td>
            <td className="k">{v.s?<Hi text={v.s} q={q}/>:<span className="missing">—</span>}</td><td className={"v"+(v.status==="mismatch"?" diff":"")}>{v.sv!=null?<Hi text={String(v.sv)} q={q}/>:""}</td></tr>
          {isOpen&&<tr><td colSpan="5" style={{background:"var(--bg2)"}}><VarDetail v={v} {...p}/></td></tr>}
        </React.Fragment>); })}
        {!sorted.length&&<tr><td colSpan="5" className="empty">Nothing matches.{guessNew(q)&&<div style={{marginTop:10}}><button className="btn pri" onClick={()=>setAddSpec(guessNew(q))}>＋ Add “{q.trim()}” as a new variable</button></div>}</td></tr>}
      </tbody></table></div>
      {sorted.length>lim&&<div className="savebar"><span className="hint">Showing {lim} of {sorted.length}</span><button className="btn sm" onClick={()=>setLim(l=>l+500)}>Show more</button></div>}
    </div>
  </div>);
}

/** one variable across every environment: edit values per environment, add it where it is missing */
function VarDetail({v,envList,parsedAll,changes,editValue,putChanges,addTwin,checkEnvs,twinOf,envName}){
  const keys={bw5:v.kind==="group"?null:v.b,spring:v.s};
  const valueIn=(env,side)=>{ const P=parsedAll[env]&&parsedAll[env][side]; if(!P||!keys[side]) return {state:"nofile"};
    const e=P.entries.find(x=>x.key===keys[side]); return e?{state:"ok",value:e.value}:{state:"missing"}; };
  const addHere=async(env,side,value)=>{
    const issues=C.checkEdit({env,side,key:keys[side],value},checkEnvs,null);
    if(!(await confirmIssues("Add "+keys[side]+" to "+env+"?",issues,"Add anyway"))) return false;
    putChanges([{env,side,op:"add",key:keys[side],value,from:""}]); return true;
  };
  return (<div style={{padding:"6px 4px"}}>
    <div className="hint" style={{marginBottom:8}}>{v.msg}{v.kind==="group"&&" — edit the individual BW5 keys on the Connection groups tab."}</div>
    <table className="grid-env envtable"><thead><tr><th style={{width:130}}>Environment</th><th>BW5 {keys.bw5&&<KeyLink side="bw5" k={keys.bw5} env={envName}/>}</th><th>Spring {keys.spring&&<KeyLink side="spring" k={keys.spring} env={envName}/>}</th></tr></thead>
      <tbody>{envList.map(e=>(<tr key={e.env}><td><b>{e.env}</b>{e.env===envName&&<div className="hint">current</div>}</td>
        {["bw5","spring"].map(side=>{ const x=valueIn(e.env,side);
          if(!keys[side]) return <td key={side}>{v.kind==="group"&&side==="bw5"?<span className="hint">{v.parts.join(", ")}</span>:
            <button className="btn sm" onClick={()=>addTwin(side==="bw5"?"spring":"bw5",keys[side==="bw5"?"spring":"bw5"])}>＋ Create the {side==="bw5"?"BW5":"Spring"} twin…</button>}</td>;
          if(x.state==="nofile") return <td key={side} className="hint">file not set up</td>;
          if(x.state==="missing") return <td key={side}><AddHere onAdd={val=>addHere(e.env,side,val)} suggestion={(valueIn(e.env,side==="bw5"?"spring":"bw5").value)||""}/></td>;
          return <td key={side}><EditCell value={x.value} onSave={val=>editValue(e.env,side,keys[side],val,x.value)}/></td>; })}
      </tr>))}</tbody></table>
  </div>);
}
function AddHere({onAdd,suggestion}){
  const [on,setOn]=useState(false), [val,setVal]=useState(suggestion||"");
  if(!on) return <span><span className="missing">missing</span> <button className="btn sm" onClick={()=>setOn(true)}>＋ add here</button></span>;
  return (<div style={{display:"flex",gap:4}}><input className="inp mono" autoFocus value={val} placeholder="value for this environment" onChange={e=>setVal(e.target.value)}
    onKeyDown={async e=>{ if(e.key==="Enter"&&await onAdd(val)) setOn(false); if(e.key==="Escape") setOn(false); }}/>
    <button className="btn sm pri" onClick={async()=>{ if(await onAdd(val)) setOn(false); }}>Add</button><button className="btn sm gh" onClick={()=>setOn(false)}>✕</button></div>);
}

/* ============================== ADD A VARIABLE ============================== */
function AddVariableDialog({spec,envList,parsedAll,checkEnvs,learned,envName,onAdd,onClose,fileOf}){
  const s0=spec||{};
  const otherKeys=side=>{ const P=parsedAll[envName]||{}; const p=P[side]; return p?p.entries.map(e=>e.key):[]; };
  const [bKey,setBKey]=useState(s0.bKey||"");
  const [sKey,setSKey]=useState(()=>s0.sKey||(s0.bKey?C.suggestTwin(s0.bKey,"bw5",learned,otherKeys("spring")).name:""));
  const [linked,setLinked]=useState(!s0.sKey||!s0.bKey||!!s0.locked);
  const [how,setHow]=useState(s0.how||"");
  const [createB,setCreateB]=useState(s0.createB!==undefined?s0.createB:true);
  const [createS,setCreateS]=useState(s0.createS!==undefined?s0.createS:true);
  const [same,setSame]=useState(true);
  const [values,setValues]=useState(()=>{ const v={}; envList.forEach(e=>{ v[e.env]=Object.assign({bw5:"",spring:""},(s0.values||{})[e.env]||{}); }); return v; });
  const [confirmWarn,setConfirmWarn]=useState(false);
  const firstRef=useRef(null);
  useEffect(()=>{ firstRef.current&&firstRef.current.focus(); const k=e=>{ if(e.key==="Escape") onClose(); }; window.addEventListener("keydown",k); return ()=>window.removeEventListener("keydown",k); },[]);
  const [driver,setDriver]=useState(s0.locked||(s0.sKey&&!s0.bKey?"spring":s0.bKey?"bw5":""));   // which name the user typed first
  const typeB=v=>{ setBKey(v); setConfirmWarn(false);
    if(driver==="spring"&&s0.locked!=="spring"){ setLinked(false); return; }
    if(!driver) setDriver("bw5");
    if(linked&&s0.locked!=="spring"){ const t=C.suggestTwin(v,"bw5",learned,otherKeys("spring")); setSKey(t.name); setHow(t.how); } };
  const typeS=v=>{ setSKey(v); setConfirmWarn(false);
    if(driver==="bw5"&&s0.locked!=="bw5"){ setLinked(false); return; }
    if(!driver) setDriver("spring");
    if(linked&&s0.locked!=="bw5"){ const t=C.suggestTwin(v,"spring",learned,otherKeys("bw5")); setBKey(t.name); setHow(t.how); } };
  const setVal=(env,side,v)=>{ setConfirmWarn(false); setValues(x=>{ const n=Object.assign({},x); n[env]=Object.assign({},n[env],{[side]:v}); if(same&&side==="bw5") n[env].spring=v; if(same&&side==="spring"&&!createB) n[env].bw5=v; return n; }); };
  const theSpec={bKey:bKey.trim(),sKey:sKey.trim(),createB,createS,values};
  const issues=useMemo(()=>C.checkNewVariable(theSpec,checkEnvs),[bKey,sKey,createB,createS,values,checkEnvs]);
  const errors=issues.filter(i=>i.level==="error"), warns=issues.filter(i=>i.level==="warn");
  const targets=envList.reduce((n,e)=>n+(createB&&fileOf(e.env,"bw5")?1:0)+(createS&&fileOf(e.env,"spring")?1:0),0);
  const submit=()=>{ if(errors.length) return; if(warns.length&&!confirmWarn){ setConfirmWarn(true); return; } onAdd(theSpec); };
  const fieldHas=(side,env)=>issues.some(i=>i.side===side&&(env?i.env===env:i.field==="name")&&i.level!=="info");
  return (<div className="modal-back" onClick={onClose}><div className="modal wide" role="dialog" aria-label="Add a variable" onClick={e=>e.stopPropagation()}>
    <div className="modal-h">{s0.locked?"Create the missing twin":"Add a new variable"}</div>
    <div className="modal-b">
      <div className="hint" style={{marginBottom:12}}>It is added to {createB&&createS?"both the BW5 and the Spring file":createB?"the BW5 file":"the Spring file"} of <b>every environment</b> that has its files set up. Set the value for each environment below.</div>
      <div className="grid2">
        <label className="fld"><span><label className="chk" style={{display:"inline-flex"}}><input type="checkbox" checked={createB} disabled={s0.locked==="bw5"} onChange={e=>setCreateB(e.target.checked)}/> BW5 property name</label>
          {s0.locked==="bw5"&&<span className="badge b-gray">exists</span>}</span>
          <input ref={s0.locked==="bw5"?null:firstRef} className={"inp mono"+(fieldHas("bw5")?" bad":"")} placeholder="database.newapp.host" value={bKey} disabled={s0.locked==="bw5"} onChange={e=>typeB(e.target.value)}/></label>
        <label className="fld"><span><label className="chk" style={{display:"inline-flex"}}><input type="checkbox" checked={createS} disabled={s0.locked==="spring"} onChange={e=>setCreateS(e.target.checked)}/> Spring / Helm key</label>
          {s0.locked==="spring"&&<span className="badge b-gray">exists</span>}
          {!s0.locked&&<label className="chk" style={{display:"inline-flex",marginLeft:10}} title="Name the twin automatically"><input type="checkbox" checked={linked} onChange={e=>setLinked(e.target.checked)}/> auto-name the twin</label>}</span>
          <input ref={s0.locked==="bw5"?firstRef:null} className={"inp mono"+(fieldHas("spring")?" bad":"")} placeholder="newapp_database_host" value={sKey} disabled={s0.locked==="spring"}
            onChange={e=>typeS(e.target.value)}/></label>
      </div>
      {how&&createB&&createS&&<div className="hint" style={{marginTop:-6,marginBottom:10}}>Twin name from the {how}. You can change it.</div>}
      <table className="grid-env envtable"><thead><tr><th style={{width:130}}>Environment</th>
        <th>{createB?"BW5 value":<span className="muted">BW5 (not created)</span>}</th>
        <th>{createS?<span>Spring value {createB&&<label className="chk" style={{display:"inline-flex",marginLeft:8,fontWeight:400}}><input type="checkbox" checked={same} onChange={e=>{ setSame(e.target.checked); if(e.target.checked) setValues(x=>{ const n={}; Object.keys(x).forEach(k=>n[k]=Object.assign({},x[k],{spring:x[k].bw5})); return n; }); }}/> same as BW5</label>}</span>:<span className="muted">Spring (not created)</span>}</th></tr></thead>
        <tbody>{envList.map(e=>(<tr key={e.env}><td><b>{e.env}</b></td>
          {["bw5","spring"].map(side=>{ const create=side==="bw5"?createB:createS; const has=!!fileOf(e.env,side);
            if(!create) return <td key={side} className="muted">—</td>;
            if(!has) return <td key={side} className="hint">file not set up — skipped</td>;
            const locked=s0.locked===side;
            return <td key={side}>{locked?<span className="mono">{values[e.env][side]||<span className="missing">(missing)</span>}</span>:
              <input className={"inp mono"+(fieldHas(side,e.env)?" bad":"")} aria-label={e.env+" "+side+" value"} value={values[e.env][side]} disabled={side==="spring"&&same&&createB}
                placeholder={"value in "+e.env} onChange={ev=>setVal(e.env,side,ev.target.value)} onKeyDown={ev=>{ if(ev.key==="Enter") submit(); }}/>}</td>; })}
        </tr>))}</tbody></table>
      <div style={{marginTop:12}}><IssueList issues={issues}/></div>
      {!issues.filter(i=>i.level!=="info").length&&bKey+sKey&&<div className="issue lv-info" style={{marginTop:8}}><span className="ic">✓</span><span>Looks good — {targets} file(s) will get the new key.</span></div>}
    </div>
    <div className="modal-f">
      {confirmWarn&&<span className="hint" style={{marginRight:"auto",color:"var(--warn)"}}>There are {warns.length} warning(s). Press again to add anyway.</span>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={"btn "+(warns.length?"warnbtn":"pri")} disabled={!!errors.length||!targets} onClick={submit}>
        {errors.length?"Fix the ⛔ items first":warns.length?(confirmWarn?"Yes, add anyway":"Add to "+targets+" file(s)…"):"Add to "+targets+" file(s)"}</button>
    </div>
  </div></div>);
}
