// Fast check of the webview in plain Chromium with a stand-in VS Code host (no git). Catches runtime errors.
"use strict";
const { chromium } = require(process.env.PW_MODULE||"playwright");
const fs = require("fs"), path = require("path");
const fx = f => fs.readFileSync(path.join(__dirname, "..", "fixtures", f), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "..", "dist", "webview.html"), "utf8")
  .replace(/__NONCE__/g, "n").replace(/__CSP_SOURCE__/g, "'self'");
const tst = fx("env_prd.properties").replace(/10\.230\.83\.46/g, "10.1.1.46").replace(/^jms\.jndiuser=.*$/m, "");
const envs = { envs: [
  { env: "Production", springRoot: "", bw5: { rel: "_build/env_prd.properties", abs: "/r/prd.properties", text: fx("env_prd.properties"), folder: "/r" }, spring: { rel: "common/production/common-values.yaml", abs: "/r/prd.yaml", text: fx("commonvalues.yaml"), folder: "/s" } },
  { env: "Testing", springRoot: "", bw5: { rel: "_build/env_tst.properties", abs: "/r/tst.properties", text: tst, folder: "/r" }, spring: { rel: "common/testing/common-values.yaml", abs: "/r/tst.yaml", text: fx("commonvalues.yaml"), folder: "/s" } },
  { env: "Staging", springRoot: "", bw5: { rel: "", folder: "/r", error: "No BW5 file chosen", code: "no-file" }, spring: { rel: "", folder: "/s", error: "No Spring file chosen", code: "no-file" } }],
  current: "Production", baseBranch: "master" };
const mock = `window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage:m=>{
  const R={init:{environments:[],baseBranch:"master",learned:null,pending:null},loadAll:${JSON.stringify(envs)},takeStartCmd:"",problems:{count:0},savePending:true,saveLearned:true,setCurrent:true,reveal:{line:1}};
  window.__calls=(window.__calls||[]).concat([m]);
  setTimeout(()=>window.postMessage({replyTo:m.id,ok:true,result:R[m.type]!==undefined?R[m.type]:true},"*"),5);}});`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await p.setContent(html.replace("<head>", "<head><script>" + mock + "</script>"));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: "/tmp/claude-0/-home-claude/9947c3cb-bae6-554c-bc31-21d43f381c7e/scratchpad/smoke-home.png" });
  await p.fill(".searchbox", "jndi"); await p.waitForTimeout(300);
  await p.screenshot({ path: "/tmp/claude-0/-home-claude/9947c3cb-bae6-554c-bc31-21d43f381c7e/scratchpad/smoke-search.png" });
  await p.fill(".searchbox", "crm.service.url"); await p.waitForTimeout(200); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  await p.locator('[aria-label="Production bw5 value"]').fill("http://crm-prd:8080 "); await p.locator('[aria-label="Testing bw5 value"]').fill("http://crm-prd:8080");
  await p.waitForTimeout(200);
  await p.screenshot({ path: "/tmp/claude-0/-home-claude/9947c3cb-bae6-554c-bc31-21d43f381c7e/scratchpad/smoke-add.png" });
  console.log("issues:", (await p.locator(".modal .issue").allInnerTexts()).join(" || "));
  await p.locator(".modal-f .btn").last().click(); await p.locator(".modal-f .btn").last().click(); await p.waitForTimeout(300);
  await p.locator(".tab", { hasText: "Changes" }).click(); await p.waitForTimeout(300);
  console.log("changes rows:", await p.locator(".main table tbody tr").count());
  await p.screenshot({ path: "/tmp/claude-0/-home-claude/9947c3cb-bae6-554c-bc31-21d43f381c7e/scratchpad/smoke-changes.png", fullPage: true });
  await p.locator(".envbtn", { hasText: "Testing" }).click(); await p.locator(".tab", { hasText: "Home" }).click(); await p.waitForTimeout(300);
  await p.screenshot({ path: "/tmp/claude-0/-home-claude/9947c3cb-bae6-554c-bc31-21d43f381c7e/scratchpad/smoke-testing.png" });
  for (const t of ["Variables", "Review", "Connection groups", "Warnings", "Files", "Rules", "Comparison", "Only in BW5", "Only in Spring"]) { await p.locator(".tab", { hasText: t }).first().click(); await p.waitForTimeout(150); }
  console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "no errors");
  await b.close();
})();
