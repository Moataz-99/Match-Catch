// Drives the installed extension inside real VS Code (code-server) with real git repos.
// Set up with scripts/e2e-setup.sh (it prints the exact command). Environments: Production, Testing (one key missing,
// other hosts), Staging (no files yet). Remote = local bare repos behind the real GitLab address (git insteadOf).
"use strict";
const { chromium } = require(process.env.PW_MODULE || "playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const yaml = require("js-yaml");
const URL = process.env.CMC_URL, REMOTE = process.env.CMC_REMOTE, WORK = process.env.CMC_WORK, SETTINGS = process.env.CMC_SETTINGS;
const SHOTS = process.env.CMC_SHOTS || __dirname + "/shots";
let failed = 0, passed = 0;
const ok = (cond, name, extra) => { console.log((cond ? "PASS " : "FAIL ") + name + (extra ? "  — " + String(extra).replace(/\s+/g, " ").slice(0, 180) : "")); if (cond) passed++; else failed++; };
const sh = c => execSync(c, { encoding: "utf8" });
const remote = (repo, cmd) => sh("git --git-dir=" + REMOTE + "/" + repo + " " + cmd);
const CR = "tibco/Common-Resources.git", HT = "integration-java/helm-template.git";

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const shot = n => page.screenshot({ path: SHOTS + "/" + n + ".png" });
  const wait = ms => page.waitForTimeout(ms);
  const app = page.frameLocator("iframe.webview.ready").frameLocator("iframe#active-frame");
  const tab = async name => { await app.locator(".tabs .tab", { hasText: new RegExp("^" + name) }).first().click(); await wait(400); };
  const modal = app.locator(".modal-back .modal");
  const vsDialog = page.locator(".monaco-dialog-box");
  const dismissVs = async (btn) => { await vsDialog.waitFor({ timeout: 8000 }).catch(() => {}); if (await vsDialog.count()) await vsDialog.locator("a.monaco-button", { hasText: btn }).first().click(); await wait(300); };
  /** edit a value cell; if the app pops up a warning, accept it ("Save anyway") and return its text */
  const editCell = async (cell, value) => {
    await cell.locator("button.pen").click(); await cell.locator("textarea").fill(value); await cell.locator("textarea").press("Enter");
    await wait(700);
    if (await modal.count()) { const t = await modal.innerText(); await modal.locator("button", { hasText: "Save anyway" }).click(); await wait(400); return t; }
    return "";
  };
  const homeSearch = async t => { await tab("Home"); await app.locator(".searchbox").fill(t); await wait(400); };

  await page.goto(URL);
  await page.waitForSelector(".monaco-workbench", { timeout: 60000 });
  await wait(5000);

  /* 1. sidebar */
  await page.locator('.action-item a[aria-label="Config Match"]').click();
  await wait(1500);
  const tree = (await page.locator(".monaco-list-row").allInnerTexts()).join(" | ");
  ok(/Add a variable/.test(tree) && /Production/.test(tree) && /Testing/.test(tree) && /Staging.*files not chosen yet/.test(tree), "sidebar: add-variable + 3 environments", tree);
  await page.locator('.monaco-list-row:has-text("Production")').first().click();
  await app.locator(".hero").waitFor({ timeout: 30000 });
  await wait(2500);

  /* 2. home page */
  const stats = await app.locator(".stat .n").allInnerTexts();
  ok(stats.length === 4, "home: 4 headline numbers", stats.join(","));
  const att = await app.locator(".att").allInnerTexts();
  ok(att.some(t => /DUPLICATE KEY/.test(t) && /cms\.rv\.network\.dr\.1/.test(t)), "home: duplicate key is in 'Needs your attention'");
  ok(att.some(t => /GROUP/.test(t)) && att.some(t => /MISMATCH/.test(t)), "home: groups and mismatches listed");
  const envCards = (await app.locator(".envcard").allInnerTexts()).join(" | ");
  ok(/Testing[\s\S]*1 missing/.test(envCards) && /Staging[\s\S]*files not set up/.test(envCards), "home: environment cards (Testing 1 missing, Staging not set up)", envCards);
  await shot("01-home");
  const status = await page.locator('.statusbar-item[id="status.problems"]').innerText();
  ok(/[1-9]/.test(status), "Problems panel filled", status);

  /* 3. search */
  await homeSearch("jndiuser");
  const res = await app.locator(".res").allInnerTexts();
  ok(res.length >= 1 && /jms\.jndiuser/.test(res[0]) && /jms_jndi_user/.test(res[0]), "search finds both sides", res[0]);
  await homeSearch("10.230.85.205");
  ok((await app.locator(".res").allInnerTexts()).some(t => /jms_jndi_contextUrl/.test(t)), "search by value");
  await homeSearch("brand.new.key");
  ok((await app.locator(".res", { hasText: "Add “brand.new.key”" }).count()) === 1, "search offers to add an unknown name");
  await shot("02-search");

  /* 4. open a variable: the grid of all environments */
  await homeSearch("jndiuser");
  await app.locator(".res").first().click();
  await wait(800);
  const grid = await app.locator(".envtable").first().innerText();
  ok(/Production[\s\S]*CLE[\s\S]*CSMService/.test(grid) && /Testing[\s\S]*missing[\s\S]*add here/.test(grid) && /Staging[\s\S]*file not set up/.test(grid), "variable shows every environment, missing one marked", grid);
  await shot("03-variable");

  /* 5. a wrong edit pops up; cancel keeps nothing */
  const springCell = app.locator(".envtable tbody tr", { hasText: "Production" }).locator("td").nth(2);
  await springCell.locator("button.pen").click();
  await springCell.locator("textarea").fill("   ");
  await springCell.locator("textarea").press("Enter");
  await modal.waitFor({ timeout: 5000 });
  const mtext = await modal.innerText();
  ok(/Save jms_jndi_user in Production\?/.test(mtext) && /starts or ends with a space|empty/.test(mtext), "pop-up warns about a bad value", mtext);
  await shot("04-popup-bad-value");
  await modal.locator("button", { hasText: "Go back and fix" }).click();
  await wait(300);
  ok((await app.locator(".tabs .tab", { hasText: /^Changes/ }).innerText()).includes("0"), "cancelled edit is not queued");
  // a good edit goes through without a pop-up
  await springCell.locator("button.pen").click();
  await springCell.locator("textarea").fill("CLE");
  await springCell.locator("textarea").press("Enter");
  await wait(500);
  ok((await modal.count()) === 0 && (await app.locator(".tabs .tab", { hasText: /^Changes/ }).innerText()).includes("1"), "good edit queued without a pop-up");

  /* 6. add the key where it is missing (Testing BW5) */
  const tRow = app.locator(".envtable tbody tr", { hasText: "Testing" });
  await tRow.locator("button", { hasText: "add here" }).click();
  await tRow.locator("input").fill("CLE_T");
  await tRow.locator("button", { hasText: /^Add$/ }).click();
  await wait(500);
  ok((await app.locator(".tabs .tab", { hasText: /^Changes/ }).innerText()).includes("2"), "added the missing key in Testing");

  /* 7. add a new variable: twin name, duplicate-name block, cross-environment warning */
  await homeSearch("crm.service.url");
  await app.locator(".searchbox").press("Enter");
  const dlg = app.locator('[aria-label="Add a variable"]');
  await dlg.waitFor({ timeout: 5000 });
  const sName = await dlg.locator("input.inp").nth(1).inputValue();
  ok(sName === "crm_service_url", "twin name suggested automatically", sName);
  await dlg.locator("input.inp").first().fill("jms.jndicontexturl");
  await wait(300);
  ok(/already exists in Production/.test(await dlg.innerText()) && await dlg.locator(".modal-f .btn").last().isDisabled(), "duplicate key name is blocked");
  await shot("05-add-duplicate-blocked");
  await dlg.locator("input.inp").first().fill("crm.service.url");
  await dlg.locator('[aria-label="Production bw5 value"]').fill("http://crm-prd:8080");
  await dlg.locator('[aria-label="Testing bw5 value"]').fill("http://crm-prd:8080");
  await wait(300);
  const dtext = await dlg.innerText();
  ok(/same value is used in Production/.test(dtext), "warns when two environments get the same server", "");
  ok(/Staging · BW5: file not set up yet — skipped/.test(dtext), "says Staging is skipped");
  await shot("06-add-warning");
  await dlg.locator('[aria-label="Testing bw5 value"]').fill("http://crm-tst:8080");
  await wait(300);
  ok(/Looks good — 4 file\(s\)/.test(await dlg.innerText()), "clean values: ready for 4 files");
  await dlg.locator(".modal-f .btn").last().click();
  await wait(600);
  ok((await app.locator(".tabs .tab", { hasText: /^Changes/ }).innerText()).includes("6"), "new variable queued in 4 files (6 edits total)");

  /* 8. send: one check-and-send dialog, then branch + commit + push in both repos */
  await tab("Changes");
  await shot("07-changes");
  await app.locator("button", { hasText: "Check & send" }).click();
  await modal.waitFor({ timeout: 30000 });
  const stext = await modal.innerText();
  ok(/Send 6 change\(s\)\?/.test(stext) && /Common-Resources/.test(stext) && /helm-template/.test(stext) && /All checks passed/.test(stext), "send dialog shows both repos and all checks passed", stext);
  await shot("08-send-dialog");
  await modal.locator("button", { hasText: "Create branch, commit & push" }).click();
  await app.locator(".banner.good").waitFor({ timeout: 60000 });
  await dismissVs("Cancel"); await dismissVs("Cancel");          // the two "open GitLab merge request page" prompts
  await shot("09-pushed");
  const banner = await app.locator(".banner.good").innerText();
  ok((banner.match(/pushed/g) || []).length === 2, "both repositories pushed", banner);
  const brCR = remote(CR, "branch --list 'config-sync/*'").replace(/[*\s]/g, ""), brHT = remote(HT, "branch --list 'config-sync/*'").replace(/[*\s]/g, "");
  ok(/^config-sync\/multi-env-\d{8}-\d{6}$/.test(brCR) && brCR === brHT, "same branch name in both repos", brCR);
  const show = (repo, ref, f) => remote(repo, "show " + ref + ":" + f);
  const prdB = show(CR, brCR, "_build/env_prd.properties"), tstB = show(CR, brCR, "_build/env_tst.properties");
  ok(/^crm\.service\.url=http:\/\/crm-prd:8080$/m.test(prdB) && /^crm\.service\.url=http:\/\/crm-tst:8080$/m.test(tstB), "BW5: new key with its own value per environment");
  ok(/^jms\.jndiuser=CLE_T$/m.test(tstB), "BW5 Testing: the missing key was added");
  const raw = execSync("git --git-dir=" + REMOTE + "/" + CR + " show " + brCR + ":_build/env_tst.properties");
  ok(raw.includes(Buffer.from([0x20, 0xC9, 0x67])) && !raw.includes(Buffer.from([0xC3, 0x89])), "Latin-1 file written back in Latin-1 (É kept as one byte)");
  const prdS = yaml.load(show(HT, brHT, "common/production/common-values.yaml")), tstS = yaml.load(show(HT, brHT, "common/testing/common-values.yaml"));
  const blk = d => d.common.CommonResourcesdata;
  ok(blk(prdS).crm_service_url === "http://crm-prd:8080" && blk(tstS).crm_service_url === "http://crm-tst:8080", "Spring: twin added in both environments, valid YAML");
  ok(blk(prdS).jms_jndi_user === "CLE", "Spring Production: edited value");
  ok(remote(CR, "diff --stat master " + brCR).includes("2 files changed") && remote(HT, "diff --stat master " + brHT).includes("2 files changed"), "one commit per repo with both environment files");
  ok(!/crm\.service\.url/.test(show(CR, "master", "_build/env_prd.properties")) && /jms_jndi_user: CSMService/.test(show(HT, "master", "common/production/common-values.yaml")), "master untouched");
  ok(sh("git -C " + WORK + "/Common-Resources branch --show-current").trim() === "master" && sh("git -C " + WORK + "/helm-template branch --show-current").trim() === "master", "working copies back on master");
  ok((await app.locator(".tabs .tab", { hasText: /^Changes/ }).innerText()).includes("0"), "nothing left to send");

  /* 9. editing the file by hand: new key → offer to create the twin; duplicate key → alert */
  const prdFile = WORK + "/Common-Resources/_build/env_prd.properties";
  const original = fs.readFileSync(prdFile, "utf8");
  fs.writeFileSync(prdFile, original + "\nnew.disk.key=abc\n");
  await modal.waitFor({ timeout: 10000 });
  const nk = await modal.innerText();
  ok(/New key in Production BW5/.test(nk) && /new\.disk\.key/.test(nk), "pop-up: new key typed in the file", nk);
  await shot("10-popup-new-key");
  await modal.locator("button", { hasText: "Create the twin" }).click();
  await wait(600);
  const twin = app.locator('[aria-label="Add a variable"]');
  ok((await twin.count()) === 1 && (await twin.locator("input.inp").nth(1).inputValue()) === "new_disk_key", "twin dialog opens with the Spring name", await twin.locator("input.inp").nth(1).inputValue().catch(() => ""));
  await shot("10b-twin-dialog");
  const twinVals = await twin.locator(".envtable").innerText() + " " + (await twin.locator(".envtable input").evaluateAll(l => l.map(i => i.value).join(" ")));
  ok(/abc/.test(twinVals), "twin dialog carries the existing value", twinVals);
  await twin.locator(".modal-f .btn", { hasText: "Cancel" }).click();
  await wait(300);
  fs.writeFileSync(prdFile, original + "\nenv.suffix=222\n");
  await modal.waitFor({ timeout: 10000 });
  const dk = await modal.innerText();
  ok(/Duplicate key in Production BW5/.test(dk) && /env\.suffix/.test(dk), "pop-up: duplicate key saved in the file", dk);
  await shot("11-popup-duplicate");
  await modal.locator("button", { hasText: "OK" }).click();
  sh("git -C " + WORK + "/Common-Resources checkout -- _build/env_prd.properties");
  await wait(1500);

  /* 10. unsent edits survive closing the panel */
  await homeSearch("jndiuser");
  await app.locator(".res").first().click(); await wait(600);
  const pc = app.locator(".envtable tbody tr", { hasText: "Production" }).locator("td").nth(1);
  const warnTwin = await editCell(pc, "CLE2");
  ok(/differs from its twin jms_jndi_user/.test(warnTwin), "pop-up: value would differ from its Spring twin", warnTwin);
  await wait(800);
  await page.keyboard.press("F1"); await page.keyboard.type("View: Close All Editors"); await wait(700); await page.keyboard.press("Enter");
  await wait(1500);
  await page.keyboard.press("F1"); await page.keyboard.type("Config Match: Open Config Match"); await wait(700); await page.keyboard.press("Enter");
  await app.locator(".hero").waitFor({ timeout: 30000 }); await wait(2000);
  ok((await app.locator(".tabs .tab", { hasText: /^Changes/ }).innerText()).includes("1"), "unsent edit restored after closing and reopening");
  await tab("Changes");
  await app.locator("button", { hasText: "discard all" }).click();
  await dismissVs("Discard");
  ok((await app.locator(".tabs .tab", { hasText: /^Changes/ }).innerText()).includes("0"), "discard all asks first, then clears");

  /* 11. a colleague pushes → the send check warns "behind"; Pull latest fixes it and keeps edits */
  const tmp = WORK + "/../colleague";
  sh(`rm -rf ${tmp} && git clone -q https://git.vf-eg.internal.vodafone.com/tibco/Common-Resources.git ${tmp} && cd ${tmp} && sed -i 's/^env.suffix=.*/env.suffix=999/' _build/env_prd.properties && git commit -qam colleague && git push -q origin master`);
  await homeSearch("jndiuser"); await app.locator(".res").first().click(); await wait(600);
  await editCell(pc, "CLE3");
  await tab("Changes");
  await app.locator("button", { hasText: "Check & send" }).click();
  await modal.waitFor({ timeout: 30000 });
  const bt = await modal.innerText();
  ok(/1 commit\(s\) behind GitLab/.test(bt), "send check warns: behind GitLab", bt);
  await shot("12-behind");
  await modal.locator("button", { hasText: "Cancel" }).click();
  await tab("Home");
  await app.locator("button", { hasText: "Pull latest" }).click();
  await wait(5000);
  ok(/env\.suffix=999/.test(fs.readFileSync(prdFile, "utf8")), "Pull latest brought in the colleague's commit");
  ok((await app.locator(".tabs .tab", { hasText: /^Changes/ }).innerText()).includes("1"), "pending edit kept through the pull");
  await tab("Changes"); await app.locator("button", { hasText: "discard all" }).click(); await dismissVs("Discard");

  /* 12. Staging: pick the file once, saved in settings */
  await app.locator(".envbtn", { hasText: "Staging" }).click(); await wait(800);
  await tab("Files");
  const stCard = app.locator(".card", { hasText: "Staging" }).filter({ has: app.locator("h3", { hasText: /^Staging/ }) });
  await stCard.locator("button", { hasText: "Pick the file" }).first().click();
  await wait(1500);
  await page.locator(".quick-input-widget input").fill(WORK + "/Common-Resources/_build/env_tst.properties");
  await wait(500); await page.keyboard.press("Enter"); await wait(3000);
  const st = (JSON.parse(fs.readFileSync(SETTINGS, "utf8"))["configMatch.environments"] || []).find(e => e.name === "Staging") || {};
  ok(st.bw5File === "_build/env_tst.properties", "Staging path saved in settings", JSON.stringify(st));
  await shot("13-files");

  /* 13. every tab renders in every environment without errors */
  let tabsOk = true;
  for (const env of ["Production", "Testing", "Staging"]) {
    await app.locator(".envbtn", { hasText: env }).click(); await wait(500);
    for (const t of ["Home", "Variables", "Review", "Connection groups", "Warnings", "Changes", "Files", "Rules", "Comparison", "Only in BW5", "Only in Spring"]) {
      await tab(t);
      if (!(await app.locator(".main").count())) { tabsOk = false; console.log("  blank:", env, t); }
    }
  }
  ok(tabsOk, "all 11 tabs render in all 3 environments");

  /* 14. one-step setup: repos not found → pick one empty folder → both repos cloned there, saved, loaded */
  const FRESH = require("path").join(require("path").dirname(WORK), "fresh");
  fs.mkdirSync(FRESH, { recursive: true });
  const userSettings = () => JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  const setupBtn = app.locator("button", { hasText: "clone both" });
  // point both sides at a folder, then delete it: "the repos aren't on this computer"
  const GONE = FRESH + "/gone"; fs.mkdirSync(GONE, { recursive: true });
  await app.locator(".envbtn", { hasText: "Production" }).click(); await wait(500);
  for (const i of [0, 1]) {
    await tab("Files");
    const prodCard = app.locator(".card").filter({ has: app.locator("h3", { hasText: /^Production/ }) });
    await prodCard.locator("button", { hasText: "Change repository" }).nth(i).click(); await wait(1500);
    await page.locator(".quick-input-widget input").fill(GONE); await wait(500); await page.keyboard.press("Enter"); await wait(2500);
  }
  fs.rmSync(GONE, { recursive: true });
  await tab("Files"); await app.locator("button", { hasText: "Reload" }).first().click(); await wait(2500);
  await tab("Home");
  ok(await setupBtn.count() === 1, "Home offers to clone both repos when they aren't found");
  await shot("14-not-found");
  await setupBtn.click(); await wait(1500);
  await page.locator(".quick-input-widget input").fill(FRESH);
  await wait(500); await page.keyboard.press("Enter");
  let s = {};
  for (let i = 0; i < 60; i++) { await wait(500); s = userSettings(); if (s["configMatch.springRepoFolder"] === FRESH + "/helm-template") break; }
  await wait(2500);
  ok(fs.existsSync(FRESH + "/Common-Resources/.git") && fs.existsSync(FRESH + "/helm-template/.git"), "both repos cloned into the chosen folder");
  ok(s["configMatch.bw5RepoFolder"] === FRESH + "/Common-Resources" && s["configMatch.springRepoFolder"] === FRESH + "/helm-template",
    "both clone folders saved in settings", JSON.stringify([s["configMatch.bw5RepoFolder"], s["configMatch.springRepoFolder"]]));
  ok(/cloned/.test(await app.locator("body").innerText()), "app says the repos were cloned");
  ok(await setupBtn.count() === 0 && (await app.locator(".stats").count()) > 0, "files loaded from the new clones (numbers on Home)");
  await tab("Files");
  ok((await app.locator(".main").innerText()).includes(FRESH + "/Common-Resources"), "Files tab reads from the new clone");
  await shot("15-cloned");
  // same folder again from the command palette: nothing is cloned twice
  await page.keyboard.press("F1"); await page.keyboard.type("Config Match: Choose work folder"); await wait(700); await page.keyboard.press("Enter");
  await wait(1500);
  await page.locator(".quick-input-widget input").fill(FRESH);
  await wait(500); await page.keyboard.press("Enter"); await wait(4000);
  const toast = await page.locator(".notifications-toasts").innerText().catch(() => "");
  ok(/Common-Resources found, helm-template found/.test(toast), "second time: existing clones are reused, not cloned again", toast);

  await browser.close();
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
