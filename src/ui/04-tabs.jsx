/* ============================== FILES ============================== */
function FilesTab(p){
  const {hs,envName,envList,parsedAll,busy,reload,pullLatest,chooseRepo,setupFolder,chooseFile,changeRoot,roots,addEnvironment,switchEnv,setTab}=p;
  if(!hs||!envList) return <div className="card"><div className="empty"><span className="spin"></span> Starting…</div></div>;
  const base=hs.baseBranch||"master";
  const Side=({env,side,label,cls})=>{
    const e=envList.find(x=>x.env===env)||{}; const o=e[side]||{}; const g=o.git; const P=parsedAll[env]||{};
    return (<div style={{flex:1,minWidth:280}}>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}><span className={"badge "+cls}>{label}</span>
        <span className="mono">{o.rel||<span className="muted">no file chosen</span>}</span></div>
      <div className="kv"><span className="kk">Repository</span><span className="vv">{o.folder||"—"}</span></div>
      {g&&<div className="kv"><span className="kk">Branch</span><span className="vv"><b>{g.branch}</b> {g.commit}
        {g.behind>0&&<> <span className="badge b-warn">{g.behind} behind</span></>}{g.branch!==base&&<> <span className="badge b-warn">not {base}</span></>}
        {g.fileChanged&&<> <span className="badge b-warn">uncommitted edits</span></>}</span></div>}
      {o.gitError&&<div className="hint">Git: {o.gitError}</div>}
      {!o.error&&P[side]&&<div className="kv"><span className="kk">Keys</span><span className="vv">{P[side].entries.length}</span></div>}
      {o.error&&<div className="banner" style={{margin:"8px 0 0"}}>⚠ {o.error}</div>}
      <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
        {o.abs&&<button className="btn sm" onClick={()=>host.call("reveal",{env,side}).catch(()=>{})}>Open file</button>}
        {o.code!=="no-repo"&&<button className={"btn sm"+(o.code==="no-file"?" pri":"")} disabled={!!busy} onClick={()=>chooseFile(env,side)}>{o.code==="no-file"?"Pick the file…":"Pick a different file…"}</button>}
        {o.code==="no-repo"&&<button className="btn sm pri" disabled={!!busy} onClick={setupFolder} title="Pick one folder: both repositories are cloned there (or used, if already there)">Clone both into a folder…</button>}
        <button className="btn sm gh" disabled={!!busy} onClick={()=>chooseRepo(env,side)}>{o.code==="no-repo"?"I already cloned it — choose folder…":"Change repository…"}</button>
      </div>
    </div>);
  };
  return (<div>
    <div className="toolbar">
      <h3 style={{margin:0,fontSize:14}}>Environments and files</h3>
      <span className="hint">Paths live in your VS Code settings. Pick a file once and it is remembered.</span>
      <div className="spacer"></div>
      <button className="btn sm gh" onClick={()=>host.call("openSettings")}>⚙ Edit settings</button>
      <button className="btn sm gh" disabled={!!busy} onClick={addEnvironment}>＋ Environment</button>
      <button className="btn sm" disabled={!!busy} onClick={()=>reload({env:envName})}>↻ Reload</button>
      <button className="btn sm pri" disabled={!!busy} onClick={pullLatest} title={"Switches both repos to "+base+" and pulls"}>⤓ Pull latest {base}</button>
    </div>
    {envList.map(e=>{ const P=parsedAll[e.env]||{};
      return (<div key={e.env} className={"card"+(e.env===envName?" envsel":"")} style={{marginBottom:14}}>
        <h3 style={{cursor:"pointer"}} onClick={()=>switchEnv(e.env)}>{e.env}{e.env===envName&&<span className="badge b-ok">current</span>}</h3>
        <div className="pad"><div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
          <Side env={e.env} side="bw5" label="BW5" cls="b-info"/><Side env={e.env} side="spring" label="SPRING" cls="b-pur"/></div>
          {!!(P.probe&&(P.probe.blocks||[]).length)&&(<div style={{display:"flex",gap:8,alignItems:"center",marginTop:12,flexWrap:"wrap"}}>
            <span className="hint">YAML block holding the properties:</span>
            <select className="inp" style={{maxWidth:330}} value={roots[e.env]||"__AUTO__"} onChange={ev=>changeRoot(e.env,ev.target.value)}>
              <option value="__AUTO__">Auto-detect — {P.autoRoot}</option><option value="__ALL__">Whole file</option>
              {(P.probe.blocks||[]).map(b=><option key={b.path} value={b.path}>{b.path} ({b.count} keys)</option>)}</select></div>)}
        </div></div>);
    })}
  </div>);
}

