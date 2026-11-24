"use strict";
/* Config Match & Catch — VS Code extension host.
   Reads the config files of every environment from the two repos on this computer ("Choose work folder" clones them
   if they aren't there yet) and uses VS Code's own Git (the same git + credentials the user already has, like
   TortoiseGit) to clone, branch, commit and push.
   No GitLab API, no tokens. */
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const U = require("./util");

const SIDES = ["bw5", "spring"];
const LABEL = { bw5: "BW5", spring: "Spring" };
let panel = null;
let ctx = null;
let diagnostics = null;
let watchers = [];
let statusItem = null;
let tree = null;
/** every file the webview has seen: key = normalized absolute path → { abs, text, env, side } */
const loaded = new Map();
const keyOf = abs => (process.platform === "win32" || process.platform === "darwin") ? path.resolve(abs).toLowerCase() : path.resolve(abs);
const byEnv = {};               // env -> side -> abs (last load)

/* TIBCO .properties files are often ISO-8859-1. Read them as UTF-8 when they are valid UTF-8, otherwise as Latin-1,
   and always write a file back in the encoding it was read with, so no accented character is ever corrupted. */
function readText(abs) { return U.decode(fs.readFileSync(abs)); }
const readNow = abs => { try { return readText(abs).text; } catch (e) { return null; } };
function writeText(l, text) { fs.writeFileSync(l.abs, Buffer.from(text, l.enc || "utf8")); }

