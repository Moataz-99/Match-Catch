/* =============================================================================
 * Config Match & Catch — matching engine
 * Plain JavaScript, no dependencies. Runs in the browser (window.CMEngine) or Node.
 *
 *   0 parse     .properties / YAML -> entries (+ ${ref} resolution)
 *   1 enrich    tokens, semantic leaf, namespace, value type, fingerprints
 *   2 anchors   confirmed pairs, pattern rules, identical / normalized keys
 *   3 clusters  align key groups (database.ods.* <-> ods_database_*)
 *   3b composites  BW5 host+port+sid  <->  one Spring JDBC URL
 *   4 evidence  shared values weighted by rarity (IDF)
 *   5 score     weighted features + hard conflict penalties
 *   6 assign    best-first with an ambiguity margin -> auto | review | none
 *   7 compare   JDBC / type-aware value comparison
 *   8 learn     confirmed pairs -> word equivalences + pattern rules
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CMEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* ---------------------------------------------------------------- parsing */
function resolveRefs(entries){
  const map=new Map(entries.map(e=>[e.key,e.value]));
  for(let pass=0;pass<3;pass++){
    let changed=false;
    entries.forEach(e=>{
      if(String(e.value).indexOf("${")<0) return;
      const next=String(e.value).replace(/\$\{([^}]+)\}/g,(all,k)=>map.has(k)?map.get(k):all);
      if(next!==e.value){ e.unresolved=e.unresolved||e.value; e.value=next; map.set(e.key,next); changed=true; }
    });
    if(!changed) break;
  }
  return entries;
}