/* ============================== COMPARISON ============================== */
function CompareTab({q,setQ,queue,ignore,pairRows,counts,statusFilter,setStatusFilter,changes,unmap,limit,setLimit}){
  return (<div>
    <div className="toolbar">
      <input className="inp" style={{maxWidth:260}} placeholder="Search key or value…" value={q} onChange={e=>setQ(e.target.value)}/>
      {Object.keys(STATUS_META).map(s=>(<label key={s} className="chk"><input type="checkbox" checked={!!statusFilter[s]}
        onChange={e=>setStatusFilter(f=>Object.assign({},f,{[s]:e.target.checked}))}/><Badge status={s}/><span className="muted">{counts[s]||0}</span></label>))}
      <div className="spacer"></div>
      <button className="btn sm" onClick={()=>setStatusFilter({ok:true,mismatch:true,case:true,whitespace:true,empty:true,encrypted:true,partial:true})}>all</button>
      <button className="btn sm" onClick={()=>setStatusFilter({mismatch:true,case:true,whitespace:true,empty:true})}>problems only</button>
    </div>
    <div className="card"><div className="tblwrap"><table>
      <thead><tr><th style={{width:100}}>Status</th><th>BW5 key</th><th>BW5 value</th><th>Spring key</th><th>Spring value</th><th style={{width:90}}>Via</th><th style={{width:70}}></th></tr></thead>
      <tbody>{pairRows.slice(0,limit).map((p,i)=>{
        const pb=changes.find(c=>c.side==="bw5"&&c.key===p.b.key), ps=changes.find(c=>c.side==="spring"&&c.key===p.s.key);
        return (<tr key={i}>
          <td><Badge status={p.cmp.status}/>{(pb||ps)&&<div className="badge b-warn" style={{marginTop:4}}>EDITED</div>}</td>
          <td className="k"><KeyLink side="bw5" k={p.b.key} q={q}/></td>
          <td><EditCell value={pb?pb.value:p.b.value} q={q} onSave={v=>queue("bw5","set",p.b.key,v,p.b.value)}/></td>
          <td className="k"><KeyLink side="spring" k={p.s.key} q={q}/></td>
          <td><EditCell value={ps?ps.value:p.s.value} q={q} diff={p.cmp.status==="mismatch"} onSave={v=>queue("spring","set",p.s.key,v,p.s.value)}/>
            {p.cmp.status!=="ok"&&<div className="muted" style={{fontSize:11,marginTop:3}}>{p.cmp.msg}</div>}
            {p.cmp.status!=="ok"&&p.cmp.status!=="encrypted"&&(<div className="fixbtns" style={{marginTop:5}}>
              <button className="btn sm" onClick={()=>queue("bw5","set",p.b.key,p.s.value,p.b.value)}>⇦ take Spring</button>
              <button className="btn sm" onClick={()=>queue("spring","set",p.s.key,p.b.value,p.s.value)}>take BW5 ⇨</button></div>)}</td>
          <td><span className={"badge "+(p.how==="manual"?"b-info":p.how==="rule"?"b-pur":"b-gray")} title={p.reasons.join("; ")}>{p.how}{p.how==="auto"?" "+Math.round(p.score*100)+"%":""}</span></td>
          <td>{p.how==="manual"?<button className="btn sm gh" onClick={()=>unmap(p.b.key)}>unmap</button>
            :<button className="btn sm gh" onClick={()=>ignore("b",p.b.key)}>ignore</button>}</td></tr>); })}
        {!pairRows.length&&<tr><td colSpan="7" className="empty">No pairs match this filter.</td></tr>}</tbody></table></div>
      {pairRows.length>limit&&<div className="pad" style={{textAlign:"center"}}><button className="btn" onClick={()=>setLimit(l=>l+500)}>Show more</button></div>}
    </div></div>);
}