/* ------------------------------------------------------------ settings */
const cfg = () => vscode.workspace.getConfiguration("configMatch");
function environments() {
  const list = cfg().get("environments") || [];
  return Array.isArray(list) ? list.filter(e => e && e.name) : [];
}
function getEnv(name) { const l = environments(); return l.find(e => e.name === name) || null; }
function settingTarget(key) {
  const i = cfg().inspect(key) || {};
  if (i.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder;
  if (i.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace;
  return vscode.ConfigurationTarget.Global;
}
async function updateSetting(key, value) { await cfg().update(key, value, settingTarget(key)); }
async function updateEnv(name, patch) {
  const list = environments().map(e => e.name === name ? Object.assign({}, e, patch) : e);
  await updateSetting("environments", list);
}
const base = () => cfg().get("baseBranch") || "master";

/* ------------------------------------------------------------ git (VS Code's built-in Git extension) */
let gitApi = null;
async function git() {
  if (gitApi) return gitApi;
  const ext = vscode.extensions.getExtension("vscode.git");
  if (!ext) throw new Error("VS Code's Git support is not available. Make sure Git is installed and the built-in Git extension is enabled.");
  const exp = ext.isActive ? ext.exports : await ext.activate();
  if (exp.enabled === false) throw new Error("Git is turned off in VS Code (setting git.enabled). Turn it on and try again.");
  const api = exp.getAPI(1);
  if (api.state !== "initialized" && api.onDidChangeState) {
    await new Promise(res => { const d = api.onDidChangeState(s => { if (s === "initialized") { d.dispose(); res(); } }); setTimeout(res, 4000); });
  }
  gitApi = api;
  return api;
}
async function repoFor(folder) {
  const api = await git();
  const uri = vscode.Uri.file(folder);
  let repo = api.getRepository(uri);
  if (!repo && api.openRepository) repo = await api.openRepository(uri);
  if (!repo) throw new Error("“" + folder + "” is not a git repository. Point the setting at the folder you cloned.");
  return repo;
}
function repoInfo(repo, abs) {
  const st = repo.state || {};
  const head = st.HEAD || {};
  const changed = l => (l || []).some(c => U.samePath(c.uri.fsPath, abs));
  const remote = (st.remotes || []).find(r => r.name === "origin") || (st.remotes || [])[0] || null;
  return {
    root: repo.rootUri.fsPath, name: path.basename(repo.rootUri.fsPath), branch: head.name || "(detached)", commit: (head.commit || "").slice(0, 8),
    behind: head.behind || 0, ahead: head.ahead || 0,
    fileChanged: changed(st.workingTreeChanges) || changed(st.indexChanges),
    staged: (st.indexChanges || []).length,
    remote: remote ? remote.name : "", webUrl: remote ? U.remoteToWebUrl(remote.fetchUrl || remote.pushUrl) : ""
  };
}
const gitErr = e => String((e && (e.stderr || e.message)) || e || "").trim();

/* ------------------------------------------------------------ finding the repos */
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
async function candidateFolders() {
  const out = [];
  (vscode.workspace.workspaceFolders || []).forEach(f => out.push(f.uri.fsPath));
  try { (await git()).repositories.forEach(r => out.push(r.rootUri.fsPath)); } catch (e) { /* git missing: folders only */ }
  const seen = new Set(); return out.filter(p => { const k = keyOf(p); if (seen.has(k)) return false; seen.add(k); return true; });
}
/** where is the BW5 (or Spring) repo on this computer? setting → open folder with the right name → open folder containing the file */
async function resolveRepo(side, env) {
  const key = side === "bw5" ? "bw5RepoFolder" : "springRepoFolder";
  const set = String(cfg().get(key) || "").trim();
  if (set) return isDir(set) ? { folder: set, how: "setting" } : { error: "The folder in the setting does not exist: " + set, code: "no-repo" };
  const wanted = cfg().get(side === "bw5" ? "bw5RepoName" : "springRepoName");
  const rel = env && env[side + "File"];
  const cands = await candidateFolders();
  const byName = cands.find(f => U.nameMatches(f, wanted));
  if (byName) return { folder: byName, how: "name" };
  if (rel) { const byFile = cands.find(f => isFile(path.join(f, rel))); if (byFile) return { folder: byFile, how: "file" }; }
  return { error: "Couldn't find the " + (wanted || LABEL[side]) + " repository. Open its folder in VS Code, or choose where you cloned it.", code: "no-repo" };
}

/* ------------------------------------------------------------ load */
async function loadOne(env) {
  const out = { env: env.name, springRoot: env.springRoot || "" };
  byEnv[env.name] = {};
  for (const side of SIDES) {
    const r = await resolveRepo(side, env);
    const rel = String(env[side + "File"] || "").replace(/^[\\/]+/, "");
    const o = { side, rel, folder: r.folder || "" };
    out[side] = o;
    if (r.error) { o.error = r.error; o.code = r.code; continue; }
    if (!rel) { o.error = "No " + LABEL[side] + " file chosen for “" + env.name + "” yet."; o.code = "no-file"; continue; }
    o.abs = path.join(r.folder, rel);
    let rt;
    try { rt = readText(o.abs); o.text = rt.text; o.encoding = rt.enc; }
    catch (e) { o.error = "File not found: " + rel + " in " + r.folder + ". Pull the repo, or pick the right file."; o.code = "no-file"; continue; }
    loaded.set(keyOf(o.abs), { abs: o.abs, text: o.text, enc: rt.enc, env: env.name, side });
    byEnv[env.name][side] = o.abs;
    try { const repo = await repoFor(r.folder); await repo.status().catch(() => {}); o.git = repoInfo(repo, o.abs); }
    catch (e) { o.gitError = e.message; }
  }
  return out;
}
async function loadAll(current) {
  const envs = environments();
  if (!envs.length) throw new Error("No environments are set up. Add one in Settings → Config Match → Environments.");
  loaded.clear();
  const list = [];
  for (const env of envs) list.push(await loadOne(env));
  let cur = current || ctx.globalState.get("cmc.lastEnv") || envs[0].name;
  if (!envs.some(e => e.name === cur)) cur = envs[0].name;
  watch(Array.from(loaded.values()).map(x => x.abs));
  updateStatus(cur);
  if (tree) tree.refresh();
  return { envs: list, current: cur, baseBranch: base() };
}
function watch(files) {
  watchers.forEach(w => w.dispose()); watchers = [];
  files.forEach(abs => {
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(abs)), path.basename(abs)));
    let t = null;
    const fire = () => { clearTimeout(t); t = setTimeout(() => {
      const l = loaded.get(keyOf(abs)); if (!l) return;
      const now = readNow(abs);
      if (now !== l.text) post({ type: "fileChanged", env: l.env, side: l.side, abs: l.abs });
    }, 300); };
    w.onDidChange(fire); w.onDidCreate(fire); w.onDidDelete(fire);
    watchers.push(w);
  });
}