function parseProperties(text){
  const entries=[], commented=[], seen=new Map(), dups=[];
  const lines=String(text||"").split(/\r?\n/);
  let buf=null, bufLine=0;
  for(let i=0;i<lines.length;i++){
    let line=lines[i];
    if(buf!==null) line=buf+line.replace(/^\s+/,"");
    const t=line.trim();
    if(buf===null && !t) continue;
    if(buf===null && (t[0]==="#"||t[0]==="!")){
      const inner=t.replace(/^[#!]+\s*/,"");
      const m=inner.match(/^([^\s=:]+)\s*[=:]\s*([\s\S]*)$/);
      if(m && /[.\-_]/.test(m[1]) && !/\s/.test(m[1])) commented.push({key:m[1],value:m[2].trim(),line:i+1});
      continue;
    }
    if(/\\$/.test(line) && !/\\\\$/.test(line)){ if(buf===null) bufLine=i+1; buf=line.replace(/\\$/,""); continue; }
    const startLine = buf!==null ? bufLine : i+1;
    buf=null;
    const m=line.match(/^\s*([^=:\s]+)\s*[=:]\s*([\s\S]*)$/);
    if(!m) continue;
    const e={key:m[1], value:m[2].trim(), raw:m[2], line:startLine, side:"bw5"};
    if(seen.has(m[1])) dups.push({key:m[1], first:seen.get(m[1]), line:startLine});
    else seen.set(m[1], startLine);
    entries.push(e);
  }
  resolveRefs(entries);
  return {entries, commented, dups, kind:"properties"};
}

const isObj = o => o && typeof o==="object" && !Array.isArray(o);
function flattenYaml(obj, prefix, out){
  out=out||[];
  if(!isObj(obj)) return out;
  for(const k of Object.keys(obj)){
    const v=obj[k], path=prefix?prefix+"."+k:k;
    if(isObj(v)) flattenYaml(v,path,out);
    else if(Array.isArray(v)) out.push({key:path,value:v.map(x=>isObj(x)?JSON.stringify(x):String(x)).join(","),kind:"list"});
    else if(v===null||v===undefined) out.push({key:path,value:"",kind:"scalar"});
    else { const s=String(v); out.push({key:path,value:s.trim(),raw:s,kind:s.indexOf("\n")>=0?"block":"scalar"}); }
  }
  return out;
}
function findBlocks(obj,prefix,out){
  out=out||[];
  if(!isObj(obj)) return out;
  let scalars=0;
  for(const k of Object.keys(obj)){
    const v=obj[k];
    if(isObj(v)) findBlocks(v,prefix?prefix+"."+k:k,out);
    else if(typeof v!=="object" && String(v).indexOf("\n")<0) scalars++;
  }
  if(prefix && scalars>=3) out.push({path:prefix,count:scalars});
  return out;
}
function parseYaml(text, rootPath, yamlLoader){
  let doc;
  try{ doc=yamlLoader(String(text||""),{json:true}); }
  catch(e){ return {entries:[],blocks:[],error:e.message||String(e),root:"",dups:[],kind:"yaml"}; }
  if(!isObj(doc)) return {entries:[],blocks:[],error:String(text||"").trim()?"YAML root is not a map":null,root:"",dups:[],kind:"yaml"};
  const blocks=findBlocks(doc,"",[]).sort((a,b)=>b.count-a.count);
  let scope=doc, used="";
  if(rootPath && rootPath!=="__ALL__"){
    let cur=doc, ok=true;
    for(const part of rootPath.split(".")){ if(isObj(cur)&&part in cur) cur=cur[part]; else {ok=false;break;} }
    if(ok&&isObj(cur)){ scope=cur; used=rootPath; }
  }
  const flat=flattenYaml(scope,"",[]).map(e=>Object.assign({},e,{side:"spring", fullKey: used?used+"."+e.key:e.key}));
  const seen=new Set(), dups=[];
  flat.forEach(e=>{ if(seen.has(e.key)) dups.push({key:e.key}); else seen.add(e.key); });
  resolveRefs(flat);
  return {entries:flat, blocks, error:null, root:used, dups, kind:"yaml"};
}

/* ------------------------------------------------------- key vocabulary */
const BASE_SYN = {
  username:"user", usr:"user", uname:"user", loginuser:"user", userid:"user", account:"user",
  pwd:"password", pass:"password", passwd:"password", psw:"password", loginpassword:"password",
  secret:"password", credential:"password",
  hostname:"host", ip:"host", addr:"host", address:"host", server:"host", servers:"host",
  urls:"url", uri:"url", endpoint:"url", urldb:"url", jdbcurl:"url", dburl:"url", contexturl:"url",
  servicename:"service", sname:"service", svc:"service", srvc:"service", servicenames:"service",
  databases:"database", db:"database", dbname:"database", datasource:"database", odbc:"database",
  maximum:"max", minimum:"min", maximumpoolsize:"maxpoolsize", maxpoolsize:"maxpoolsize",
  poolsize:"maxpoolsize", timeoutseconds:"timeout", timeoutms:"timeout", tmo:"timeout",
  timout:"timeout", connectiontimeout:"timeout", logintimeout:"timeout",
  queuename:"queue", topicname:"topic", connectionfactory:"factory",
  enable:"enabled", enabling:"enabled", disable:"enabled", active:"enabled",
  cfg:"config", conf:"config", configuration:"config",
  num:"count", number:"count", cnt:"count",
  login:"", tibco:"", common:"", commonresourcesdata:"", resources:"", resource:"",
  data:"", value:"", values:"", engines:"", engine:"", backend:"", vars:"", var:"",
  spring:"", boot:"", app:"", application:"", bw:"", bw5:"", bwce:"", the:"", of:"", a:""
};
const LEAVES = ["password","user","host","port","url","sid","service","schema","timeout","enabled",
  "queue","topic","factory","maxpoolsize","concurrency","version","path","token","keyfile",
  "network","daemon","name","id","type","count","size","database","prefix","suffix","subject"];
const COMPAT = [["url","host"],["url","port"],["url","sid"],["url","service"],["url","database"],
  ["sid","service"],["user","schema"],["host","network"],["host","daemon"],["port","service"],
  ["queue","topic"],["name","id"]];

function makeVocab(learned){
  const syn=Object.assign({},BASE_SYN);
  ((learned&&learned.synonyms)||[]).forEach(s=>{ if(s&&s.from) syn[String(s.from).toLowerCase()]=String(s.to||"").toLowerCase(); });
  return syn;
}
function tokenize(key, syn){
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g,"$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2")
    .split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map(s=>s.toLowerCase())
    .map(s=> (syn && s in syn) ? syn[s] : s)
    .filter(Boolean);
}
const uniq = a => Array.from(new Set(a));
const normKey = t => uniq(t).sort().join(".");
const looseKey = t => t.join("");
function leafOf(tokens){
  for(let i=tokens.length-1;i>=0;i--) if(LEAVES.indexOf(tokens[i])>=0) return tokens[i];
  return "";
}
function leafCompatible(a,b){ return COMPAT.some(p=>(p[0]===a&&p[1]===b)||(p[0]===b&&p[1]===a)); }
function bigrams(s){ const o=new Set(); for(let i=0;i<s.length-1;i++) o.add(s.slice(i,i+2)); return o; }
function dice(a,b){
  if(!a||!b) return 0; if(a===b) return 1;
  const A=bigrams(a),B=bigrams(b); if(!A.size||!B.size) return 0;
  let n=0; A.forEach(x=>{ if(B.has(x)) n++; });
  return (2*n)/(A.size+B.size);
}
function jaccard(a,b){
  const A=new Set(a),B=new Set(b);
  if(!A.size||!B.size) return 0;
  let n=0; A.forEach(x=>{ if(B.has(x)) n++; });
  return n/(A.size+B.size-n);
}

/* ------------------------------------------------------ value semantics */
const ENC_RE=/^#!/;
const SECRET_KEY_RE=/(password|passwd|pwd|secret|token|apikey|api_key|credential|privatekey)/i;
const IP_RE=/^(\d{1,3}\.){3}\d{1,3}$/;
const HOSTPORT_RE=/^([A-Za-z0-9_.\-]+):(\d{2,5})$/;
const QUEUE_RE=/^[A-Z][A-Z0-9]*([._][A-Z0-9]+){1,}$/;
function isJdbc(v){ return /^jdbc:/i.test(String(v||"").trim()); }
function parseJdbc(v){
  const s=String(v||"");
  const out={hosts:[],ports:[],service:null,sid:null,driver:null,raw:s};
  const dm=s.match(/^jdbc:([a-z0-9]+)/i); if(dm) out.driver=dm[1].toLowerCase();
  let m, re=/HOST\s*=\s*([^)\s]+)/gi;  while((m=re.exec(s))) out.hosts.push(m[1]);
  let re2=/PORT\s*=\s*([^)\s]+)/gi;    while((m=re2.exec(s))) out.ports.push(m[1]);
  const sn=s.match(/SERVICE_?NAME\s*=\s*([^)\s;,]+)/i); if(sn) out.service=sn[1];
  const sid=s.match(/[(;]\s*SID\s*=\s*([^)\s;,]+)/i);   if(sid) out.sid=sid[1];
  if(!out.hosts.length){
    const short=s.match(/(?:@\/{0,2}|:\/\/)([A-Za-z0-9_.${}\-]+):(\d+)(?:([:\/])([^?\s,;]+))?/);
    if(short){
      out.hosts.push(short[1]); out.ports.push(short[2]);
      if(short[3]===":") out.sid=out.sid||short[4];
      else if(short[3]==="/") out.service=out.service||short[4];
    }
  }
  const alt=s.match(/AlternateServers\s*=\s*\(([^)]*)\)/i);
  if(alt) alt[1].split(",").forEach(p=>{
    const m2=p.trim().match(/^([^:\s]+):(\d+)$/);
    if(m2){ out.hosts.push(m2[1]); out.ports.push(m2[2]); }
  });
  out.hosts=uniq(out.hosts); out.ports=uniq(out.ports);
  return out;
}
function classify(key, value){
  const v=String(value==null?"":value).trim();
  const o={type:"text", fps:[], jdbc:null};
  if(v===""){ o.type="empty"; return o; }
  if(ENC_RE.test(v)){ o.type="encrypted"; return o; }
  if(isJdbc(v)){
    o.type="jdbc"; o.jdbc=parseJdbc(v);
    o.fps.push("jdbc:"+o.jdbc.hosts.join(",")+"|"+o.jdbc.ports.join(",")+"|"+(o.jdbc.service||o.jdbc.sid||""));
    o.jdbc.hosts.forEach(h=>o.fps.push("host:"+h.toLowerCase()));
    o.jdbc.ports.forEach(p=>o.fps.push("port:"+p));
    if(o.jdbc.service) o.fps.push("svc:"+o.jdbc.service.toLowerCase());
    if(o.jdbc.sid) o.fps.push("svc:"+o.jdbc.sid.toLowerCase());
    return o;
  }
  if(/^(true|false|yes|no|on|off)$/i.test(v)){ o.type="bool"; o.fps.push("bool:"+(/^(true|yes|on)$/i.test(v)?"1":"0")); return o; }
  if(/^\d{2,5}$/.test(v) && Number(v)>=20 && Number(v)<=65535 && /port/i.test(key)){ o.type="port"; o.fps.push("port:"+v); return o; }
  if(/^-?\d+$/.test(v)){ o.type="number"; o.fps.push("num:"+Number(v)); return o; }
  if(IP_RE.test(v)){ o.type="host"; o.fps.push("host:"+v.toLowerCase()); return o; }
  const hp=v.match(HOSTPORT_RE);
  if(hp){ o.type="hostport"; o.fps.push("host:"+hp[1].toLowerCase()); o.fps.push("port:"+hp[2]); o.fps.push("hp:"+v.toLowerCase()); return o; }
  if(/^[a-z][a-z0-9+.\-]*:\/\//i.test(v)){
    o.type="url";
    const m=v.match(/^[a-z0-9+.\-]+:\/\/([^\/:,\s]+)(?::(\d+))?/i);
    if(m){ o.fps.push("host:"+m[1].toLowerCase()); if(m[2]) o.fps.push("port:"+m[2]); }
    o.fps.push("url:"+v.toLowerCase());
    return o;
  }
  if(QUEUE_RE.test(v)){ o.type="queue"; o.fps.push("q:"+v.toLowerCase()); return o; }
  if(/^\//.test(v) || /^[A-Za-z]:[\\/]/.test(v)){ o.type="path"; o.fps.push("path:"+v.toLowerCase()); return o; }
  if(SECRET_KEY_RE.test(key)){ o.type="secret"; o.fps.push("txt:"+v.toLowerCase()); return o; }
  o.fps.push("txt:"+v.toLowerCase());
  return o;
}
const TYPE_CONFLICT = {
  bool:["jdbc","url","host","hostport","path","queue","port"],
  jdbc:["bool","port","number"],
  host:["bool"], port:["bool","path","queue"], path:["bool","port"], queue:["bool","port"]
};
function typeAgreement(a,b){
  if(!a||!b||a==="empty"||b==="empty"||a==="encrypted"||b==="encrypted") return .5;
  if(a===b) return 1;
  if((TYPE_CONFLICT[a]||[]).indexOf(b)>=0) return 0;
  return .5;
}

/* -------------------------------------------------------- value compare */
const numEq=(a,b)=>{ const x=Number(a),y=Number(b); return a!==""&&b!==""&&!isNaN(x)&&!isNaN(y)&&x===y; };
const boolEq=(a,b)=>{ const t=x=>/^(true|yes|on|1|enabled)$/i.test(x), f=x=>/^(false|no|off|0|disabled)$/i.test(x); return (t(a)&&t(b))||(f(a)&&f(b)); };
function compareValues(bKey,bVal,sKey,sVal,opts,syn){
  opts=opts||{};
  const a=String(bVal==null?"":bVal), b=String(sVal==null?"":sVal);
  const at=a.trim(), bt=b.trim();
  const encA=ENC_RE.test(at), encB=ENC_RE.test(bt);
  if(at===""&&bt==="") return {status:"empty",msg:"Both sides are empty"};
  if(at===""||bt==="") return {status:"empty",msg:(at===""?"BW5":"Spring")+" value is empty"};
  if(at===bt) return a!==b&&opts.whitespace!==false ? {status:"ok",msg:"Exact match"} : {status:"ok",msg:"Exact match"};
  if(encA!==encB && SECRET_KEY_RE.test(bKey+" "+sKey))
    return {status:"encrypted",msg:(encA?"BW5":"Spring")+" value is obfuscated (#!) — cannot be compared with the plaintext on the other side"};
  if(encA&&encB) return {status:"mismatch",msg:"Both obfuscated but the ciphertext differs"};
  if(numEq(at,bt)) return {status:"ok",msg:"Numerically equal"};
  if(boolEq(at,bt)) return {status:"ok",msg:"Boolean equal"};
  if(!opts.caseSensitive && at.toLowerCase()===bt.toLowerCase()) return {status:"case",msg:"Differ only in letter case"};
  const ja=isJdbc(at), jb=isJdbc(bt);
  if(ja&&jb){
    const A=parseJdbc(at),B=parseJdbc(bt),d=[];
    const eq=(x,y)=>x.length===y.length&&x.every(v=>y.indexOf(v)>=0);
    if(!eq(A.hosts,B.hosts)) d.push("host: ["+A.hosts.join(", ")+"] vs ["+B.hosts.join(", ")+"]");
    if(!eq(A.ports,B.ports)) d.push("port: ["+A.ports.join(", ")+"] vs ["+B.ports.join(", ")+"]");
    if((A.service||"")!==(B.service||"")) d.push("service: "+(A.service||"-")+" vs "+(B.service||"-"));
    if((A.sid||"")!==(B.sid||"")) d.push("sid: "+(A.sid||"-")+" vs "+(B.sid||"-"));
    return d.length ? {status:"mismatch",msg:"JDBC target differs — "+d.join(" · ")}
                    : {status:"ok",msg:"Same JDBC target (formatting differs)"};
  }
  if(ja!==jb){
    const url=ja?at:bt, plain=ja?bt:at, plainKey=ja?sKey:bKey;
    const J=parseJdbc(url), tok=leafOf(tokenize(plainKey,syn));
    const has=arr=>arr.some(x=>x.toLowerCase()===plain.toLowerCase());
    if(tok==="host") return has(J.hosts)?{status:"ok",msg:"Host found inside the JDBC URL"}
      :{status:"mismatch",msg:"Host "+plain+" is not in the JDBC URL ("+(J.hosts.join(", ")||"none")+")"};
    if(tok==="port") return has(J.ports)?{status:"ok",msg:"Port found inside the JDBC URL"}
      :{status:"mismatch",msg:"Port "+plain+" is not in the JDBC URL ("+(J.ports.join(", ")||"none")+")"};
    if(tok==="sid"||tok==="service"){
      const c=[J.sid,J.service].filter(Boolean);
      return c.some(x=>x.toLowerCase()===plain.toLowerCase())?{status:"ok",msg:"SID/service found inside the JDBC URL"}
        :{status:"mismatch",msg:plain+" is not the SID/service of the JDBC URL ("+(c.join(", ")||"none")+")"};
    }
    return {status:"partial",msg:"One side is a JDBC URL — check manually ("+(J.hosts.join(", ")||"?")+":"+(J.ports.join(", ")||"?")+")"};
  }
  const hpA=at.match(HOSTPORT_RE), hpB=bt.match(HOSTPORT_RE);
  if(hpA&&hpB&&hpA[1]===hpB[1]&&hpA[2]!==hpB[2]) return {status:"mismatch",msg:"Same host, different port ("+hpA[2]+" vs "+hpB[2]+")"};
  if(at.replace(/\s+/g,"")===bt.replace(/\s+/g,"")) return {status:"whitespace",msg:"Differ only in internal whitespace"};
  return {status:"mismatch",msg:"Values differ"};
}

/* --------------------------------------------------------- pattern rules */
function ruleToRe(pat){
  const names=[];
  const src=String(pat).split(/(\{[a-zA-Z0-9_]+\})/).map(part=>{
    const m=part.match(/^\{([a-zA-Z0-9_]+)\}$/);
    if(m){ names.push(m[1]); return "([A-Za-z0-9_.\\-]+?)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  }).join("");
  return {re:new RegExp("^"+src+"$","i"), names};
}
function applyRules(rules, bEntries, sEntries){
  const out=[];
  const sByKey=new Map(sEntries.map(e=>[e.key.toLowerCase(),e]));
  (rules||[]).forEach(rule=>{
    if(!rule||!rule.bw5||!rule.spring) return;
    const R=ruleToRe(rule.bw5);
    bEntries.forEach(b=>{
      const m=b.key.match(R.re);
      if(!m) return;
      let target=rule.spring;
      R.names.forEach((n,i)=>{ target=target.replace(new RegExp("\\{"+n+"\\}","g"), m[i+1]); });
      const s=sByKey.get(target.toLowerCase());
      if(s) out.push({b,s,rule});
    });
  });
  return out;
}
function deriveRule(bKey,sKey){
  const bt=String(bKey).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const st=String(sKey).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const shared=bt.filter(t=>st.some(u=>u.toLowerCase()===t.toLowerCase()));
  const cand=shared.filter(t=>{ const l=t.toLowerCase(); return !(l in BASE_SYN) && LEAVES.indexOf(l)<0 && l.length>2; });
  if(cand.length!==1) return null;
  const v=cand[0];
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const bPat=String(bKey).replace(new RegExp("\\b"+esc(v)+"\\b","i"),"{x}");
  const sPat=String(sKey).replace(new RegExp("(^|[^A-Za-z0-9])"+esc(v)+"(?=$|[^A-Za-z0-9])","i"),"$1{x}");
  if(bPat===bKey||sPat===sKey) return null;
  return {bw5:bPat, spring:sPat, source:"learned", sample:bKey+" ⇄ "+sKey};
}
function deriveSynonyms(bKey,sKey,syn){
  const a=tokenize(bKey,syn), b=tokenize(sKey,syn);
  const ra=a.filter(t=>b.indexOf(t)<0), rb=b.filter(t=>a.indexOf(t)<0);
  if(ra.length===1 && rb.length===1 && ra[0]!==rb[0]) return [{from:ra[0], to:rb[0], sample:bKey+" ⇄ "+sKey}];
  return [];
}

/* ------------------------------------------------------------- enrichment */
function enrich(entries, syn){
  return entries.map(e=>{
    const tokens=tokenize(e.key,syn);
    const leaf=leafOf(tokens);
    const ns=tokens.filter(t=>t!==leaf);
    const cls=classify(e.key,e.value);
    return Object.assign({},e,{tokens,leaf,ns,nsKey:normKey(ns),norm:normKey(tokens),loose:looseKey(tokens),
      vtype:cls.type,fps:cls.fps,jdbc:cls.jdbc});
  });
}

/* --------------------------------------------------------------- analyze */
const DEFAULTS={autoThreshold:.70,reviewThreshold:.40,margin:.07,caseSensitive:false,skipBlocks:true};

function analyze(bwEntriesRaw, spEntriesRaw, cfg){
  cfg=Object.assign({},DEFAULTS,cfg||{});
  const learned=cfg.learned||{};
  const syn=makeVocab(learned);
  const ign=learned.ignored||{b:{},s:{}};
  const B=enrich(bwEntriesRaw.filter(e=>!(ign.b||{})[e.key]),syn);
  const S=enrich(spEntriesRaw.filter(e=>!(ign.s||{})[e.key]&&!(cfg.skipBlocks&&e.kind==="block")),syn);
  const byB=new Map(B.map(e=>[e.key,e])), byS=new Map(S.map(e=>[e.key,e]));
  const usedB=new Set(), usedS=new Set(), pairs=[];
  const accept=(b,s,how,score,reasons)=>{
    if(!b||!s||usedB.has(b.key)||usedS.has(s.key)) return false;
    usedB.add(b.key); usedS.add(s.key);
    pairs.push({b,s,how,score:score==null?1:score,reasons:reasons||[],cmp:compareValues(b.key,b.value,s.key,s.value,cfg,syn)});
    return true;
  };

  /* 2 anchors */
  (learned.mappings||[]).forEach(m=>accept(byB.get(m.b),byS.get(m.s),"manual",1,["confirmed by a person"]));
  applyRules(learned.rules,B,S).forEach(r=>accept(r.b,r.s,"rule",1,["rule "+r.rule.bw5+" ⇄ "+r.rule.spring]));
  B.forEach(b=>{ if(!usedB.has(b.key)&&byS.has(b.key)) accept(b,byS.get(b.key),"exact",1,["identical key"]); });
  [["loose","normalized name"],["norm","same tokens"]].forEach(([f,why])=>{
    const iB=new Map(), iS=new Map();
    B.forEach(e=>{ if(usedB.has(e.key))return; const k=e[f]; if(!k)return; if(!iB.has(k)) iB.set(k,[]); iB.get(k).push(e); });
    S.forEach(e=>{ if(usedS.has(e.key))return; const k=e[f]; if(!k)return; if(!iS.has(k)) iS.set(k,[]); iS.get(k).push(e); });
    iB.forEach((arr,k)=>{ const o=iS.get(k); if(arr.length===1&&o&&o.length===1) accept(arr[0],o[0],"normalized",.97,[why]); });
  });

  /* 3 clusters */
  const clusterOf=list=>{ const m=new Map(); list.forEach(e=>{ if(!e.nsKey) return; if(!m.has(e.nsKey)) m.set(e.nsKey,[]); m.get(e.nsKey).push(e); }); return m; };
  const cB=clusterOf(B), cS=clusterOf(S);
  const votes=new Map();
  pairs.forEach(p=>{ if(!p.b.nsKey||!p.s.nsKey) return; const k=p.b.nsKey+"|"+p.s.nsKey; votes.set(k,(votes.get(k)||0)+1); });
  const clusterLinks=[];
  cB.forEach((bm,bk)=>{
    let best=null;
    cS.forEach((sm,sk)=>{
      const v=votes.get(bk+"|"+sk)||0;
      const score=Math.min(1, jaccard(bk.split("."),sk.split(".")) + Math.min(.5, v*.25));
      if(score>=.5&&(!best||score>best.score)) best={bk,sk,score,votes:v};
    });
    if(best) clusterLinks.push(best);
  });
  const clusterMap=new Map(clusterLinks.map(l=>[l.bk,l]));

  /* 3b composites */
  const composites=[];
  const ROLES=["host","port","sid","service","database"];
  S.forEach(s=>{
    if(usedS.has(s.key)) return;
    if(s.vtype!=="jdbc" && !(s.vtype==="url"&&s.leaf==="url")) return;
    const tries=[];
    clusterLinks.filter(l=>l.sk===s.nsKey&&l.score>=.5).forEach(l=>tries.push({k:l.bk,w:l.score+1}));
    cB.forEach((arr,k)=>{ const j=jaccard(k.split("."),s.nsKey.split(".")); if(j>=.5) tries.push({k,w:j}); });
    tries.sort((a,b)=>b.w-a.w);
    let bk=null, parts=[];
    for(const t of tries){
      const p=(cB.get(t.k)||[]).filter(b=>!usedB.has(b.key)&&ROLES.indexOf(b.leaf)>=0);
      if(p.length>=2){ bk=t.k; parts=p; break; }
    }
    if(!bk) return;
    const detail=parts.map(b=>({b,role:b.leaf,cmp:compareValues(b.key,b.value,s.key,s.value,cfg,syn)}));
    const bad=detail.filter(d=>d.cmp.status==="mismatch");
    detail.forEach(d=>usedB.add(d.b.key)); usedS.add(s.key);
    composites.push({s,parts:detail,cluster:{bk,sk:s.nsKey},status:bad.length?"mismatch":"ok",
      msg:bad.length?bad.map(d=>d.role+": "+d.b.value+" is not in the URL").join(" · "):"every BW5 part is present in the Spring URL"});
  });

  /* 4 evidence */
  const fpCount=new Map();
  const countFps=list=>list.forEach(e=>uniq(e.fps).forEach(f=>fpCount.set(f,(fpCount.get(f)||0)+1)));
  countFps(B); countFps(S);
  const N=Math.max(2,B.length+S.length);
  const idf=fp=>{ const c=fpCount.get(fp)||1; return Math.max(0,Math.min(1,Math.log(N/c)/Math.log(N))); };
  const fpIndexS=new Map();
  S.forEach(e=>uniq(e.fps).forEach(f=>{ if(!fpIndexS.has(f)) fpIndexS.set(f,[]); fpIndexS.get(f).push(e); }));
  const valueEvidence=(b,s)=>{
    const Bf=new Set(uniq(s.fps)); let best=0, why="";
    uniq(b.fps).forEach(f=>{
      if(!Bf.has(f)) return;
      const strong=/^(txt|host|url|jdbc|q):/.test(f);
      const v=Math.min(1,(strong?1:.6)*idf(f)*1.35);
      if(v>best){ best=v; why="shared value ("+f.split(":")[0]+" "+f.split(":").slice(1).join(":").slice(0,28)+")"; }
    });
    if(!best&&b.vtype!=="empty"&&s.vtype==="jdbc"&&s.jdbc){
      const v=String(b.value).trim().toLowerCase();
      if(v&&(s.jdbc.hosts.some(h=>h.toLowerCase()===v)||s.jdbc.ports.indexOf(v)>=0||
        (s.jdbc.service||"").toLowerCase()===v||(s.jdbc.sid||"").toLowerCase()===v)){ best=.8; why="BW5 value appears inside the Spring JDBC URL"; }
    }
    return {score:best,why};
  };

  /* 5-6 score + assign */
  const restB=B.filter(e=>!usedB.has(e.key)), restS=S.filter(e=>!usedS.has(e.key));
  const tokIndexS=new Map(), leafIndexS=new Map();
  restS.forEach(e=>{
    e.tokens.forEach(t=>{ if(!tokIndexS.has(t)) tokIndexS.set(t,[]); tokIndexS.get(t).push(e); });
    const k=e.leaf||"~"; if(!leafIndexS.has(k)) leafIndexS.set(k,[]); leafIndexS.get(k).push(e);
  });
  const scorePair=(b,s)=>{
    const f={};
    f.tok=jaccard(b.tokens,s.tokens); f.str=dice(b.loose,s.loose);
    f.ns=b.nsKey&&s.nsKey?jaccard(b.nsKey.split("."),s.nsKey.split(".")):.3;
    const link=clusterMap.get(b.nsKey);
    f.cluster=(link&&link.sk===s.nsKey)?1:0;
    if(!b.leaf||!s.leaf) f.leaf=.5; else if(b.leaf===s.leaf) f.leaf=1; else if(leafCompatible(b.leaf,s.leaf)) f.leaf=.7; else f.leaf=0;
    const ev=valueEvidence(b,s); f.val=ev.score; f.type=typeAgreement(b.vtype,s.vtype);
    let score=.20*f.tok+.12*f.str+.12*f.ns+.16*f.cluster+.17*f.leaf+.18*f.val+.05*f.type;
    const reasons=[];
    if(f.cluster) reasons.push("same config group ("+b.nsKey+" ⇄ "+s.nsKey+")");
    if(f.leaf===1) reasons.push("both are the '"+b.leaf+"' setting"); else if(f.leaf===.7) reasons.push("'"+b.leaf+"' vs '"+s.leaf+"' are compatible");
    if(ev.score>.35) reasons.push(ev.why);
    if(f.tok>.5) reasons.push("similar name");
    if(b.leaf&&s.leaf&&f.leaf===0){ score*=.35; reasons.push("⚠ different setting role ("+b.leaf+" vs "+s.leaf+")"); }
    if(f.type===0){ score*=.55; reasons.push("⚠ value types disagree ("+b.vtype+" vs "+s.vtype+")"); }
    if(!f.cluster&&link) score*=.9;
    return {score:Math.max(0,Math.min(1,score)),reasons};
  };
  const cands=[];
  restB.forEach(b=>{
    const seen=new Set(), pool=[];
    const add=list=>(list||[]).forEach(s=>{ if(!seen.has(s.key)){ seen.add(s.key); pool.push(s); } });
    const link=clusterMap.get(b.nsKey);
    if(link) add((cS.get(link.sk)||[]).filter(e=>!usedS.has(e.key)));
    uniq(b.fps).forEach(f=>{ if(idf(f)>.25) add(fpIndexS.get(f)); });
    b.tokens.forEach(t=>{ const l=tokIndexS.get(t); if(l&&l.length<=60) add(l); });
    if(b.leaf) add((leafIndexS.get(b.leaf)||[]).slice(0,80));
    if(pool.length<3) add(restS.slice(0,200));
    pool.forEach(s=>{ const r=scorePair(b,s); if(r.score>=.22) cands.push({b,s,score:r.score,reasons:r.reasons}); });
  });
  const rejected=new Set((learned.rejected||[]).map(r=>r.b+"|"+r.s));
  const live=cands.filter(c=>!rejected.has(c.b.key+"|"+c.s.key));
  const best=new Map(), second=new Map();
  const note=(k,sc)=>{ const b1=best.get(k); if(b1==null||sc>b1){ second.set(k,b1==null?0:b1); best.set(k,sc); } else if(sc>(second.get(k)||0)) second.set(k,sc); };
  live.forEach(c=>{ note("b:"+c.b.key,c.score); note("s:"+c.s.key,c.score); });
  live.sort((x,y)=>y.score-x.score);
  const alts=new Map();
  live.forEach(c=>{ const k=c.b.key; if(!alts.has(k)) alts.set(k,[]); if(alts.get(k).length<4) alts.get(k).push(c); });
  const review=[];
  live.forEach(c=>{
    if(usedB.has(c.b.key)||usedS.has(c.s.key)) return;
    const margin=Math.min(c.score-(second.get("b:"+c.b.key)||0), c.score-(second.get("s:"+c.s.key)||0));
    const clear=margin>=cfg.margin||c.score>=.9;
    if(c.score>=cfg.autoThreshold&&clear) accept(c.b,c.s,"auto",c.score,c.reasons);
    else if(c.score>=cfg.reviewThreshold){
      if(review.some(r=>r.b.key===c.b.key||r.s.key===c.s.key)) return;
      review.push({b:c.b,s:c.s,score:c.score,
        reasons:c.reasons.concat(clear?[]:["several candidates scored close together — confirm which is right"]),
        cmp:compareValues(c.b.key,c.b.value,c.s.key,c.s.value,cfg,syn),
        alternatives:(alts.get(c.b.key)||[]).filter(x=>x.s.key!==c.s.key).map(x=>({key:x.s.key,value:x.s.value,score:x.score}))});
    }
  });
  const inRB=new Set(review.map(r=>r.b.key)), inRS=new Set(review.map(r=>r.s.key));
  const sugB=new Map(), sugS=new Map();
  live.forEach(c=>{
    if(usedB.has(c.b.key)||usedS.has(c.s.key)) return;
    if(!sugB.has(c.b.key)) sugB.set(c.b.key,[]); if(sugB.get(c.b.key).length<5) sugB.get(c.b.key).push({s:c.s,score:c.score,reasons:c.reasons});
    if(!sugS.has(c.s.key)) sugS.set(c.s.key,[]); if(sugS.get(c.s.key).length<5) sugS.get(c.s.key).push({e:c.b,score:c.score,reasons:c.reasons});
  });
  const onlyB=B.filter(e=>!usedB.has(e.key)&&!inRB.has(e.key)).map(e=>({e,sug:sugB.get(e.key)||[]}));
  const onlyS=S.filter(e=>!usedS.has(e.key)&&!inRS.has(e.key)).map(e=>({e,sug:sugS.get(e.key)||[]}));
  const stats={bw5:B.length,spring:S.length,pairs:pairs.length,review:review.length,composites:composites.length,
    onlyB:onlyB.length,onlyS:onlyS.length,
    byHow:pairs.reduce((a,p)=>{a[p.how]=(a[p.how]||0)+1;return a;},{}),
    byStatus:pairs.reduce((a,p)=>{a[p.cmp.status]=(a[p.cmp.status]||0)+1;return a;},{})};
  return {pairs,composites,review,onlyB,onlyS,clusters:clusterLinks,stats,syn};
}

/* ---------------------------------------------------------------- warnings */
function buildWarnings(bwParsed, spParsed, pairs, cfg){
  const w=[], syn=makeVocab((cfg&&cfg.learned)||{});
  const add=(sev,side,key,type,msg,extra)=>w.push({sev,side,key,type,msg,extra:extra||""});
  const sKeys=new Set(spParsed.entries.map(e=>e.key)), bKeys=new Set(bwParsed.entries.map(e=>e.key));
  const bMap=new Map(bwParsed.entries.map(e=>[e.key,e.value]));
  (bwParsed.dups||[]).forEach(d=>add("high","bw5",d.key,"Duplicate key","Defined more than once (lines "+d.first+" and "+d.line+") — the last one silently wins"));
  (spParsed.dups||[]).forEach(d=>add("high","spring",d.key,"Duplicate key","Defined more than once in this YAML block"));
  (bwParsed.commented||[]).forEach(c=>{
    if(bKeys.has(c.key)) return;
    const live=Array.from(sKeys).some(k=>normKey(tokenize(k,syn))===normKey(tokenize(c.key,syn)));
    add(live?"high":"low","bw5",c.key,"Commented out","Commented out in BW5 (line "+c.line+")"+(live?" but the matching key IS active on the Spring side":""));
  });
  const scan=(entries,side)=>entries.forEach(e=>{
    const raw=String(e.raw!=null?e.raw:e.value), t=raw.trim();
    if(t==="") add("med",side,e.key,"Empty value","Key is declared with no value");
    if(raw!==t&&t!=="") add("med",side,e.key,"Trailing whitespace","Value has leading/trailing spaces — both runtimes keep them: \""+raw+"\"");
    if(/\t/.test(raw)) add("med",side,e.key,"Tab character","Value contains a TAB");
    const src=String(e.unresolved!=null?e.unresolved:e.value);
    let m, re=/\$\{([^}]+)\}/g;
    while((m=re.exec(src))){
      const known = side==="bw5"?bMap.has(m[1]):sKeys.has(m[1]);
      if(!known) add("high",side,e.key,"Unresolved reference","References ${"+m[1]+"} which is not defined in this file");
    }
    if(SECRET_KEY_RE.test(e.key)&&t&&!ENC_RE.test(t)&&side==="spring"&&t.length>2&&!/^\$\{/.test(t))
      add("med","spring",e.key,"Plaintext secret","Password/secret in clear text — should come from a Secret/vault");
    if(/[^\x20-\x7e]/.test(t)) add("low",side,e.key,"Non-ASCII character","Value contains a non-printable/non-ASCII character");
  });
  scan(bwParsed.entries,"bw5"); scan(spParsed.entries,"spring");
  pairs.forEach(p=>{
    if(p.cmp.status==="mismatch") add("high","both",p.b.key,"Value mismatch",p.cmp.msg+" — BW5: \""+p.b.value+"\"  vs  Spring: \""+p.s.value+"\"",p.s.key);
    else if(p.cmp.status==="case"||p.cmp.status==="whitespace") add("med","both",p.b.key,p.cmp.status==="case"?"Case difference":"Whitespace difference",p.cmp.msg,p.s.key);
  });
  const ord={high:0,med:1,low:2};
  return w.sort((a,b)=>ord[a.sev]-ord[b.sev]||a.key.localeCompare(b.key));
}

/* ------------------------------------------------------------- write-back */
const STAMP="# ---- managed by Config Match & Catch ----";
function propsIndex(lines){
  const idx=new Map();
  lines.forEach((l,i)=>{ const m=l.match(/^\s*([^#!\s=:][^=:\s]*)\s*[=:]/); if(m&&!idx.has(m[1])) idx.set(m[1],i); });
  return idx;
}
function contSpan(lines,i){ let n=0; while(i+n<lines.length&&/\\\s*$/.test(lines[i+n])&&!/\\\\\s*$/.test(lines[i+n])) n++; return n; }
function applyPropsChanges(text,changes){
  const eol=/\r\n/.test(text)?"\r\n":"\n";
  let lines=String(text).split(/\r?\n/);
  const pending=[];
  (changes||[]).forEach(c=>{
    const idx=propsIndex(lines);
    if(c.op==="remove"){ if(idx.has(c.key)){ const i=idx.get(c.key),n=contSpan(lines,i); for(let k=0;k<=n;k++) lines[i+k]="#"+lines[i+k]; } return; }
    if(idx.has(c.key)){
      const i=idx.get(c.key), n=contSpan(lines,i);
      const m=lines[i].match(/^(\s*[^=:\s]+\s*[=:])/);
      lines.splice(i,n+1,m[1]+String(c.value));
    } else pending.push(c);
  });
  if(pending.length){
    if(lines.length&&lines[lines.length-1].trim()!=="") lines.push("");
    if(lines.indexOf(STAMP)<0) lines.push(STAMP);
    pending.forEach(c=>lines.push(c.key+"="+String(c.value)));
    lines.push("");
  }
  return lines.join(eol);
}
const indentOf=l=>l.trim()===""?-1:l.match(/^(\s*)/)[1].length;
function findYamlPath(lines,segs){
  let from=0,to=lines.length,parentIndent=-1,hit=null;
  for(let s=0;s<segs.length;s++){
    let childIndent=-1,found=-1;
    for(let i=from;i<to;i++){
      const l=lines[i]; if(!l.trim()||/^\s*#/.test(l)) continue;
      const ind=indentOf(l); if(childIndent<0) childIndent=ind; if(ind!==childIndent) continue;
      const m=l.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^:#]+?))\s*:(\s|$)/); if(!m) continue;
      if(((m[1]||m[2]||m[3]||"").trim())===segs[s]){ found=i; break; }
    }
    if(found<0) return null;
    parentIndent=indentOf(lines[found]); from=found+1; to=lines.length;
    for(let i=found+1;i<lines.length;i++){ const l=lines[i]; if(!l.trim()||/^\s*#/.test(l)) continue; if(indentOf(l)<=parentIndent){ to=i; break; } }
    hit={line:found,indent:parentIndent,end:to};
  }
  return hit;
}
function yamlScalar(v){
  const s=String(v==null?"":v);
  if(s==="") return '""';
  if(/^(true|false)$/i.test(s)||/^-?\d+(\.\d+)?$/.test(s)) return s;
  if(/^\s|\s$/.test(s)||/[:#{}\[\],&*?|<>=!%@`"']/.test(s)||/^(null|yes|no|on|off|~|-)$/i.test(s)) return "'"+s.replace(/'/g,"''")+"'";
  return s;
}
function applyYamlChanges(text,changes,rootPath,indentPref){
  const eol=/\r\n/.test(text)?"\r\n":"\n";
  let lines=String(text).split(/\r?\n/);
  const rootSegs=(rootPath&&rootPath!=="__ALL__")?rootPath.split("."):[];
  const pending=[];
  const locate=k=>findYamlPath(lines,rootSegs.concat([k]))||(k.indexOf(".")>=0?findYamlPath(lines,rootSegs.concat(k.split("."))):null);
  (changes||[]).forEach(c=>{
    const hit=locate(c.key);
    if(!hit){ if(c.op!=="remove") pending.push(c); return; }
    const m=lines[hit.line].match(/^(\s*(?:"[^"]+"|'[^']+'|[^:#]+?)\s*:)([\s\S]*)$/); if(!m) return;
    const rest=m[2], isBlock=/^\s*[>|]/.test(rest);
    let last=hit.line;
    if(isBlock) for(let i=hit.line+1;i<lines.length;i++){ if(!lines[i].trim()){ last=i; continue; } if(indentOf(lines[i])>hit.indent) last=i; else break; }
    if(c.op==="remove"){ for(let i=hit.line;i<=last;i++) lines[i]="#"+lines[i]; return; }
    const cm=isBlock?"":(rest.match(/\s+#.*$/)||[""])[0];
    lines.splice(hit.line,last-hit.line+1,m[1]+" "+yamlScalar(c.value)+cm);
  });
  if(pending.length){
    let insertAt=lines.length, childIndent=(indentPref==null?2:indentPref);
    if(rootSegs.length){
      const hit=findYamlPath(lines,rootSegs);
      if(hit){
        insertAt=hit.end;
        for(let i=hit.line+1;i<hit.end;i++) if(lines[i].trim()&&!/^\s*#/.test(lines[i])){ childIndent=indentOf(lines[i]); break; }
        while(insertAt-1>hit.line&&(!lines[insertAt-1].trim()||/^\s*#/.test(lines[insertAt-1]))) insertAt--;
      }
    }
    const pad=" ".repeat(childIndent);
    lines.splice.apply(lines,[insertAt,0].concat([pad+STAMP].concat(pending.map(c=>pad+c.key+": "+yamlScalar(c.value)))));
  }
  return lines.join(eol);
}
function lineDiff(a,b){
  const A=String(a).split(/\r?\n/), B=String(b).split(/\r?\n/), out=[];
  const inA=new Set(A), inB=new Set(B);
  let i=0,j=0;
  while(i<A.length||j<B.length){
    if(i<A.length&&j<B.length&&A[i]===B[j]){ i++;j++; continue; }
    if(j<B.length&&!inA.has(B[j])){ out.push({t:"+",l:B[j],n:j+1}); j++; continue; }
    if(i<A.length&&!inB.has(A[i])){ out.push({t:"-",l:A[i],n:i+1}); i++; continue; }
    i++;j++;
  }
  return out;
}
const toEnvKey=k=>String(k).replace(/[^A-Za-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
const toPropKey=k=>String(k).replace(/[_\s]+/g,".").replace(/\.+/g,".");

/* ---------------------------------------------------------------- learning */
function learnFromPair(learned,bKey,sKey){
  learned=JSON.parse(JSON.stringify(learned||{}));
  ["synonyms","rules","mappings","rejected"].forEach(k=>{ learned[k]=learned[k]||[]; });
  learned.ignored=learned.ignored||{b:{},s:{}};
  learned.mappings=learned.mappings.filter(m=>m.b!==bKey&&m.s!==sKey).concat([{b:bKey,s:sKey}]);
  learned.rejected=learned.rejected.filter(r=>!(r.b===bKey&&r.s===sKey));
  const syn=makeVocab(learned);
  deriveSynonyms(bKey,sKey,syn).forEach(s=>{
    const ex=learned.synonyms.find(x=>x.from===s.from&&x.to===s.to);
    if(ex) ex.count=(ex.count||1)+1; else learned.synonyms.push(Object.assign({count:1},s));
  });
  const r=deriveRule(bKey,sKey);
  if(r){
    const ex=learned.rules.find(x=>x.bw5===r.bw5&&x.spring===r.spring);
    if(ex) ex.count=(ex.count||1)+1; else learned.rules.push(Object.assign({count:1},r));
  }
  return learned;
}

return {parseProperties,parseYaml,resolveRefs,tokenize,leafOf,makeVocab,classify,parseJdbc,isJdbc,
  compareValues,analyze,buildWarnings,applyPropsChanges,applyYamlChanges,findYamlPath,yamlScalar,lineDiff,
  toEnvKey,toPropKey,learnFromPair,deriveRule,applyRules,DEFAULTS,STAMP,version:"4.0"};
});