function GroupsTab({composites,queue}){
  return (<div>
    <div className="banner info">BW5 keeps <code className="inline">host</code>, <code className="inline">port</code> and <code className="inline">sid</code> as separate
      properties; Spring folds them into one JDBC URL. Each group is treated as one setting and every part is checked against the URL.</div>
    {composites.map((c,i)=>(<div className="card" key={i} style={{marginBottom:12}}>
      <h3><span className={"badge "+(c.status==="ok"?"b-ok":"b-bad")}>{c.status==="ok"?"CONSISTENT":"MISMATCH"}</span><span className="k">{c.s.key}</span>
        <span className="spacer"></span><span className="sub">{c.cluster.bk} ⇄ {c.cluster.sk}</span></h3>
      <div className="pad" style={{paddingBottom:6}}>
        <div className="v" style={{maxWidth:"none",marginBottom:10}}>{c.s.value}</div>
        <table><thead><tr><th style={{width:90}}>Part</th><th style={{width:100}}>Result</th><th>BW5 key</th><th>BW5 value</th><th>Detail</th></tr></thead>
          <tbody>{c.parts.map((pt,j)=>(<tr key={j}><td><span className="badge b-gray">{pt.role}</span></td><td><Badge status={pt.cmp.status}/></td>
            <td className="k">{pt.b.key}</td><td><EditCell value={pt.b.value} diff={pt.cmp.status==="mismatch"} onSave={v=>queue("bw5","set",pt.b.key,v,pt.b.value)}/></td>
            <td className="muted" style={{fontSize:11}}>{pt.cmp.msg}</td></tr>))}</tbody></table>
      </div></div>))}
    {!composites.length&&<div className="card"><div className="empty">No Spring JDBC URL lined up with a BW5 host/port group.</div></div>}
  </div>);
}

function ReviewTab({review,onConfirm,onReject,onIgnore,q,setQ}){
  const rows=review.filter(r=>!q||(r.b.key+r.s.key+r.b.value+r.s.value).toLowerCase().indexOf(q.toLowerCase())>=0);
  return (<div>
    <div className="banner info">These look related, but the engine is not sure enough to decide alone. Confirming one saves the pair,
      teaches the word table and — when a shape is visible — writes a pattern rule that matches every similar key from then on.</div>
    <div className="toolbar"><input className="inp" style={{maxWidth:260}} placeholder="Search…" value={q} onChange={e=>setQ(e.target.value)}/><span className="hint">{rows.length} waiting</span></div>
    {rows.map((r,i)=>(<div className="rev" key={i}>
      <div className="body">
        <div className="half"><span className="badge b-info">BW5</span><div className="k" style={{fontSize:12.5,marginTop:6}}>{r.b.key}</div>
          <div className="v" style={{marginTop:4}}>{r.b.value||<span className="muted">(empty)</span>}</div></div>
        <div className="half"><span className="badge b-pur">SPRING</span> <Badge status={r.cmp.status}/><div className="k" style={{fontSize:12.5,marginTop:6}}>{r.s.key}</div>
          <div className="v" style={{marginTop:4}}>{r.s.value||<span className="muted">(empty)</span>}</div>
          {r.cmp.status!=="ok"&&<div className="hint" style={{marginTop:5}}>{r.cmp.msg}</div>}</div>
      </div>
      <div className="pad" style={{paddingTop:10,paddingBottom:0}}><div className="why"><b style={{color:"var(--tx)"}}>Why the engine paired these</b>
        <ul>{r.reasons.map((x,j)=><li key={j}>{x}</li>)}</ul></div>
        {!!r.alternatives.length&&<div className="hint" style={{marginTop:6}}>Other candidates: {r.alternatives.map(a=>a.key+" ("+Math.round(a.score*100)+"%)").join(" · ")}</div>}</div>
      <div className="foot"><div style={{width:150}}><Score v={r.score}/></div><div className="spacer"></div>
        <button className="btn ok" onClick={()=>onConfirm(r.b.key,r.s.key)}>✓ Confirm pair</button>
        <button className="btn" onClick={()=>onReject(r.b.key,r.s.key)}>✕ Not a match</button>
        <button className="btn gh sm" onClick={()=>onIgnore("b",r.b.key)}>ignore this BW5 key</button></div>
    </div>))}
    {!rows.length&&<div className="card"><div className="empty"><div className="big">✅</div>Nothing waiting for review.</div></div>}
  </div>);
}