/* ------------------------------------------------------------ write / branch / commit / push */
/** files: [{abs, content}] — only files the webview loaded may be written, and only if nobody changed them since */
function checkFiles(files) {
  const list = (files || []).filter(f => f && typeof f.content === "string");
  if (!list.length) throw new Error("Nothing to send — no file has changes.");
  list.forEach(f => {
    const l = loaded.get(keyOf(f.abs));
    if (!l) throw new Error("Refusing to write a file that wasn't loaded: " + f.abs);
    const doc = vscode.workspace.textDocuments.find(d => U.samePath(d.uri.fsPath, l.abs));
    const what = l.env + " " + LABEL[l.side] + " file (" + path.basename(l.abs) + ")";
    if (doc && doc.isDirty) throw new Error("The " + what + " has unsaved edits open in the editor. Save or close it first.");
    if (readNow(l.abs) !== l.text) throw new Error("The " + what + " changed on disk after it was loaded. Press Reload, then check your edits.");
    f.l = l;
  });
  return list.filter(f => f.content !== f.l.text);
}
async function writeFiles(p) {
  const list = checkFiles(p.files);
  list.forEach(f => { writeText(f.l, f.content); f.l.text = f.content; });
  return { written: list.map(f => ({ env: f.l.env, side: f.l.side, file: f.l.abs })) };
}
async function groupByRepo(list) {
  const groups = [];
  for (const f of list) {
    const repo = await repoFor(path.dirname(f.l.abs));
    let g = groups.find(x => U.samePath(x.repo.rootUri.fsPath, repo.rootUri.fsPath));
    if (!g) { g = { repo, files: [] }; groups.push(g); }
    g.files.push(f);
  }
  return groups;
}
/** what will happen if we send: which repos, on which branch, behind GitLab or not. Fetches first (needs the VPN). */
async function preflight(p) {
  const list = checkFiles(p.files);
  const groups = await groupByRepo(list);
  const out = [];
  for (const g of groups) {
    const r = { repo: path.basename(g.repo.rootUri.fsPath), files: g.files.map(f => ({ env: f.l.env, side: f.l.side, rel: path.relative(g.repo.rootUri.fsPath, f.l.abs).split(path.sep).join("/") })) };
    try { await g.repo.fetch(); r.fetched = true; } catch (e) { r.fetchError = gitErr(e); }
    await g.repo.status().catch(() => {});
    const info = repoInfo(g.repo, g.files[0].l.abs);
    Object.assign(r, { branch: info.branch, behind: info.behind, staged: info.staged, webUrl: info.webUrl });
    out.push(r);
  }
  return { base: base(), repos: out };
}
async function propose(p) {
  const list = checkFiles(p.files);
  if (!list.length) throw new Error("Nothing to send — no file differs from what is on disk.");
  const b = base();
  const branch = U.branchName(p.label || "config");
  const title = String(p.title || "Config sync").trim();
  const message = title + (p.description ? "\n\n" + p.description : "");
  const groups = await groupByRepo(list);
  // check every repo before touching any of them
  for (const g of groups) {
    await g.repo.status().catch(() => {});
    const st = g.repo.state, name = path.basename(g.repo.rootUri.fsPath);
    const head = st.HEAD && st.HEAD.name;
    if (head !== b) throw new Error(name + " is on branch “" + (head || "detached") + "”, not “" + b + "”. Press “Pull latest” (it switches back to " + b + "), then send again.");
    if ((st.indexChanges || []).length) throw new Error(name + " has staged changes. Commit or unstage them first, so they don't end up in this commit.");
  }
  const results = [];
  for (const g of groups) {
    const repo = g.repo, name = path.basename(repo.rootUri.fsPath);
    const r = { repo: name, files: g.files.map(f => ({ env: f.l.env, side: f.l.side })), branch };
    try {
      await repo.createBranch(branch, true);
      g.files.forEach(f => { writeText(f.l, f.content); });
      await repo.add(g.files.map(f => f.l.abs));
      await repo.commit(message);
      await repo.status().catch(() => {});
      r.commit = ((repo.state.HEAD || {}).commit || "").slice(0, 8);
      const info = repoInfo(repo, g.files[0].l.abs);
      try {
        await repo.push(info.remote || "origin", branch, true);
        r.pushed = true;
        r.mrUrl = U.newMergeRequestUrl(info.webUrl, branch, b, title);
        try { await repo.checkout(b); r.backOn = b; } catch (e) { r.backOn = ""; r.checkoutError = gitErr(e); }
      } catch (e) {
        r.pushError = "Committed on branch " + branch + " but the push failed: " + gitErr(e) + " — check the VPN, then push it from the Source Control view.";
      }
    } catch (e) {
      r.error = gitErr(e);
      try { await repo.checkout(b); } catch (x) { /* stay where we are */ }
    }
    results.push(r);
  }
  // remember what is on disk now (base branch again after a successful push)
  list.forEach(f => { const t = readNow(f.l.abs); if (t != null) f.l.text = t; });
  if (results.some(r => r.mrUrl) && cfg().get("openMergeRequestPage")) {
    results.filter(r => r.mrUrl).forEach(r => vscode.env.openExternal(vscode.Uri.parse(r.mrUrl)));
  }
  return { branch, base: b, results };
}

