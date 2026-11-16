"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const fs=require("fs"), path=require("path"), yaml=require("js-yaml");
const E=require("../src/engine.js"), C=require("../src/checks.js")(E);
const fx=f=>fs.readFileSync(path.join(__dirname,"fixtures",f),"utf8");
const B=E.parseProperties(fx("env_prd.properties"));
const S=E.parseYaml(fx("commonvalues.yaml"),"common.CommonResourcesdata",yaml.load);
const envs=[{name:"Production",bw5:B,spring:S},{name:"Testing",bw5:B,spring:S},{name:"Staging",bw5:null,spring:null}];
const levels=l=>l.map(i=>i.level);
const has=(l,re,lv)=>l.some(i=>re.test(i.msg)&&(!lv||i.level===lv));

test("twin name: confirmed pair, then rule, then the other file's style",()=>{
  const sk=S.entries.map(e=>e.key), bk=B.entries.map(e=>e.key);
  assert.equal(C.suggestTwin("x.y","bw5",{mappings:[{b:"x.y",s:"zz"}]},sk).name,"zz");
  assert.equal(C.suggestTwin("database.crm.host","bw5",{rules:[{bw5:"database.{x}.host",spring:"{x}_database_host"}]},sk).name,"crm_database_host");
  assert.equal(C.suggestTwin("crm_database_host","spring",{rules:[{bw5:"database.{x}.host",spring:"{x}_database_host"}]},bk).name,"database.crm.host");
  assert.equal(C.suggestTwin("new.Feature.flag","bw5",{},sk).name,"new_feature_flag");
  assert.equal(C.suggestTwin("new_feature_flag","spring",{},bk).name,"new.feature.flag");
});
test("name rules",()=>{
  assert.deepEqual(levels(C.checkName("bw5","a.b.c")),[]);
  assert.ok(has(C.checkName("bw5","a b"),/spaces/,"error"));
  assert.ok(has(C.checkName("bw5","a=b"),/= :/,"error"));
  assert.ok(has(C.checkName("bw5","#a"),/comment/,"error"));
  assert.ok(has(C.checkName("spring","a:b"),/letters, digits/,"error"));
  assert.ok(has(C.checkName("spring","a.b"),/dot/,"warn"));
  assert.ok(has(C.checkName("spring",""),/empty/,"error"));
});
test("new variable: duplicate key is blocked, similar key warned, missing files skipped",()=>{
  const r=C.checkNewVariable({bKey:"jms.jndiuser",sKey:"brand_new_key",createB:true,createS:true,values:{Production:{bw5:"a",spring:"a"},Testing:{bw5:"b",spring:"b"}}},envs);
  assert.ok(has(r,/jms\.jndiuser already exists in Production/,"error"));
  assert.ok(has(r,/Staging · BW5: file not set up yet/,"info"));
  const r2=C.checkNewVariable({bKey:"JMS.JNDIUSER",sKey:"x_y",createB:true,createS:false,values:{}},envs);
  assert.ok(has(r2,/differs only in case/,"warn"));
  const r3=C.checkNewVariable({bKey:"database.ods.loginUser",sKey:"",createB:true,createS:false,values:{Production:{bw5:"u"},Testing:{bw5:"v"}}},envs);
  assert.ok(has(r3,/commented out/,"warn"));
});
test("new variable: values — empty, spaces, port, duplicate value, same server in two environments",()=>{
  const r=C.checkNewVariable({bKey:"crm.db.port",sKey:"crm_db_port",createB:true,createS:true,
    values:{Production:{bw5:"15x",spring:""},Testing:{bw5:" 1521",spring:"1521"}}},envs);
  assert.ok(has(r,/port should be a number/,"warn"));
  assert.ok(has(r,/value is empty/,"warn"));
  assert.ok(has(r,/starts or ends with a space/,"warn"));
  const dupVal=B.entries.find(e=>e.value.length>8&&!/^\d+$/.test(e.value)&&!/^#!/.test(e.value));
  const r2=C.checkNewVariable({bKey:"copy.of.something",sKey:"",createB:true,createS:false,values:{Production:{bw5:dupVal.value},Testing:{bw5:"zzzzzzzz-other"}}},envs);
  assert.ok(has(r2,new RegExp("already used by "+dupVal.key.replace(/\./g,"\\.")),"warn"));
  const r3=C.checkNewVariable({bKey:"crm.host",sKey:"crm_host",createB:true,createS:true,values:{Production:{bw5:"crm-db.vf.local",spring:"crm-db.vf.local"},Testing:{bw5:"crm-db.vf.local",spring:"crm-db.vf.local"}}},envs);
  assert.ok(has(r3,/Testing · BW5 · crm.host: the same value is used in Production/,"warn"));
  assert.equal(r3.filter(i=>/same value is used in/.test(i.msg)).length,1);   // reported once, not per side and per env
  const ok=C.checkNewVariable({bKey:"crm.host",sKey:"crm_host",createB:true,createS:true,values:{Production:{bw5:"crm-prd.vf.local",spring:"crm-prd.vf.local"},Testing:{bw5:"crm-tst.vf.local",spring:"crm-tst.vf.local"}}},envs);
  assert.deepEqual(ok.filter(i=>i.level!=="info"),[]);
});
test("twin values that disagree are flagged; plain-text password in Spring is flagged",()=>{
  const r=C.checkNewVariable({bKey:"svc.timeout",sKey:"svc_timeout",createB:true,createS:true,values:{Production:{bw5:"30",spring:"45"},Testing:{bw5:"30",spring:"30"}}},envs);
  assert.ok(has(r,/differs from its twin svc\.timeout/,"warn"));
  const p=C.checkNewVariable({bKey:"svc.password",sKey:"svc_password",createB:false,createS:true,values:{Production:{spring:"Secret123"},Testing:{spring:"${SVC_PWD}"}}},envs);
  assert.ok(has(p,/plain text/,"warn"));
});
test("edit checks reuse the value rules, ignoring the key's own old value",()=>{
  const e=B.entries.find(x=>x.key==="jms.jndiuser");
  assert.ok(!has(C.checkEdit({env:"Production",side:"bw5",key:e.key,value:e.value},envs),/already used by jms\.jndiuser/));
  assert.ok(has(C.checkEdit({env:"Production",side:"bw5",key:e.key,value:""},envs),/empty/));
  assert.ok(has(C.checkEdit({env:"Production",side:"bw5",key:e.key,value:"a\nb"},envs),/several lines/,"error"));
});
test("final check: invalid YAML and new duplicate keys are blocked",()=>{
  const y=fx("commonvalues.yaml");
  assert.ok(has(C.checkPatched("spring",y,y+"\n  bad: [unclosed\n","common.CommonResourcesdata",yaml.load),/valid YAML/,"error"));
  const p=fx("env_prd.properties");
  assert.ok(has(C.checkPatched("bw5",p,p+"\njms.jndiuser=again\n",null,yaml.load),/define jms\.jndiuser twice/,"error"));
  assert.deepEqual(C.checkPatched("bw5",p,E.applyPropsChanges(p,[{op:"set",key:"jms.jndiuser",value:"X"}]),null,yaml.load),[]);
  const added=E.applyYamlChanges(y,[{op:"add",key:"new_key",value:"v: with colon"}],"common.CommonResourcesdata");
  assert.deepEqual(C.checkPatched("spring",y,added,"common.CommonResourcesdata",yaml.load),[]);
  assert.equal(E.parseYaml(added,"common.CommonResourcesdata",yaml.load).entries.find(e=>e.key==="new_key").value,"v: with colon");
});
test("keys missing compared with other environments",()=>{
  const T=E.parseProperties(fx("env_prd.properties").replace(/^jms\.jndiuser=.*$/m,""));
  const m=C.missingVsOtherEnvs([{name:"Production",bw5:B},{name:"Testing",bw5:T}],"Testing","bw5");
  assert.deepEqual(m.map(x=>x.key),["jms.jndiuser"]);
  assert.equal(m[0].from[0].env,"Production");
});
