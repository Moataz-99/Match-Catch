// node --test test/   — engine behaviour pinned on the redacted sample files
"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const fs=require("fs"), path=require("path"), yaml=require("js-yaml");
const E=require("../src/engine.js");
const fx=f=>fs.readFileSync(path.join(__dirname,"fixtures",f),"utf8");

const B=E.parseProperties(fx("env_prd.properties"));
const S=E.parseYaml(fx("commonvalues.yaml"),"common.CommonResourcesdata",yaml.load);
const R=E.analyze(B.entries,S.entries,{});
const pair=(b)=>R.pairs.find(p=>p.b.key===b);

test("parses both sample files",()=>{
  assert.equal(B.entries.length,50);
  assert.equal(S.entries.length,54);
  assert.equal(S.root,"common.CommonResourcesdata");
  assert.deepEqual(B.dups.map(d=>d.key),["cms.rv.network.dr.1"]);
  assert.ok(B.commented.some(c=>c.key==="database.ods.loginUser"));
});

test("resolves ${refs} inside the properties file",()=>{
  const url=B.entries.find(e=>e.key==="database.VoucherList.url").value;
  assert.match(url,/HOST=10\.21\.126\.38/); assert.match(url,/SERVICE_NAME=ZEROTENWL/);
});

test("overall result is stable",()=>{
  assert.deepEqual(R.stats.byStatus,{mismatch:5,encrypted:4,ok:3});
  assert.equal(R.stats.pairs,12);
  assert.equal(R.stats.composites,3);
  assert.equal(R.review.length,5);
});

test("normalized names pair across naming styles",()=>{
  assert.equal(pair("database.eai.user").s.key,"eai_database_username");
  assert.equal(pair("database.ods.schema").s.key,"ods_database_Schema");
  assert.equal(pair("database.ods.schema").cmp.status,"mismatch");
  assert.equal(pair("database.trans.user").s.key,"databases_engines_trans_username");
});

test("TIBCO #! values are reported as not comparable, not as mismatches",()=>{
  assert.equal(pair("database.ods.Password").cmp.status,"encrypted");
});

test("auto pairs found by group + shared rare value",()=>{
  assert.equal(pair("log.jms.queue.log").s.key,"ADBLOG_Jms_EAILog_Queue");
  assert.equal(pair("log.error.store").s.key,"log_errorLog");
});

test("connection groups: BW5 host/port/sid vs one Spring JDBC URL",()=>{
  const ods=R.composites.find(c=>c.s.key==="ods_database_URL");
  assert.deepEqual(ods.parts.map(p=>p.role+":"+p.cmp.status),["host:mismatch","port:ok"]);
  const eai=R.composites.find(c=>c.s.key==="eai_database_URL");
  assert.equal(eai.status,"mismatch");
});

test("ambiguous candidates go to review instead of being guessed",()=>{
  assert.ok(R.review.some(r=>r.b.key==="prov.JMSUser"&&r.s.key==="jms_username"));
  assert.ok(!R.pairs.some(p=>p.b.key==="prov.JMSUser"));
});

test("confirming a pair learns a reusable pattern rule",()=>{
  const L=E.learnFromPair({},"database.eai.password","eai_database_password");
  assert.deepEqual({b:L.rules[0].bw5,s:L.rules[0].spring},{b:"database.{x}.password",s:"{x}_database_password"});
  const R2=E.analyze(B.entries,S.entries,{learned:L});
  assert.equal(R2.pairs.find(p=>p.b.key==="database.eai.password").how,"manual");
});

test("rejected suggestions are not offered again",()=>{
  const R2=E.analyze(B.entries,S.entries,{learned:{rejected:[{b:"prov.JMSUser",s:"jms_username"}]}});
  assert.ok(!R2.review.some(r=>r.b.key==="prov.JMSUser"&&r.s.key==="jms_username"));
});

test("warnings catch the planted problems",()=>{
  const W=E.buildWarnings(B,S,R.pairs,{});
  const types=new Set(W.map(w=>w.type));
  ["Duplicate key","Commented out","Trailing whitespace","Plaintext secret","Value mismatch"].forEach(t=>assert.ok(types.has(t),t));
});

test("properties write-back touches only the edited line and appends new keys",()=>{
  const src=fx("env_prd.properties");
  const out=E.applyPropsChanges(src,[{op:"set",key:"database.ods.schema",value:"TIBCO2"},{op:"add",key:"kafka.bootstrap.servers",value:"x:9094"}]);
  const a=src.split("\n"), b=out.split("\n");
  const changed=a.filter((l,i)=>l!==b[i]);
  assert.deepEqual(changed,["database.ods.schema=SYSADM"]);
  assert.ok(out.includes(E.STAMP+"\nkafka.bootstrap.servers=x:9094"));
});

test("YAML write-back keeps indentation, comments and the fluentbit block",()=>{
  const src=fx("commonvalues.yaml");
  const out=E.applyYamlChanges(src,[{op:"set",key:"ods_database_Schema",value:"SYSADM"},
    {op:"set",key:"JAVA_OPTS",value:"-Xms2048m -Xmx2048m"},{op:"add",key:"database_ods_host",value:"10.230.83.46"}],"common.CommonResourcesdata");
  const d=yaml.load(out).common;
  assert.equal(d.CommonResourcesdata.ods_database_Schema,"SYSADM");
  assert.equal(d.CommonResourcesdata.JAVA_OPTS,"-Xms2048m -Xmx2048m");
  assert.equal(d.CommonResourcesdata.database_ods_host,"10.230.83.46");
  assert.equal(d.fluentbitConfigmap.fluentbit,yaml.load(src).common.fluentbitConfigmap.fluentbit);
  assert.ok(out.includes("     ods_database_Schema: SYSADM"));
  assert.ok(out.indexOf("database_ods_host")<out.indexOf("#### Fluentbit"));
});

test("YAML scalars are quoted only when needed",()=>{
  assert.equal(E.yamlScalar("true"),"true");
  assert.equal(E.yamlScalar("1521"),"1521");
  assert.equal(E.yamlScalar("jdbc:oracle:thin:@h:1521:X"),"'jdbc:oracle:thin:@h:1521:X'");
  assert.equal(E.yamlScalar("it's"),"'it''s'");
});

test("JDBC parser understands thin, descriptor and TIBCO DataDirect forms",()=>{
  assert.deepEqual(E.parseJdbc("jdbc:oracle:thin:@10.1.1.1:1521:SID1").sid,"SID1");
  assert.deepEqual(E.parseJdbc("jdbc:oracle:thin:@h:1521/SVC").service,"SVC");
  const t=E.parseJdbc("jdbc:tibcosoftwareinc:oracle://10.0.0.1:1521;ServiceName=ods;AlternateServers=(10.0.0.2:1521,10.0.0.3:1521)");
  assert.deepEqual(t.hosts,["10.0.0.1","10.0.0.2","10.0.0.3"]); assert.equal(t.service,"ods");
});