async function pullLatest(p) {
  const b = base();
  const done = [];
  for (const env of environments()) for (const side of SIDES) {
    const r = await resolveRepo(side, env);
    if (r.error) continue;
    const repo = await repoFor(r.folder);
    if (done.some(x => U.samePath(x, repo.rootUri.fsPath))) continue;
    done.push(repo.rootUri.fsPath);
    const name = path.basename(repo.rootUri.fsPath);
    await repo.status().catch(() => {});
    const head = repo.state.HEAD && repo.state.HEAD.name;
    try {
      if (head !== b) await repo.checkout(b);
      await repo.pull();
    } catch (e) {
      throw new Error("Could not update " + name + ": " + gitErr(e) +
        (head !== b ? " (it was on branch “" + head + "”; commit or stash your changes there first)" : "") +
        " — if this is a network error, check the VPN.");
    }
  }
  const res = await loadAll(p && p.current);
  res.pulled = done.map(d => path.basename(d));
  return res;
}

/* ------------------------------------------------------------ one step: pick a folder → both repos cloned there */
/** the GitLab project of each side, its clone URL and the folder name git gives it */
function repoDef(side) {
  const project = String(cfg().get(side === "bw5" ? "bw5RepoPath" : "springRepoPath") || "").trim();
  return { project, url: U.cloneUrl(cfg().get("gitlabUrl"), project), name: U.cloneFolderName(project) || cfg().get(side === "bw5" ? "bw5RepoName" : "springRepoName") };
}
const isRepo = p => isDir(path.join(p, ".git")) || isFile(path.join(p, ".git"));
/** clone with the git that VS Code's Git uses (same program, certificates and login as TortoiseGit). Not api.clone():
    that one hands back an existing clone VS Code already knows instead of cloning into the chosen folder. */