function OrphanTab({side,rows,all,pick,setPick,onlySug,setOnlySug,q,setQ,queue,ignore,copy,say,onConfirm,queueMany,limit,setLimit,addTwin}){
  const isB=side==="b";
  const item=all.find(o=>o.e.key===pick);
  const target=isB?"spring":"bw5";
  const conv=k=>isB?E.toEnvKey(k):E.toPropKey(k);
  return (<div className="split">
    <div>
      <div className="toolbar">
        <input className="inp" style={{maxWidth:240}} placeholder="Search…" value={q} onChange={e=>setQ(e.target.value)}/>
        {isB&&<label className="chk"><input type="checkbox" checked={onlySug} onChange={e=>setOnlySug(e.target.checked)}/> only keys with a likely Spring twin</label>}
        <div className="spacer"></div>
        <button className="btn sm pri" disabled={!rows.length} onClick={()=>{ queueMany(target,"add",rows.map(o=>({key:conv(o.e.key),value:o.e.value}))); say(rows.length+" key(s) queued for the "+(isB?"Spring":"BW5")+" file"); }}>
          + add all {rows.length} to {isB?"Spring":"BW5"}</button>
        <button className="btn sm" onClick={()=>copy(rows.map(o=>isB?"  "+conv(o.e.key)+": "+E.yamlScalar(o.e.value):conv(o.e.key)+"="+o.e.value).join("\n"),"Copied")}>⧉ copy</button>
      </div>
      <div className="card"><h3>{isB?"In BW5, not in Spring":"In Spring, not in BW5"} <span className="sub">{rows.length} keys</span></h3>
        <div className="tblwrap"><table><thead><tr><th>{isB?"BW5":"Spring"} key</th><th>Value</th><th style={{width:230}}>Closest {isB?"Spring":"BW5"} key</th><th style={{width:120}}></th></tr></thead>
          <tbody>{rows.slice(0,limit).map((o,i)=>{ const top=o.sug[0]; const other=top?(isB?top.s:top.e):null;
            return (<tr key={i} className={pick===o.e.key?"sel":""} onClick={()=>setPick(o.e.key)} style={{cursor:"pointer"}}>
              <td className="k"><Hi text={o.e.key} q={q}/></td><td className="v"><Hi text={o.e.value} q={q}/></td>
              <td>{other?<div><span className="k">{other.key}</span><Score v={top.score}/></div>:<span className="muted" style={{fontSize:11.5}}>no candidate</span>}</td>
              <td className="fixbtns"><button className="btn sm pri" title="Create its twin in every environment" onClick={e=>{e.stopPropagation();addTwin(isB?"bw5":"spring",o.e.key);}}>+ {isB?"Spring":"BW5"}</button>
                <button className="btn sm gh" onClick={e=>{e.stopPropagation();ignore(side,o.e.key);}}>skip</button></td></tr>); })}
            {!rows.length&&<tr><td colSpan="4" className="empty">Nothing here.</td></tr>}</tbody></table></div>
        {rows.length>limit&&<div className="pad" style={{textAlign:"center"}}><button className="btn" onClick={()=>setLimit(l=>l+500)}>Show more ({rows.length-limit} hidden)</button></div>}
      </div>
    </div>
    <div className="side">{!item?(<div className="card"><div className="pad hint"><b style={{color:"var(--tx)"}}>Pair it by hand</b><br/><br/>
        Click a row. This panel shows the closest keys in the other file, why the engine thinks so, and each value — confirm one and the engine learns from it.</div></div>):
      (<div className="card"><h3>{isB?"BW5 key":"Spring key"}<span className="spacer"></span><button className="btn sm gh" onClick={()=>setPick(null)}>✕</button></h3>
        <div className="pad"><div className="k" style={{fontSize:12.5,marginBottom:4}}>{item.e.key}</div>
          <div className="v" style={{marginBottom:12}}>{item.e.value||<span className="muted">(empty)</span>}</div>
          {item.sug.length?item.sug.map((s,i)=>{ const other=isB?s.s:s.e;
            const cmp=isB?E.compareValues(item.e.key,item.e.value,other.key,other.value,{}):E.compareValues(other.key,other.value,item.e.key,item.e.value,{});
            return (<div className="sug" key={i}><div style={{display:"flex",gap:6,alignItems:"center"}}><span className="k" style={{flex:1}}>{other.key}</span><Badge status={cmp.status}/></div>
              <div className="kv"><span className="kk">value</span><span className="vv">{other.value||"(empty)"}</span></div><Score v={s.score}/>
              {!!(s.reasons||[]).length&&<div className="hint" style={{marginTop:5}}>{s.reasons.slice(0,3).join(" · ")}</div>}
              <div style={{display:"flex",marginTop:7}}><span className="spacer"></span>
                <button className="btn sm ok" onClick={()=>{ isB?onConfirm(item.e.key,other.key):onConfirm(other.key,item.e.key); setPick(null); }}>Confirm pair</button></div></div>); })
            :<div className="hint">No similar key — it is probably really missing.</div>}
        </div></div>)}</div>
  </div>);
}

