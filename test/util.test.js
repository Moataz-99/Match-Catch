"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const U=require("../extension/util.js");
const fs=require("fs"), path=require("path");
const fx=f=>fs.readFileSync(path.join(__dirname,"fixtures",f),"utf8");

test("git remote → GitLab web address",()=>{
  assert.equal(U.remoteToWebUrl("https://git.vf-eg.internal.vodafone.com/tibco/Common-Resources.git"),"https://git.vf-eg.internal.vodafone.com/tibco/Common-Resources");
  assert.equal(U.remoteToWebUrl("https://moataz@git.vf-eg.internal.vodafone.com/integration-java/helm-template.git"),"https://git.vf-eg.internal.vodafone.com/integration-java/helm-template");
  assert.equal(U.remoteToWebUrl("git@git.vf-eg.internal.vodafone.com:tibco/Common-Resources.git"),"https://git.vf-eg.internal.vodafone.com/tibco/Common-Resources");
  assert.equal(U.remoteToWebUrl("ssh://git@git.vf-eg.internal.vodafone.com:2222/a/b/c.git"),"https://git.vf-eg.internal.vodafone.com/a/b/c");
  assert.equal(U.remoteToWebUrl("/some/local/path"),"");
});
test("merge request link",()=>{
  const u=U.newMergeRequestUrl("https://g/x/y","config-sync/p-1","master","Fix it");
  assert.ok(u.startsWith("https://g/x/y/-/merge_requests/new?"));
  const q=new URL(u).searchParams;
  assert.equal(q.get("merge_request[source_branch]"),"config-sync/p-1");
  assert.equal(q.get("merge_request[target_branch]"),"master");
  assert.equal(q.get("merge_request[title]"),"Fix it");
});
test("branch name",()=>{
  assert.equal(U.branchName("Production",new Date(2026,10,16,9,5,7)),"config-sync/production-20261116-090507");
  assert.equal(U.branchName("Pre-Prod / DR!",new Date(2026,0,1)),"config-sync/pre-prod-dr-20260101-000000");
});
test("finds the line of a .properties key",()=>{
  const t=fx("env_prd.properties"), lines=t.split(/\r?\n/);
  const i=U.findPropsLine(t,"jms.jndiuser");
  assert.ok(i>=0 && lines[i].startsWith("jms.jndiuser="));
  assert.equal(U.findPropsLine(t,"jms.jndi"),-1);        // prefix of another key is not a hit
});
test("finds the line of a YAML key under the block",()=>{
  const t=fx("commonvalues.yaml"), lines=t.split(/\r?\n/);
  const i=U.findYamlLine(t,"jms_jndi_user","common.CommonResourcesdata");
  assert.ok(i>=0 && /^\s+jms_jndi_user:/.test(lines[i]), lines[i]);
  assert.equal(U.findYamlLine(t,"no_such_key","common.CommonResourcesdata"),-1);
});
test("repo folder name matching is loose",()=>{
  assert.ok(U.nameMatches("C:\\work\\common_resources","Common-Resources"));
  assert.ok(U.nameMatches("/x/CommonResources","Common-Resources"));
  assert.ok(!U.nameMatches("/x/Common-Resources-old","Common-Resources"));
});
test("encoding: UTF-8 stays UTF-8, Latin-1 is detected and round-trips byte for byte",()=>{
  const u=Buffer.from("a=Égypte\n","utf8"); assert.deepEqual(U.decode(u),{text:"a=Égypte\n",enc:"utf8"});
  const l=Buffer.from([0x61,0x3d,0xC9,0x67,0x0a]);           // "a=Ég\n" in ISO-8859-1
  const d=U.decode(l); assert.equal(d.enc,"latin1"); assert.equal(d.text,"a=Ég\n");
  assert.ok(Buffer.from(d.text,d.enc).equals(l));
  assert.equal(U.decode(Buffer.from("plain=ascii\n")).enc,"utf8");
});
test("clone URL and folder name from the GitLab address + project",()=>{
  assert.equal(U.cloneUrl("https://git.vf-eg.internal.vodafone.com/","/tibco/Common-Resources"),"https://git.vf-eg.internal.vodafone.com/tibco/Common-Resources.git");
  assert.equal(U.cloneUrl("git.example.com","integration-java/helm-template.git"),"https://git.example.com/integration-java/helm-template.git");
  assert.equal(U.cloneUrl("","a/b"),""); assert.equal(U.cloneUrl("https://h",""),"");
  assert.equal(U.cloneFolderName("integration-java/helm-template"),"helm-template");
  assert.equal(U.cloneFolderName("tibco/Common-Resources.git"),"Common-Resources");
});