async function cloneRepo(parent, d) {
  const api = await git();
  const target = path.join(parent, d.name);
  const hint = " Check that the VPN is on and that you can open " + d.url.replace(/\.git$/, "") + " in the browser.";
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Cloning " + d.project + " into " + parent + "…", cancellable: true },
    (progress, token) => new Promise((res, rej) => {
      const cp = require("child_process").execFile((api.git && api.git.path) || "git", ["clone", d.url, target],
        { env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: "0" }), maxBuffer: 1 << 24, windowsHide: true },
        (e, so, se) => {
          if (token.isCancellationRequested) return rej(new Error("Cloning " + d.project + " was cancelled."));
          if (!e) return res();
          const why = (String(se || "").match(/^(fatal|error):.*$/m) || [String(se || e.message).trim()])[0];
          rej(new Error("Couldn't clone " + d.project + ": " + why + "." + hint));
        });
      token.onCancellationRequested(() => cp.kill());
    }));
  if (!isRepo(target)) throw new Error("Cloning " + d.project + " didn't create " + target + "." + hint);
  return target;
}
/** Ask for one folder, clone whichever of the two repos isn't there yet, remember both folders, load everything. */
async function setupWorkFolder(p) {
  let parent = p && p.folder;
  if (!parent) {
    const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      openLabel: "Use this folder", title: "Pick a folder to work in — both repositories are cloned into it (or used, if already there)" });
    if (!pick || !pick[0]) return { cancelled: true };
    parent = pick[0].fsPath;
  }
  // picked one of the two repos itself → work in the folder around it
  if (isRepo(parent) && SIDES.some(s => U.nameMatches(parent, repoDef(s).name))) parent = path.dirname(parent);
  const repos = [];
  for (const side of SIDES) {
    const d = repoDef(side);
    if (!d.url) throw new Error("The GitLab address or the " + LABEL[side] + " project path is empty. Fill them in under Settings → Config Match.");
    const target = path.join(parent, d.name);
    let folder = target, cloned = false;
    if (!isRepo(target)) {
      if (isDir(target) && fs.readdirSync(target).length) throw new Error("“" + target + "” already exists but is not a git repository. Rename or empty it, then try again.");
      folder = await cloneRepo(parent, d); cloned = true;
    }
    await updateSetting(side === "bw5" ? "bw5RepoFolder" : "springRepoFolder", folder);
    repos.push({ side, name: path.basename(folder), folder, cloned });
  }
  const res = await loadAll(p && p.current);
  res.setup = { folder: parent, repos };
  return res;
}
const setupSummary = s => s.repos.map(r => r.name + (r.cloned ? " cloned" : " found")).join(", ") + " in " + s.folder;
/** command / sidebar / first-run prompt: set up, then open the app on the loaded files */
async function setupCommand(folder) {
  try {
    const r = await setupWorkFolder({ folder: typeof folder === "string" ? folder : undefined });
    if (r.cancelled) return;
    if (panel) post({ type: "reload" }); else openPanel();
    vscode.window.showInformationMessage("Config Match is ready: " + setupSummary(r.setup) + ".");
  } catch (e) { vscode.window.showErrorMessage(gitErr(e) || String(e)); }
}
/** on start-up: if the repos can't be found, offer the one-step setup */
async function offerSetup() {
  const env = environments()[0];
  if (!env) return;
  const found = await Promise.all(SIDES.map(s => resolveRepo(s, env)));
  if (!found.some(r => r.error)) return;
  const go = "Choose a folder…";
  const b = await vscode.window.showInformationMessage("Config Match: pick one folder to work in. Common-Resources and helm-template will be cloned there (or used, if already there) and opened.", go, "Not now");
  if (b === go) setupCommand();
}

/* ------------------------------------------------------------ choosing folders and files once */
async function chooseRepo(p) {
  const side = p.side;
  const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
    openLabel: "Use this folder", title: "Where is the " + LABEL[side] + " repository cloned?" });
  if (!pick || !pick[0]) return { cancelled: true };
  await updateSetting(side === "bw5" ? "bw5RepoFolder" : "springRepoFolder", pick[0].fsPath);
  return loadAll(p.env);
}
async function chooseFile(p) {
  const env = getEnv(p.env); const side = p.side;
  if (!env) throw new Error("Unknown environment " + p.env);
  const r = await resolveRepo(side, env);
  if (r.error) throw new Error(r.error);
  const pick = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
    defaultUri: vscode.Uri.file(r.folder), openLabel: "Use this file", title: LABEL[side] + " file for “" + env.name + "”",
    filters: side === "bw5" ? { "Properties": ["properties", "conf", "cfg", "txt"] } : { "YAML": ["yaml", "yml"] } });
  if (!pick || !pick[0]) return { cancelled: true };
  const rel = path.relative(r.folder, pick[0].fsPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("That file is outside the " + LABEL[side] + " repository (" + r.folder + ").");
  await updateEnv(env.name, { [side + "File"]: rel.split(path.sep).join("/") });
  return loadAll(env.name);
}
async function addEnvironment() {
  const name = await vscode.window.showInputBox({ title: "New environment", prompt: "Name, e.g. UAT",
    validateInput: v => !v.trim() ? "Enter a name" : environments().some(e => e.name.toLowerCase() === v.trim().toLowerCase()) ? "That name exists already" : null });
  if (!name) return { cancelled: true };
  await updateSetting("environments", environments().concat([{ name: name.trim(), bw5File: "", springFile: "", springRoot: "" }]));
  return loadAll(name.trim());
}