function WarnTab({warnings,warnRows,sevFilter,setSevFilter,q,setQ,limit}){
  return (<div>
    <div className="toolbar"><input className="inp" style={{maxWidth:240}} placeholder="Search…" value={q} onChange={e=>setQ(e.target.value)}/>
      {["high","med","low"].map(s=>(<label key={s} className="chk"><input type="checkbox" checked={sevFilter[s]} onChange={e=>setSevFilter(f=>Object.assign({},f,{[s]:e.target.checked}))}/>
        <span className={"badge "+(s==="high"?"b-bad":s==="med"?"b-warn":"b-gray")}>{s}</span><span className="muted">{warnings.filter(w=>w.sev===s).length}</span></label>))}</div>
    <div className="card"><div className="tblwrap"><table><thead><tr><th style={{width:70}}>Sev</th><th style={{width:70}}>Side</th><th style={{width:150}}>Type</th><th>Key</th><th>Detail</th></tr></thead>
      <tbody>{warnRows.slice(0,limit).map((w,i)=>(<tr key={i}><td><span className={"badge "+(w.sev==="high"?"b-bad":w.sev==="med"?"b-warn":"b-gray")}>{w.sev}</span></td>
        <td><span className={"badge "+(w.side==="bw5"?"b-info":w.side==="spring"?"b-pur":"b-gray")}>{w.side}</span></td><td style={{fontSize:12}}>{w.type}</td>
        <td className="k"><Hi text={w.key} q={q}/>{w.extra&&<div className="muted" style={{fontSize:11}}>↔ {w.extra}</div>}</td><td className="muted" style={{fontSize:12}}>{w.msg}</td></tr>))}
        {!warnRows.length&&<tr><td colSpan="5" className="empty">No warnings for this filter.</td></tr>}</tbody></table></div></div>
  </div>);
}

