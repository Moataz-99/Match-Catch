/* ================================ APP ================================ */
const SIDES=["bw5","spring"];
const SNAME={bw5:"BW5",spring:"Spring"};
function App(){
  /* ---- what VS Code gave us ---- */
  const [hs,setHs]=useState(null);                 // {environments, baseBranch, learned, pending, version}
  const [data,setData]=useState(null);             // loadAll result {envs:[{env,springRoot,bw5:{rel,abs,text,git,error,code},spring:{…}}], current}
  const [envName,setEnvName]=useState("");
  const [roots,setRoots]=useState({});             // env -> chosen YAML block ("__AUTO__" | "__ALL__" | path)
  const [busy,setBusy]=useState("");
  const [outdated,setOutdated]=useState({});       // abs -> true when changed on disk while edits are pending
  const [learned,setLearnedState]=useState(EMPTY_LEARNED);
  const [opts,setOptsState]=useState(()=>store.get("cmc.opts",{autoThreshold:.70,reviewThreshold:.40,margin:.07,caseSensitive:false,skipBlocks:true}));
  const setOpts=f=>setOptsState(o=>{ const n=typeof f==="function"?f(o):f; store.set("cmc.opts",n); return n; });
  /* ---- edits: [{id, env, side, op:"set"|"add"|"remove", key, value, from}] ---- */
  const [changes,setChanges]=useState([]);
  const [applied,setApplied]=useState([]);
  const [proposal,setProposal]=useState(null);
  const [tab,setTab]=useState("home");
  const [q,setQ]=useState("");
  const [addSpec,setAddSpec]=useState(null);       // open Add-variable dialog with these defaults
  const [focusVar,setFocusVar]=useState(null);     // {b,s} to open on the Variables tab
  const [statusFilter,setStatusFilter]=useState({ok:true,mismatch:true,case:true,whitespace:true,empty:true,encrypted:true,partial:true});
  const [sevFilter,setSevFilter]=useState({high:true,med:true,low:true});
  const [pick,setPick]=useState(null), [pickS,setPickS]=useState(null);
  const [onlySug,setOnlySug]=useState(true);
  const [limit,setLimit]=useState(250);
  const [toast,setToast]=useState("");
  const cid=useRef(1);
  const say=useCallback(m=>{ setToast(m); setTimeout(()=>setToast(t=>t===m?"":t),4000); },[]);
  const copy=(t,m)=>host.call("copy",{text:t}).then(()=>say(m||"Copied"),()=>say("Copy failed"));
  const run=async(label,fn)=>{ setBusy(label); try{ return await fn(); }catch(e){ showDialog({title:"That didn't work",body:e.message,cancel:"OK"}); return null; } finally{ setBusy(""); } };

  /* ---- files, parsed, with pending edits applied ---- */
  const envList=(data&&data.envs)||[];
  const fileOf=(env,side)=>{ const e=envList.find(x=>x.env===env); const f=e&&e[side]; return f&&typeof f.text==="string"?f:null; };
  const pendingFor=(env,side)=>changes.filter(c=>c.env===env&&c.side===side);
  const rootFor=env=>roots[env]||"__AUTO__";
  const autoRootOf=probe=>{ const b=probe.blocks||[];
    const pref=b.find(x=>/commonresourcesdata|configmapdata|(^|\.)data$|env|properties/i.test(x.path));
    return (pref||b[0]||{path:"__ALL__"}).path; };
  const parsedAll=useMemo(()=>{
    const out={};
    envList.forEach(e=>{
      const o={name:e.env,bw5:null,spring:null,orig:{},text:{},probe:null,autoRoot:"__ALL__",root:""};
      const fb=fileOf(e.env,"bw5"), fs=fileOf(e.env,"spring");
      if(fb){ o.orig.bw5=fb.text; const pc=pendingFor(e.env,"bw5"); o.text.bw5=pc.length?E.applyPropsChanges(fb.text,pc):fb.text; o.bw5=E.parseProperties(o.text.bw5); }
      if(fs){
        o.probe=E.parseYaml(fs.text,"__ALL__",jsyaml.load); o.autoRoot=autoRootOf(o.probe);
        const r=rootFor(e.env); o.root=r==="__AUTO__"?o.autoRoot:r;
        o.orig.spring=fs.text; const pc=pendingFor(e.env,"spring"); o.text.spring=pc.length?E.applyYamlChanges(fs.text,pc,o.root):fs.text;
        o.spring=E.parseYaml(o.text.spring,o.root,jsyaml.load);
      }
      out[e.env]=o;
    });
    return out;
  },[data,changes,roots]);
  const checkEnvs=useMemo(()=>envList.map(e=>({name:e.env,bw5:parsedAll[e.env].bw5,spring:parsedAll[e.env].spring})),[parsedAll]);
  /* the comparison is the slow part (~0.2 s on a 1,250-key file): cache it per environment, so an edit only redoes its own */
  const anCache=useRef({});
  const analyses=useMemo(()=>{
    const out={};
    Object.keys(parsedAll).forEach(n=>{ const P=parsedAll[n];
      if(!P.bw5||!P.spring||!P.bw5.entries.length||!P.spring.entries.length){ out[n]=null; return; }
      const sig=[P.text.bw5,P.text.spring,P.root];
      let hit=anCache.current[n];
      if(!hit||hit.opts!==opts||hit.learned!==learned||hit.sig.some((x,i)=>x!==sig[i])){
        const a0=E.analyze(P.bw5.entries,P.spring.entries,Object.assign({},opts,{learned}));
        hit=anCache.current[n]={sig,opts,learned,a:a0,w:E.buildWarnings(P.bw5,P.spring,a0.pairs,{learned})};
      }
      const a=hit.a, w=hit.w;
      const c=a.stats.byStatus||{};
      const bad=a.composites.filter(x=>x.status==="mismatch").length;
      const missing={bw5:C.missingVsOtherEnvs(checkEnvs,n,"bw5"),spring:C.missingVsOtherEnvs(checkEnvs,n,"spring")};
      out[n]={a,w,badGroups:bad,problems:(c.mismatch||0)+(c.case||0)+(c.whitespace||0)+(c.empty||0)+bad,
        dups:w.filter(x=>x.type==="Duplicate key").length,missing};
    });
    return out;
  },[parsedAll,opts,learned,checkEnvs]);
  const cur=parsedAll[envName]||{bw5:null,spring:null,probe:null,orig:{},text:{}};
  const EMPTYP={entries:[],dups:[],commented:[]};
  const bwParsed=cur.bw5||EMPTYP, spParsed=cur.spring||Object.assign({root:""},EMPTYP);
  const A=analyses[envName];
  const analysis=A?A.a:{pairs:[],composites:[],review:[],onlyB:[],onlyS:[],stats:{byStatus:{},byHow:{}}};
  const warnings=A?A.w:[];
  const counts=analysis.stats.byStatus||{};
  const loaded=!!A;
  const curChanges=changes.filter(c=>c.env===envName);
  window.__cmcEnv=envName;
  window.__cmcRoots=Object.fromEntries(Object.keys(parsedAll).map(n=>[n,(parsedAll[n].spring&&parsedAll[n].spring.root)||""]));

  /* ---- learned dictionary (saved by VS Code, shared by every environment) ---- */
  const saveLearned=next=>{ setLearnedState(next); host.call("saveLearned",{learned:next}).catch(e=>say("Could not save the rules: "+e.message)); };
  const confirmPair=(b,s)=>{ const before=(learned.rules||[]).length; const next=E.learnFromPair(learned,b,s); saveLearned(next);
    say("Confirmed "+b+" ⇄ "+s+(next.rules.length>before?" — and learned a new rule":"")); };
  const rejectPair=(b,s)=>{ saveLearned(Object.assign({},learned,{rejected:(learned.rejected||[]).concat([{b,s}])})); say("This pair won't be suggested again"); };
  const unmap=b=>saveLearned(Object.assign({},learned,{mappings:(learned.mappings||[]).filter(m=>m.b!==b)}));
  const ignore=(side,key)=>{ const ig={b:Object.assign({},(learned.ignored||{}).b),s:Object.assign({},(learned.ignored||{}).s)}; ig[side][key]=true; saveLearned(Object.assign({},learned,{ignored:ig})); };
  const unignore=(side,key)=>{ const ig={b:Object.assign({},(learned.ignored||{}).b),s:Object.assign({},(learned.ignored||{}).s)}; delete ig[side][key]; saveLearned(Object.assign({},learned,{ignored:ig})); };

  /* ---- edits (always validated first) ---- */
  const origValue=(env,side,key)=>{ const f=fileOf(env,side); if(!f) return null;
    const P=side==="bw5"?E.parseProperties(f.text):E.parseYaml(f.text,(parsedAll[env]||{}).root||"__ALL__",jsyaml.load);
    const e=P.entries.find(x=>x.key===key); return e?e.value:null; };
  const putChanges=list=>setChanges(cs=>{
    let out=cs.slice();
    list.forEach(n=>{
      const old=out.find(c=>c.env===n.env&&c.side===n.side&&c.key===n.key);
      out=out.filter(c=>c!==old);
      const from=old?old.from:(n.from!=null?String(n.from):"");
      const op=old&&old.op==="add"&&n.op==="set"?"add":n.op;
      if(op==="set"&&from===String(n.value)) return;      // back to the original value: nothing to do
      out.push({id:cid.current++,env:n.env,side:n.side,op,key:n.key,value:String(n.value==null?"":n.value),from});
    });
    return out;
  });
  /** the twin of `key` on the other side, in this environment (from the pairing) */
  const twinOf=(env,side,key)=>{ const an=analyses[env]; if(!an) return null;
    const p=an.a.pairs.find(x=>side==="bw5"?x.b.key===key:x.s.key===key); if(!p) return null;
    return side==="bw5"?{key:p.s.key,value:p.s.value}:{key:p.b.key,value:p.b.value}; };
  /** edit one value; checks first and pops up if it looks wrong */
  const editValue=async(env,side,key,value,from)=>{
    const issues=C.checkEdit({env,side,key,value},checkEnvs,twinOf(env,side,key));
    if(!(await confirmIssues("Save "+key+" in "+env+"?",issues,"Save anyway"))) return false;
    const o=origValue(env,side,key);
    putChanges([{env,side,op:"set",key,value,from:o!=null?o:from}]);
    return true;
  };
  /* tabs written for the current environment call queue(side,op,key,value,from) */
  const queue=(side,op,key,value,from)=>op==="set"?editValue(envName,side,key,value,from):putChanges([{env:envName,side,op,key,value,from}]);
  const queueMany=(side,op,items)=>putChanges(items.map(i=>({env:envName,side,op,key:i.key,value:i.value,from:""})));
  const addVariable=(spec)=>{
    const list=[];
    envList.forEach(e=>SIDES.forEach(side=>{
      const create=side==="bw5"?spec.createB:spec.createS; if(!create||!fileOf(e.env,side)) return;
      const key=side==="bw5"?spec.bKey:spec.sKey;
      list.push({env:e.env,side,op:"add",key,value:((spec.values||{})[e.env]||{})[side]||"",from:""});
    }));
    putChanges(list);
    if(spec.bKey&&spec.sKey) saveLearned(E.learnFromPair(learned,spec.bKey,spec.sKey));
    setAddSpec(null);
    say("Added "+(spec.createB?spec.bKey:spec.sKey)+" to "+list.length+" file(s) — review and send it on the Changes tab");
    return list.length;
  };
  /** open the Add dialog to create the missing twin(s) of an existing key */
  const addTwin=(side,key)=>{
    const other=side==="bw5"?"spring":"bw5";
    const P=parsedAll[envName]; const keys=(P&&P[other]?P[other].entries:[]).map(e=>e.key);
    const t=C.suggestTwin(key,side,learned,keys);
    const values={}; envList.forEach(e=>{ const p=parsedAll[e.env]&&parsedAll[e.env][side]; const x=p&&p.entries.find(y=>y.key===key); values[e.env]={[side]:x?x.value:"",[other]:x?x.value:""}; });
    setAddSpec({bKey:side==="bw5"?key:t.name,sKey:side==="spring"?key:t.name,createB:side!=="bw5",createS:side!=="spring",values,locked:side,how:t.how});
  };

  /* ---- persistence of unsent edits (survive closing VS Code) ---- */
  const restored=useRef(false);
  useEffect(()=>{ if(!restored.current) return; const t=setTimeout(()=>host.call("savePending",{pending:changes}).catch(()=>{}),300); return ()=>clearTimeout(t); },[changes]);

  /* ---- talking to VS Code ---- */
  const takeData=(r,opt)=>{
    setData(r); setOutdated({});
    const want=(opt&&opt.env)||envRef.current||r.current;
    setEnvName(r.envs.some(e=>e.env===want)?want:r.current);
    setRoots(Object.fromEntries(r.envs.map(e=>[e.env,e.springRoot||"__AUTO__"])));
  };
  const reload=async(opt)=>{ const r=await run(opt&&opt.label||"Reading the files…",()=>host.call("loadAll",{current:(opt&&opt.env)||envName})); if(r) takeData(r,opt); return r; };
  const switchEnv=name=>{ setEnvName(name); host.call("setCurrent",{env:name}).catch(()=>{}); };
  const pullLatest=async()=>{
    const r=await run("Pulling the latest "+((hs&&hs.baseBranch)||"master")+"…",()=>host.call("pull",{current:envName}));
    if(r){ takeData(r); say("Up to date with "+r.baseBranch+(changes.length?" — your "+changes.length+" unsent edit(s) are kept":"")); }
  };
  const chooseRepo=async(env,side)=>{ const r=await run("",()=>host.call("chooseRepo",{env,side})); if(r&&!r.cancelled) takeData(r,{env}); };
  const chooseFile=async(env,side)=>{ const r=await run("",()=>host.call("chooseFile",{env,side})); if(r&&!r.cancelled){ takeData(r,{env}); say("Saved in your settings — it will be read from there from now on"); } };
  const addEnvironment=async()=>{ const r=await run("",()=>host.call("addEnvironment")); if(r&&!r.cancelled){ takeData(r,{env:r.current}); setTab("files"); } };
  const changeRoot=(env,v)=>{ setRoots(x=>Object.assign({},x,{[env]:v})); host.call("setRoot",{env,root:v==="__AUTO__"?"":v}).catch(()=>{}); };

  /* a file changed on disk (pull, branch switch, edit in the editor) */
  const dataRef=useRef(data); dataRef.current=data;
  const changesRef=useRef(changes); changesRef.current=changes;
  const envRef=useRef(envName); envRef.current=envName;
  const onFileChanged=async m=>{
    if(changesRef.current.some(c=>c.env===m.env&&c.side===m.side)){ setOutdated(o=>Object.assign({},o,{[m.abs]:true})); return; }
    const before=dataRef.current; const oldF=before&&(before.envs.find(e=>e.env===m.env)||{})[m.side];
    const r=await host.call("loadAll",{current:envRef.current}).catch(()=>null); if(!r) return;
    takeData(r,{env:envRef.current});
    const newF=(r.envs.find(e=>e.env===m.env)||{})[m.side];
    if(!oldF||!newF||typeof oldF.text!=="string"||typeof newF.text!=="string") return;
    const P=t=>m.side==="bw5"?E.parseProperties(t):E.parseYaml(t,"__ALL__",jsyaml.load);
    const a=P(oldF.text), b=P(newF.text);
    const had=new Set(a.entries.map(e=>e.key)), dupBefore=new Set((a.dups||[]).map(d=>d.key));
    const newDups=(b.dups||[]).filter(d=>!dupBefore.has(d.key));
    if(newDups.length){ await showDialog({title:"Duplicate key in "+m.env+" "+SNAME[m.side],
      body:"The file was just saved with a key defined twice. Only the last one is used, which is almost always a mistake.",
      issues:newDups.map(d=>({level:"error",msg:d.key+(d.first?" — lines "+d.first+" and "+d.line:"")})),cancel:"OK"}); return; }
    const added=b.entries.filter(e=>!had.has(e.key)).map(e=>e.key);
    if(added.length&&added.length<=5){
      const yes=await showDialog({title:"New key in "+m.env+" "+SNAME[m.side],
        body:<span>You added <b>{added.join(", ")}</b> in the {SNAME[m.side]} file. Create {added.length>1?"them":"it"} on the {m.side==="bw5"?"Spring":"BW5"} side and in the other environments too?</span>,
        ok:"Create the twin…",cancel:"Not now"});
      if(yes){ setEnvName(m.env); envRef.current=m.env; setTimeout(()=>addTwinRef.current(m.side,added[0]),50); }
    }
  };
  const addTwinRef=useRef(addTwin); addTwinRef.current=addTwin;
  const onFileChangedRef=useRef(onFileChanged); onFileChangedRef.current=onFileChanged;
  const reloadRef=useRef(reload); reloadRef.current=reload;
  useEffect(()=>{
    const off=host.on(m=>{
      if(m.type==="fileChanged") onFileChangedRef.current(m);
      else if(m.type==="config"){ setHs(h=>Object.assign({},h,m.state)); reloadRef.current({env:envRef.current}); }
      else if(m.type==="switchEnv"){ switchEnv(m.env); setTab("home"); }
      else if(m.type==="reload") reloadRef.current();
      else if(m.type==="command"&&m.cmd==="addVariable") setAddSpec({});
    });
    (async()=>{
      try{
        const st=await host.call("init"); setHs(st);
        if(st.learned) setLearnedState(Object.assign({},EMPTY_LEARNED,st.learned));
        if(st.pending&&st.pending.length){ setChanges(st.pending.map(c=>Object.assign({},c,{id:cid.current++}))); say("Restored "+st.pending.length+" unsent edit(s) from last time"); }
        restored.current=true;
        const r=await host.call("loadAll",{current:st.lastEnv});
        takeData(r,{env:r.current});
        const cmd=await host.call("takeStartCmd").catch(()=>"");
        if(cmd==="addVariable") setAddSpec({});
      }catch(e){ restored.current=true; showDialog({title:"Couldn't start",body:e.message,cancel:"OK"}); }
    })();
    return off;
  },[]);

  /* the Problems panel follows the current environment */
  useEffect(()=>{
    if(!envName) return;
    if(!loaded){ host.call("problems",{env:envName,items:{bw5:[],spring:[]}}).catch(()=>{}); return; }
    const t=setTimeout(()=>{
      const items={bw5:[],spring:[]};
      analysis.pairs.filter(p=>p.cmp.status!=="ok"&&p.cmp.status!=="encrypted").forEach(p=>{
        const sev=p.cmp.status==="mismatch"?"high":"med";
        items.bw5.push({key:p.b.key,sev,msg:p.cmp.msg+" — Spring "+p.s.key+" = "+p.s.value});
        items.spring.push({key:p.s.key,sev,msg:p.cmp.msg+" — BW5 "+p.b.key+" = "+p.b.value});
      });
      analysis.composites.filter(c=>c.status==="mismatch").forEach(c=>{
        items.spring.push({key:c.s.key,sev:"high",msg:c.msg});
        c.parts.filter(pt=>pt.cmp.status==="mismatch").forEach(pt=>items.bw5.push({key:pt.b.key,sev:"high",msg:pt.role+" differs from "+c.s.key+": "+pt.cmp.msg}));
      });
      warnings.filter(w=>w.sev!=="low"&&(w.side==="bw5"||w.side==="spring")).forEach(w=>items[w.side].push({key:w.key,sev:w.sev,msg:w.type+": "+w.msg}));
      host.call("problems",{env:envName,items,root:spParsed.root||""}).catch(()=>{});
    },400);
    return ()=>clearTimeout(t);
  },[analysis,warnings,loaded,envName]);

  /* ---- sending ---- */
  const filesToSend=()=>{ const out=[];
    envList.forEach(e=>SIDES.forEach(side=>{ const P=parsedAll[e.env], f=fileOf(e.env,side);
      if(f&&P.text[side]!=null&&P.text[side]!==f.text) out.push({abs:f.abs,content:P.text[side],env:e.env,side,before:f.text,root:P.root}); }));
    return out; };
  const label=()=>{ const envs=Array.from(new Set(changes.map(c=>c.env))); return envs.length===1?envs[0]:"multi-env"; };
  const finalChecks=files=>{ const out=[];
    files.forEach(f=>C.checkPatched(f.side,f.before,f.content,f.root,jsyaml.load,f.env+" · "+SNAME[f.side]+" ("+f.abs.split(/[\\/]/).pop()+")").forEach(i=>out.push(i)));
    changes.forEach(c=>{ if(c.op==="remove") return;
      C.checkEdit({env:c.env,side:c.side,key:c.key,value:c.value},checkEnvs,null).filter(i=>i.level==="error").forEach(i=>out.push(i)); });
    return out; };
  const propose=async(title,description)=>{
    const files=filesToSend();
    if(!files.length){ say("Nothing to send"); return; }
    const issues=finalChecks(files);
    const pre=await run("Checking the repositories (git fetch)…",()=>host.call("preflight",{files:files.map(f=>({abs:f.abs,content:f.content}))}));
    if(!pre) return;
    pre.repos.forEach(r=>{
      if(r.fetchError) issues.push({level:"warn",msg:r.repo+": couldn't reach GitLab to check for newer commits ("+r.fetchError.split("\n")[0]+"). Check the VPN — the push will need it too."});
      if(r.behind>0) issues.push({level:"warn",msg:r.repo+" is "+r.behind+" commit(s) behind GitLab. Press “Pull latest” first so your branch starts from the newest "+pre.base+"."});
      if(r.branch!==pre.base) issues.push({level:"error",msg:r.repo+" is on branch “"+r.branch+"”, not "+pre.base+". Press “Pull latest” to switch back."});
      if(r.staged) issues.push({level:"error",msg:r.repo+" has "+r.staged+" staged file(s) from other work. Commit or unstage them first."});
    });
    const blocked=issues.some(i=>i.level==="error");
    const ok=await showDialog({title:blocked?"Can't send yet":"Send "+changes.length+" change(s)?",wide:true,
      content:(<div>
        <table className="grid-env"><thead><tr><th>Repository</th><th>Files</th><th>What happens</th></tr></thead><tbody>
          {pre.repos.map(r=>(<tr key={r.repo}><td className="mono">{r.repo}</td><td className="mono">{r.files.map(f=><div key={f.rel}>{f.rel} <span className="muted">({f.env})</span></div>)}</td>
            <td>new branch <code className="inline">config-sync/{(label()||"").toLowerCase()}-…</code> from {pre.base}, one commit, push</td></tr>))}</tbody></table>
        {!issues.length&&<div className="issue lv-info" style={{marginTop:10}}><span className="ic">✓</span><span>All checks passed.</span></div>}
      </div>),
      issues, ok:blocked?null:(issues.length?"Send anyway":"Create branch, commit & push"), danger:!!issues.length, cancel:blocked?"OK, go back":"Cancel"});
    if(!ok) return;
    const r=await run("Creating the branch, committing and pushing…",()=>host.call("propose",{files:files.map(f=>({abs:f.abs,content:f.content})),title,description,label:label()}));
    if(!r) return;
    setProposal(r);
    if(r.results.every(x=>!x.error)){
      setApplied(a=>a.concat(changes.map(c=>Object.assign({},c,{when:new Date().toLocaleTimeString(),branch:r.branch}))));
      setChanges([]);
      say(r.results.every(x=>x.pushed)?"Pushed "+r.branch+" — finish the merge request in GitLab":"Committed on "+r.branch+" — the push needs attention");
    } else say("Something failed — see the Changes tab");
    const d=await host.call("loadAll",{current:envName}).catch(()=>null); if(d) takeData(d);
  };
  const writeOnly=async()=>{
    const files=filesToSend();
    const issues=finalChecks(files);
    if(!(await confirmIssues("Save to disk",issues,"Save anyway"))) return;
    const r=await run("Writing the files…",()=>host.call("writeFiles",{files:files.map(f=>({abs:f.abs,content:f.content}))}));
    if(!r) return;
    setApplied(a=>a.concat(changes.map(c=>Object.assign({},c,{when:new Date().toLocaleTimeString(),branch:""}))));
    setChanges([]);
    say("Saved "+r.written.length+" file(s) to disk — not committed");
    const d=await host.call("loadAll",{current:envName}).catch(()=>null); if(d) takeData(d);
  };

  /* ---- filters for the detailed tabs ---- */
  const match=t=>!q||String(t).toLowerCase().indexOf(q.toLowerCase())>=0;
  const pairRows=useMemo(()=>analysis.pairs.filter(p=>statusFilter[p.cmp.status]&&(match(p.b.key)||match(p.s.key)||match(p.b.value)||match(p.s.value)))
    .sort((a,b)=>{ const r=s=>({mismatch:0,case:1,whitespace:1,empty:2,partial:3,encrypted:4,ok:5})[s]; return r(a.cmp.status)-r(b.cmp.status)||a.b.key.localeCompare(b.b.key); }),[analysis,statusFilter,q]);
  const rowsB=useMemo(()=>analysis.onlyB.filter(o=>(!onlySug||o.sug.length)&&(match(o.e.key)||match(o.e.value))),[analysis,q,onlySug]);
  const rowsS=useMemo(()=>analysis.onlyS.filter(o=>match(o.e.key)||match(o.e.value)),[analysis,q]);
  const warnRows=useMemo(()=>warnings.filter(w=>sevFilter[w.sev]&&(match(w.key)||match(w.msg)||match(w.type))),[warnings,sevFilter,q]);

  /* ---- report ---- */
  const report=()=>{
    const L=["# BW5 ↔ Spring configuration comparison",""];
    const f=fileOf(envName,"bw5")||{}, g=fileOf(envName,"spring")||{};
    L.push("- Environment: **"+(envName||"?")+"**");
    L.push("- BW5: `"+(f.rel||"?")+"` — "+bwParsed.entries.length+" properties");
    L.push("- Spring: `"+(g.rel||"?")+"` — "+spParsed.entries.length+" keys under `"+(spParsed.root||"(root)")+"`");
    L.push("- Generated: "+new Date().toISOString(),"","| Result | Count |","|---|---|");
    L.push("| Matched & equal | "+(counts.ok||0)+" |","| Value mismatch | "+(counts.mismatch||0)+" |",
      "| Connection groups with a mismatch | "+(A?A.badGroups:0)+" of "+analysis.composites.length+" |",
      "| Encrypted (not comparable) | "+(counts.encrypted||0)+" |","| Needs review | "+analysis.review.length+" |",
      "| Only in BW5 | "+analysis.onlyB.length+" |","| Only in Spring | "+analysis.onlyS.length+" |","");
    const bad=analysis.pairs.filter(p=>p.cmp.status!=="ok");
    if(bad.length){ L.push("## Differences","","| Status | BW5 key | BW5 value | Spring key | Spring value | Note |","|---|---|---|---|---|---|");
      bad.forEach(p=>L.push("| "+STATUS_META[p.cmp.status].label+" | `"+p.b.key+"` | `"+p.b.value+"` | `"+p.s.key+"` | `"+p.s.value+"` | "+p.cmp.msg+" |")); L.push(""); }
    if(analysis.composites.length){ L.push("## Connection groups",""); analysis.composites.forEach(c=>{ L.push("**"+c.s.key+"** = `"+c.s.value+"`");
      c.parts.forEach(p=>L.push("- "+(p.cmp.status==="ok"?"✅":"❌")+" "+p.role+": `"+p.b.key+"` = `"+p.b.value+"`")); L.push(""); }); }
    if(A&&(A.missing.bw5.length||A.missing.spring.length)){ L.push("## Missing here but present in another environment","");
      SIDES.forEach(s=>A.missing[s].forEach(m=>L.push("- "+SNAME[s]+" `"+m.key+"` (in "+m.from.map(x=>x.env).join(", ")+")"))); L.push(""); }
    const wb=warnings.filter(w=>w.sev!=="low");
    if(wb.length){ L.push("## Warnings","","| Severity | Side | Key | Type | Detail |","|---|---|---|---|---|");
      wb.forEach(w=>L.push("| "+w.sev+" | "+w.side+" | `"+w.key+"` | "+w.type+" | "+w.msg+" |")); }
    return L.join("\n");
  };

  const TABS=[{id:"home",label:"Home"},{id:"vars",label:"Variables",n:loaded?analysis.pairs.length+analysis.onlyB.length+analysis.onlyS.length:null},
    {id:"review",label:"Review",n:analysis.review.length},{id:"groups",label:"Connection groups",n:analysis.composites.length},
    {id:"warn",label:"Warnings",n:warnings.length},{id:"changes",label:"Changes",n:changes.length,hot:changes.length>0},
    {id:"files",label:"Files"},{id:"rules",label:"Rules",n:(learned.rules||[]).length},{sep:true},
    {id:"compare",label:"Comparison",n:analysis.pairs.length},{id:"onlyb",label:"Only in BW5",n:analysis.onlyB.length},{id:"onlys",label:"Only in Spring",n:analysis.onlyS.length}];
  const common={q,setQ,queue,ignore,copy,say,limit,setLimit};
  const ctxv={hs,envName,envList,parsedAll,analyses,checkEnvs,changes,learned,fileOf,editValue,putChanges,setAddSpec,addTwin,setTab,switchEnv,
    pullLatest,busy,q,setQ,say,setFocusVar,focusVar,origValue,twinOf,addEnvironment,chooseFile,chooseRepo,changeRoot,roots,reload};

  return (
  <div className="app">
    <div className="top">
      <div className="brand" style={{cursor:"pointer"}} onClick={()=>setTab("home")}><span className="dot"></span><div>Config Match &amp; Catch<small>TIBCO BW5 .properties ⇄ Spring Boot / Helm values</small></div></div>
      {envList.length>0&&<div className="envs">{envList.map(e=>{ const an=analyses[e.env]; const nEd=changes.filter(c=>c.env===e.env).length;
        return (<button key={e.env} className={"envbtn"+(e.env===envName?" on":"")} disabled={!!busy} title={an?an.problems+" problem(s)":"files not set up"}
          onClick={()=>switchEnv(e.env)}><span className="envdot" style={{background:!an?"var(--tx3)":an.problems||an.dups?"var(--bad)":"var(--ok)",marginRight:6}}></span>{e.env}{nEd?" ✎"+nEd:""}</button>); })}</div>}
      <div className="spacer"></div>
      {loaded && <>
        <span className="pill"><b>{bwParsed.entries.length}</b> BW5</span>
        <span className="pill"><b>{spParsed.entries.length}</b> Spring</span>
      </>}
      <button className="btn sm" disabled={!!busy||!envList.length} onClick={()=>setAddSpec({})}>＋ Add variable</button>
      {!!changes.length && <button className="btn sm pri" onClick={()=>setTab("changes")}>✎ {changes.length} to send</button>}
      {loaded&&<button className="btn sm gh" onClick={()=>download("config-comparison-"+(envName||"env").toLowerCase()+".md",report()).then(r=>r&&r.file&&say("Saved "+r.file),e=>say(e.message))}>⬇ Report</button>}
    </div>
    <div className="tabs">{TABS.map((t,i)=>t.sep?<span key={"s"+i} className="tabsep"></span>:(<button key={t.id} className={"tab"+(tab===t.id?" on":"")} onClick={()=>setTab(t.id)}>
      {t.label}{t.n!=null&&<span className={"cnt"+(t.hot?" hot":"")}>{t.n}</span>}</button>))}</div>

    <div className="main">
      {busy && <div className="banner info"><span className="spin"></span> {busy}</div>}
      {Object.keys(outdated).length>0&&(<div className="banner">⚠ A file you have unsent edits for changed on disk (a pull, a branch switch or an edit in the editor).
        <button className="btn sm pri" onClick={()=>reload({env:envName})}>Reload it</button><span className="hint">Your edits are kept and re-applied to the new content.</span></div>)}

      {tab==="home" && <HomeTab {...ctxv}/>}
      {tab==="vars" && <VariablesTab {...ctxv}/>}
      {tab==="files" && <FilesTab {...ctxv}/>}
      {!["home","vars","files","rules","changes"].includes(tab)&&!loaded&&(<div className="card"><div className="empty"><div className="big">📄</div>
        Both files of “{envName||"?"}” need to be set up first.<div style={{marginTop:12}}><button className="btn pri" onClick={()=>setTab("files")}>Go to Files</button></div></div></div>)}
      {loaded&&tab==="compare"&&<CompareTab {...common} {...{pairRows,counts,statusFilter,setStatusFilter,changes:curChanges,unmap}}/>}
      {loaded&&tab==="groups"&&<GroupsTab composites={analysis.composites} queue={queue}/>}
      {loaded&&tab==="review"&&<ReviewTab review={analysis.review} onConfirm={confirmPair} onReject={rejectPair} onIgnore={ignore} q={q} setQ={setQ}/>}
      {loaded&&tab==="onlyb"&&<OrphanTab {...common} side="b" rows={rowsB} all={analysis.onlyB} pick={pick} setPick={setPick} onlySug={onlySug} setOnlySug={setOnlySug}
        onConfirm={confirmPair} queueMany={queueMany} addTwin={addTwin}/>}
      {loaded&&tab==="onlys"&&<OrphanTab {...common} side="s" rows={rowsS} all={analysis.onlyS} pick={pickS} setPick={setPickS}
        onConfirm={confirmPair} queueMany={queueMany} addTwin={addTwin}/>}
      {loaded&&tab==="warn"&&<WarnTab {...{warnings,warnRows,sevFilter,setSevFilter,q,setQ,limit}}/>}
      {tab==="rules"&&<RulesTab {...{learned,saveLearned,bwParsed,spParsed,unignore,say,copy,opts,setOpts,analysis,setAddSpec}}/>}
      {tab==="changes"&&<ChangesTab {...{changes,setChanges,parsedAll,envList,fileOf,applied,propose,writeOnly,proposal,busy,say,hs,setTab}}/>}
    </div>
    {addSpec&&<AddVariableDialog spec={addSpec} {...ctxv} onAdd={addVariable} onClose={()=>setAddSpec(null)}/>}
    <DialogHost/>
    {toast&&<div className="toast">{toast}</div>}
  </div>);
}