/* ------------------------------------------------------------ navigation + problems */
function lineOf(abs, side, key, root) {
  const l = loaded.get(keyOf(abs)); if (!l) return -1;
  return side === "bw5" ? U.findPropsLine(l.text, key) : U.findYamlLine(l.text, key, root);
}
async function reveal(p) {
  const abs = p.abs || ((byEnv[p.env] || {})[p.side]);
  if (!abs) throw new Error("That file isn't loaded.");
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
  const line = p.key ? lineOf(abs, p.side, p.key, p.root) : -1;
  const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  if (line >= 0) {
    const range = doc.lineAt(line).range;
    ed.selection = new vscode.Selection(range.start, range.end);
    ed.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }
  return { line };
}
function setProblems(p) {
  diagnostics.clear();
  if (!cfg().get("showProblems")) return { count: 0 };
  let count = 0;
  SIDES.forEach(side => {
    const abs = (byEnv[p.env] || {})[side]; if (!abs) return;
    const l = loaded.get(keyOf(abs)); if (!l) return;
    const lines = l.text.split(/\r?\n/);
    const list = ((p.items || {})[side] || []).map(it => {
      const line = lineOf(abs, side, it.key, p.root);
      if (line < 0) return null;
      const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, (lines[line] || "").length), it.msg,
        it.sev === "high" ? vscode.DiagnosticSeverity.Error : it.sev === "med" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      d.source = "Config Match";
      return d;
    }).filter(Boolean);
    count += list.length;
    diagnostics.set(vscode.Uri.file(abs), list);
  });
  if (statusItem) statusItem.tooltip = count ? count + " problem(s) in " + p.env : "No problems in " + p.env;
  return { count };
}

/* ------------------------------------------------------------ webview */
function post(msg) { if (panel) panel.webview.postMessage(msg); }
function stateForUi() {
  return {
    environments: environments().map(e => ({ name: e.name, bw5File: e.bw5File || "", springFile: e.springFile || "", springRoot: e.springRoot || "" })),
    baseBranch: base(),
    lastEnv: ctx.globalState.get("cmc.lastEnv") || "",
    learned: ctx.globalState.get("cmc.learned") || null,
    pending: ctx.workspaceState.get("cmc.pending") || null,
    version: ctx.extension && ctx.extension.packageJSON ? ctx.extension.packageJSON.version : ""
  };
}
const handlers = {
  init: async () => stateForUi(),
  loadAll: p => loadAll(p.current),
  setCurrent: async p => { await ctx.globalState.update("cmc.lastEnv", p.env); updateStatus(p.env); return true; },
  pull: p => pullLatest(p),
  chooseRepo: p => chooseRepo(p),
  setup: p => setupWorkFolder(p),
  chooseFile: p => chooseFile(p),
  addEnvironment: () => addEnvironment(),
  setRoot: async p => { await updateEnv(p.env, { springRoot: p.root || "" }); return true; },
  saveLearned: async p => { await ctx.globalState.update("cmc.learned", p.learned); return true; },
  savePending: async p => { await ctx.workspaceState.update("cmc.pending", p.pending && p.pending.length ? p.pending : undefined); return true; },
  writeFiles: p => writeFiles(p),
  preflight: p => preflight(p),
  propose: p => propose(p),
  reveal: p => reveal(p),
  problems: async p => setProblems(p),
  confirm: async p => (await vscode.window.showWarningMessage(String(p.message || "Continue?"), { modal: true, detail: p.detail || undefined }, String(p.yes || "Continue"))) === String(p.yes || "Continue"),
  openUrl: async p => { await vscode.env.openExternal(vscode.Uri.parse(p.url)); return true; },
  copy: async p => { await vscode.env.clipboard.writeText(String(p.text || "")); return true; },
  openSettings: async () => { await vscode.commands.executeCommand("workbench.action.openSettings", "configMatch"); return true; },
  takeStartCmd: async () => { const c = ctx.globalState.get("cmc.startCmd") || ""; await ctx.globalState.update("cmc.startCmd", undefined); return c; },
  saveAs: async p => {
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(require("os").homedir(), p.name || "export.txt")) });
    if (!uri) return { cancelled: true };
    fs.writeFileSync(uri.fsPath, String(p.text || "")); return { file: uri.fsPath };
  },
  openJson: async () => {
    const pick = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ["json"] } });
    if (!pick || !pick[0]) return { cancelled: true };
    return { text: fs.readFileSync(pick[0].fsPath, "utf8") };
  }
};
async function onMessage(m) {
  if (!m || !m.type) return;
  const h = handlers[m.type];
  if (!h) return post({ replyTo: m.id, ok: false, error: "Unknown request " + m.type });
  try { post({ replyTo: m.id, ok: true, result: await h(m.payload || {}) }); }
  catch (e) { post({ replyTo: m.id, ok: false, error: gitErr(e) || String(e) }); }
}