/* ================================ RULES ================================ */
function RulesTab({learned,saveLearned,bwParsed,spParsed,unignore,say,copy,opts,setOpts,analysis,setAddSpec}){
  const [nr,setNr]=useState({bw5:"",spring:""});
  const preview=useMemo(()=>{ if(!nr.bw5||!nr.spring) return null; try{ return E.applyRules([{bw5:nr.bw5,spring:nr.spring}],bwParsed.entries,spParsed.entries); }catch(e){ return null; } },[nr,bwParsed,spParsed]);
  const L=Object.assign({},EMPTY_LEARNED,learned);
  const del=(k,i)=>saveLearned(Object.assign({},L,{[k]:(L[k]||[]).filter((_,j)=>j!==i)}));
  const ignored=[].concat(Object.keys((L.ignored||{}).b||{}).map(k=>({side:"b",key:k})),Object.keys((L.ignored||{}).s||{}).map(k=>({side:"s",key:k})));
  const importAll=txt=>{ try{ const d=JSON.parse(txt); saveLearned(Object.assign({},EMPTY_LEARNED,d)); say("Dictionary imported"); }catch(e){ say("Invalid JSON: "+e.message); } };
  return (<div>
    <div className="grid2" style={{marginBottom:14}}>
      <div className="card"><h3>New variables</h3><div className="pad"><div className="hint" style={{marginBottom:10}}>A new variable is created on both sides and in every environment, using these rules to name its twin.</div>
        <button className="btn pri" onClick={()=>setAddSpec({})}>＋ Add a variable</button></div></div>
      <div className="card"><h3>Matcher</h3><div className="pad">
        <div className="hint">Pair automatically above <b>{Math.round(opts.autoThreshold*100)}%</b> confidence</div>
        <input type="range" min="50" max="95" value={opts.autoThreshold*100} style={{width:"100%",accentColor:"var(--acc)"}}
          onChange={e=>setOpts(o=>Object.assign({},o,{autoThreshold:Number(e.target.value)/100}))}/>
        <div className="hint" style={{marginTop:8}}>Send to Review above <b>{Math.round(opts.reviewThreshold*100)}%</b></div>
        <input type="range" min="25" max="70" value={opts.reviewThreshold*100} style={{width:"100%",accentColor:"var(--acc)"}}
          onChange={e=>setOpts(o=>Object.assign({},o,{reviewThreshold:Number(e.target.value)/100}))}/>
        <label className="chk" style={{marginTop:10}}><input type="checkbox" checked={opts.caseSensitive}
          onChange={e=>setOpts(o=>Object.assign({},o,{caseSensitive:e.target.checked}))}/> Case-sensitive values</label>
        <div style={{marginTop:10}}>{Object.keys((analysis.stats||{}).byHow||{}).map(h=>(<div key={h} className="kv"><span className="kk" style={{minWidth:90}}>{h}</span><span className="vv">{analysis.stats.byHow[h]}</span></div>))}</div>
      </div></div>
    </div>

    <div className="card" style={{marginBottom:14}}><h3>Pattern rules <span className="sub">one rule pairs a whole family of keys</span></h3>
      <div className="pad"><div className="hint" style={{marginBottom:10}}>Use <code className="inline">{"{x}"}</code> for the varying part, e.g.
        <code className="inline">database.{"{x}"}.password</code> ⇄ <code className="inline">{"{x}"}_database_password</code>. Confirming pairs on the Review tab writes these for you.</div>
        <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
          <label className="fld" style={{flex:1,minWidth:220,marginBottom:0}}><span>BW5 pattern</span><input className="inp mono" value={nr.bw5} onChange={e=>setNr(n=>Object.assign({},n,{bw5:e.target.value}))}/></label>
          <label className="fld" style={{flex:1,minWidth:220,marginBottom:0}}><span>Spring pattern</span><input className="inp mono" value={nr.spring} onChange={e=>setNr(n=>Object.assign({},n,{spring:e.target.value}))}/></label>
          <button className="btn pri" disabled={!preview||!preview.length} onClick={()=>{ saveLearned(Object.assign({},L,{rules:L.rules.concat([{bw5:nr.bw5,spring:nr.spring,source:"manual"}])})); setNr({bw5:"",spring:""}); say("Rule added"); }}>
            Add rule{preview?" ("+preview.length+" matches)":""}</button></div>
        {preview&&!!preview.length&&<pre className="out" style={{marginTop:10}}>{preview.slice(0,12).map(p=>p.b.key+"  ⇄  "+p.s.key).join("\n")}</pre>}
        {preview&&!preview.length&&<div className="hint" style={{marginTop:8,color:"var(--warn)"}}>No key pairs match this pattern.</div>}</div>
      <div className="tblwrap"><table><thead><tr><th>BW5 pattern</th><th>Spring pattern</th><th style={{width:90}}>Source</th><th>Learned from</th><th style={{width:50}}></th></tr></thead>
        <tbody>{L.rules.map((r,i)=>(<tr key={i}><td className="k">{r.bw5}</td><td className="k">{r.spring}</td><td><span className={"badge "+(r.source==="learned"?"b-pur":"b-gray")}>{r.source||"manual"}</span></td>
          <td className="muted" style={{fontSize:11}}>{r.sample||""}</td><td><button className="btn sm gh" onClick={()=>del("rules",i)}>✕</button></td></tr>))}
          {!L.rules.length&&<tr><td colSpan="5" className="empty">No rules yet.</td></tr>}</tbody></table></div></div>

    <div className="grid2">
      <div className="card"><h3>Learned word equivalents <span className="sub">{L.synonyms.length}</span></h3><div className="tblwrap" style={{maxHeight:260,overflowY:"auto"}}><table>
        <thead><tr><th>BW5 word</th><th>Spring word</th><th style={{width:50}}></th></tr></thead>
        <tbody>{L.synonyms.map((s,i)=>(<tr key={i}><td className="k">{s.from}</td><td className="k">{s.to||"(dropped)"}</td><td><button className="btn sm gh" onClick={()=>del("synonyms",i)}>✕</button></td></tr>))}
          {!L.synonyms.length&&<tr><td colSpan="3" className="empty">Nothing learned yet.</td></tr>}</tbody></table></div></div>
      <div className="card"><h3>Confirmed pairs <span className="sub">{L.mappings.length}</span></h3><div className="tblwrap" style={{maxHeight:260,overflowY:"auto"}}><table>
        <thead><tr><th>BW5</th><th>Spring</th><th style={{width:50}}></th></tr></thead>
        <tbody>{L.mappings.map((m,i)=>(<tr key={i}><td className="k">{m.b}</td><td className="k">{m.s}</td><td><button className="btn sm gh" onClick={()=>del("mappings",i)}>✕</button></td></tr>))}
          {!L.mappings.length&&<tr><td colSpan="3" className="empty">None yet.</td></tr>}</tbody></table></div></div>
      <div className="card"><h3>Rejected suggestions <span className="sub">{L.rejected.length}</span></h3><div className="tblwrap" style={{maxHeight:220,overflowY:"auto"}}><table>
        <thead><tr><th>BW5</th><th>Spring</th><th style={{width:60}}></th></tr></thead>
        <tbody>{L.rejected.map((r,i)=>(<tr key={i}><td className="k">{r.b}</td><td className="k">{r.s}</td><td><button className="btn sm gh" onClick={()=>del("rejected",i)}>undo</button></td></tr>))}
          {!L.rejected.length&&<tr><td colSpan="3" className="empty">None.</td></tr>}</tbody></table></div></div>
      <div className="card"><h3>Skipped keys <span className="sub">{ignored.length}</span></h3><div className="tblwrap" style={{maxHeight:220,overflowY:"auto"}}><table>
        <thead><tr><th style={{width:70}}>Side</th><th>Key</th><th style={{width:70}}></th></tr></thead>
        <tbody>{ignored.map((o,i)=>(<tr key={i}><td><span className={"badge "+(o.side==="b"?"b-info":"b-pur")}>{o.side==="b"?"BW5":"Spring"}</span></td><td className="k">{o.key}</td>
          <td><button className="btn sm gh" onClick={()=>unignore(o.side,o.key)}>restore</button></td></tr>))}
          {!ignored.length&&<tr><td colSpan="3" className="empty">Nothing skipped.</td></tr>}</tbody></table></div></div>
    </div>
    <div className="card" style={{marginTop:14}}><div className="savebar" style={{borderTop:"none"}}>
      <span className="hint">Saved by VS Code on this computer and used for every environment. Export it to share with the team.</span>
      <div className="spacer"></div>
      <button className="btn" onClick={()=>download("cmc-dictionary.json",JSON.stringify(L,null,2),"application/json")}>⬇ Export</button>
      <button className="btn" onClick={()=>host.call("openJson").then(r=>{ if(r&&r.text) importAll(r.text); },e=>say(e.message))}>⬆ Import</button>
    </div></div>
  </div>);
}

/* =============================== CHANGES =============================== */
function ChangesTab({changes,setChanges,parsedAll,envList,fileOf,applied,propose,writeOnly,proposal,busy,say,hs,setTab}){
  const [title,setTitle]=useState(""), [desc,setDesc]=useState("");
  const base=(hs&&hs.baseBranch)||"master";
  const envs=Array.from(new Set(changes.map(c=>c.env)));
  const autoTitle=()=>{ const adds=changes.filter(c=>c.op==="add"), sets=changes.filter(c=>c.op==="set");
    const keys=Array.from(new Set(changes.map(c=>c.key)));
    return "Config: "+(adds.length&&!sets.length?"add ":sets.length&&!adds.length?"update ":"change ")+keys.slice(0,2).join(", ")+(keys.length>2?" +"+(keys.length-2)+" more":"")+" ("+envs.join(", ")+")"; };
  const autoDesc=()=>["Prepared with Config Match & Catch.","","| Environment | File | Action | Key | Old | New |","|---|---|---|---|---|---|"]
    .concat(changes.map(c=>"| "+c.env+" | "+(c.side==="bw5"?"BW5":"Spring")+" | "+c.op+" | `"+c.key+"` | `"+(c.from||"—")+"` | `"+c.value+"` |")).join("\n");
  const files=[]; envList.forEach(e=>["bw5","spring"].forEach(side=>{ const f=fileOf(e.env,side), P=parsedAll[e.env];
    if(f&&P&&P.text[side]!=null&&P.text[side]!==f.text) files.push({env:e.env,side,f,next:P.text[side]}); }));
  const canGit=files.some(x=>x.f.git);
  const open=url=>host.call("openUrl",{url}).catch(()=>{});
  return (<div>
    {proposal&&(<div className={"banner "+(proposal.results.every(r=>!r.error)?"good":"bad")} style={{display:"block"}}>
      <b>Branch: <code className="inline">{proposal.branch}</code></b>
      {proposal.results.map((r,i)=>(<div key={i} style={{marginTop:6}}>
        <b>{r.repo}</b> ({r.files.map(f=>f.env+" "+(f.side==="bw5"?"BW5":"Spring")).join(", ")}) —{" "}
        {r.error?<span>failed: {r.error}</span>:<>committed <code className="inline">{r.commit}</code>{" · "}
          {r.pushed?<>pushed{r.mrUrl&&<>{" · "}<a href="#" onClick={e=>{e.preventDefault();open(r.mrUrl);}}>open the merge request page ↗</a></>}</>:<span>{r.pushError}</span>}</>}
      </div>))}
      {proposal.results.some(r=>r.backOn)&&<div className="hint" style={{marginTop:8}}>Your repositories are back on <b>{base}</b>, so the app shows {base} again until the merge request is merged.</div>}
    </div>)}

    <div className="card" style={{marginBottom:14}}>
      <h3>Edits waiting to be sent <span className="sub">{changes.length} in {envs.length} environment(s) · kept even if you close VS Code</span>
        <span className="spacer"></span>{!!changes.length&&<button className="btn sm gh" onClick={async()=>{ if(await ask("Discard all "+changes.length+" unsent edit(s)?","Discard")) setChanges([]); }}>discard all</button>}</h3>
      <div className="tblwrap"><table><thead><tr><th style={{width:110}}>Environment</th><th style={{width:80}}>File</th><th style={{width:70}}>Action</th><th>Key</th><th>Old</th><th>New</th><th style={{width:60}}></th></tr></thead>
        <tbody>{changes.map(c=>(<tr key={c.id}><td>{c.env}</td><td><span className={"badge "+(c.side==="bw5"?"b-info":"b-pur")}>{c.side==="bw5"?"BW5":"Spring"}</span></td>
          <td><span className={"badge "+(c.op==="add"?"b-ok":c.op==="remove"?"b-bad":"b-warn")}>{c.op}</span></td><td className="k">{c.key}</td>
          <td className="v">{c.from||<span className="muted">—</span>}</td><td className="v" style={{color:"#8fe0a0"}}>{c.value===""?<span className="missing">(empty)</span>:c.value}</td>
          <td><button className="btn sm gh" onClick={()=>setChanges(cs=>cs.filter(x=>x.id!==c.id))}>undo</button></td></tr>))}
          {!changes.length&&<tr><td colSpan="7" className="empty"><div className="big">✎</div>No edits waiting.<br/>
            <span className="hint">Search a variable on Home, edit a value, or press ＋ Add variable.</span></td></tr>}</tbody></table></div>
    </div>

    {files.length>0&&<div className="grid2">{files.map(x=>{ const d=E.lineDiff(x.f.text,x.next);
      return (<div className="card" key={x.env+x.side}>
        <h3><span className={"badge "+(x.side==="bw5"?"b-info":"b-pur")}>{x.side==="bw5"?"BW5":"SPRING"}</span>{x.env} · {x.f.rel}</h3>
        <div className="pad">{d.length?<pre className="out">{d.slice(0,200).map((y,i)=><div key={i} className={"diffline "+(y.t==="+"?"add":"del")}>{y.t} {y.l}</div>)}
          {d.length>200&&<div className="muted">…{d.length-200} more lines</div>}</pre>:<div className="hint">No line changes.</div>}</div>
      </div>); })}</div>}

    {!!changes.length&&<div className="card" style={{marginTop:14}}>
      <h3><span className="stepnum">✓</span> Send to GitLab <span className="sub">new branch + commit + push — {base} is never touched</span></h3>
      <div className="pad" style={{maxWidth:820}}>
        {!canGit?<div className="hint">These files aren't inside a git repository VS Code knows about. Open the repository folders in VS Code, or use “Save to disk only”.</div>:<>
          <label className="fld"><span>Merge request title</span><input className="inp" placeholder={autoTitle()} value={title} onChange={e=>setTitle(e.target.value)}/></label>
          <label className="fld"><span>Description</span><textarea className="inp" rows="4" placeholder="Leave empty to list every change automatically" value={desc} onChange={e=>setDesc(e.target.value)}/></label></>}
        <div style={{display:"flex",gap:9,alignItems:"center",flexWrap:"wrap"}}>
          {canGit&&<button className="btn pri" disabled={!!busy} onClick={()=>propose(title||autoTitle(),desc||autoDesc())}>⎇ Check &amp; send…</button>}
          <button className="btn gh" disabled={!!busy} onClick={writeOnly}>Save to disk only</button>
        </div>
        <div className="hint" style={{marginTop:8}}>“Check &amp; send” runs every check again, fetches from GitLab, and shows exactly what will happen before anything is written.
          Each repository gets a branch <code className="inline">config-sync/…</code>, one commit with all its files, and a push; then GitLab's “new merge request” page opens.</div>
      </div>
    </div>}

    {!!applied.length&&(<div className="card" style={{marginTop:14}}><h3>Done this session <span className="sub">{applied.length}</span></h3>
      <div className="tblwrap" style={{maxHeight:260,overflowY:"auto"}}><table><thead><tr><th style={{width:80}}>Time</th><th style={{width:100}}>Environment</th><th style={{width:80}}>File</th><th style={{width:70}}>Action</th><th>Key</th><th>Value</th><th>Branch</th></tr></thead>
        <tbody>{applied.slice().reverse().map((c,i)=>(<tr key={i}><td className="muted" style={{fontSize:11.5}}>{c.when}</td><td>{c.env}</td>
          <td><span className={"badge "+(c.side==="bw5"?"b-info":"b-pur")}>{c.side==="bw5"?"BW5":"Spring"}</span></td><td><span className="badge b-gray">{c.op}</span></td>
          <td className="k">{c.key}</td><td className="v">{c.value}</td><td className="k">{c.branch||"(saved to disk)"}</td></tr>))}</tbody></table></div></div>)}
  </div>);
}