function html(webview) {
  const file = path.join(ctx.extensionPath, "dist", "webview.html");
  const nonce = require("crypto").randomBytes(16).toString("base64");
  return fs.readFileSync(file, "utf8").replace(/__NONCE__/g, () => nonce).replace(/__CSP_SOURCE__/g, () => webview.cspSource);
}
function openPanel(envName, cmd) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    if (envName) post({ type: "switchEnv", env: envName });
    if (cmd) post({ type: "command", cmd });
    return panel;
  }
  if (envName) ctx.globalState.update("cmc.lastEnv", envName);
  if (cmd) ctx.globalState.update("cmc.startCmd", cmd);
  panel = vscode.window.createWebviewPanel("configMatch", "Config Match & Catch", vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
  panel.iconPath = vscode.Uri.file(path.join(ctx.extensionPath, "media", "icon.png"));
  panel.webview.html = html(panel.webview);
  panel.webview.onDidReceiveMessage(onMessage);
  panel.onDidDispose(() => { panel = null; diagnostics.clear(); });
  return panel;
}
function updateStatus(envName) {
  if (!statusItem) return;
  statusItem.text = "$(git-compare) Config Match" + (envName ? ": " + envName : "");
  statusItem.show();
}

/* ------------------------------------------------------------ sidebar */
class EnvTree {
  constructor() { this._em = new vscode.EventEmitter(); this.onDidChangeTreeData = this._em.event; }
  refresh() { this._em.fire(); }
  getTreeItem(e) { return e; }
  getChildren() {
    const item = (label, icon, command, args, desc, tip) => {
      const t = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      t.iconPath = new vscode.ThemeIcon(icon); t.command = { command, title: label, arguments: args || [] };
      if (desc) t.description = desc; if (tip) t.tooltip = tip; return t;
    };
    const envs = environments().map(e => item(e.name, "server-environment", "configMatch.open", [e.name],
      (e.bw5File && e.springFile) ? "" : "files not chosen yet", "BW5: " + (e.bw5File || "—") + "\nSpring: " + (e.springFile || "—")));
    return [item("Open Config Match", "home", "configMatch.open"), item("Add a variable…", "add", "configMatch.addVariable")]
      .concat(envs, [item("Choose work folder (clones both repos)…", "repo-clone", "configMatch.setup"),
        item("Edit paths and environments…", "gear", "configMatch.settings")]);
  }
}

function activate(context) {
  ctx = context;
  diagnostics = vscode.languages.createDiagnosticCollection("configMatch");
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = "configMatch.open";
  updateStatus("");
  tree = new EnvTree();
  context.subscriptions.push(
    diagnostics, statusItem,
    vscode.window.registerTreeDataProvider("configMatch.environments", tree),
    vscode.commands.registerCommand("configMatch.open", env => openPanel(typeof env === "string" ? env : undefined)),
    vscode.commands.registerCommand("configMatch.addVariable", () => openPanel(undefined, "addVariable")),
    vscode.commands.registerCommand("configMatch.reload", () => { openPanel(); post({ type: "reload" }); }),
    vscode.commands.registerCommand("configMatch.settings", () => handlers.openSettings()),
    vscode.commands.registerCommand("configMatch.setup", folder => setupCommand(folder)),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration("configMatch")) { tree.refresh(); post({ type: "config", state: stateForUi() }); } }),
    { dispose: () => watchers.forEach(w => w.dispose()) }
  );
  setTimeout(() => offerSetup().catch(() => {}), 1500);
}
function deactivate() {}

module.exports = { activate, deactivate, _test: { handlers, loaded } };
