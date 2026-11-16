# CLAUDE.md — Config Match & Catch (VS Code extension)

Context for Claude Code. Read this first; `docs/HISTORY.md` has the why behind every decision; `docs/NOTES.md` has
internals, data shapes, exact rules, test-bed tricks, gotchas and open questions.

## What this is

A VS Code extension (v1.0.0) for the TIBCO BW5 → Java Spring Boot migration at Vodafone Egypt (integration team; owner:
Moataz). BW5 apps read settings from a `.properties` file; migrated Spring Boot apps read theirs from a Helm values
YAML. Developers mistype or forget values when a setting is added to one side only. The extension reads both files
from the repos already cloned on the developer's computer, matches the keys even when they are named nothing alike
(`database.ods.host` vs `ods_database_URL`), shows every disagreement (also in the Problems panel), validates every edit and every new variable, creates a
new variable on **both sides in every environment** at once, and sends fixes as a **new branch + commit + push** per
repository, then opens GitLab's "new merge request" page. It never commits to `master`.

Deliverable: `dist/config-match-catch.vsix` (install: Extensions → `…` → Install from VSIX).

## The real files

| Side | GitLab project (cloned locally) | Branch | File (setting `configMatch.environments`) |
|---|---|---|---|
| BW5 | `tibco/Common-Resources` | `master` | `_build/env_prd.properties` |
| Spring | `integration-java/helm-template` | `master` | `common/production/common-values.yaml` |

GitLab: `https://git.vf-eg.internal.vodafone.com` (VPN only). Spring properties sit under YAML block
`common.CommonResourcesdata` (auto-detected). Testing paths are not known yet — the "Testing" environment ships
with empty paths; the user picks each file once and it is saved into settings. Environments are a list in settings;
all of them are loaded at once (the app compares them with each other: "missing here").

## Hard constraints (each one learned the hard way)

1. **No GitLab API, no tokens, no Node/Python network code.** The GitLab certificate comes from an internal CA that
   Node and Python don't trust. All git work goes through **VS Code's built-in Git extension API** (`vscode.git`,
   `getAPI(1)`: createBranch, add, commit, push, checkout, pull), which runs the user's Git for Windows with the same
   certificate store and credential manager as TortoiseGit.
2. **Never commit to the base branch** (`configMatch.baseBranch`, default master). propose(): check every repo is on
   base with nothing staged → `createBranch(config-sync/<env>-<timestamp>, checkout)` → write → add → commit → push
   (set upstream) → `checkout(base)` again → open `<web>/-/merge_requests/new?…` (web URL derived from the origin
   remote in `extension/util.js`). Push failure keeps the commit on the branch and says so.
3. **Never overwrite someone else's edit.** Before writing, the file on disk must equal what was loaded and must not
   be dirty in an editor; otherwise "Reload, then redo the edit".
4. **Surgical write-back** (engine `applyPropsChanges` / `applyYamlChanges`): only edited lines change; comments,
   order, indentation, CRLF stay. New keys go under `# ---- managed by Config Match & Catch ----`.
5. **Webview rules**: strict CSP with a per-load nonce (build puts `__NONCE__`/`__CSP_SOURCE__` placeholders);
   everything inlined, no CDN; `window.confirm/alert` are blocked in webviews → use `ask()` (host shows a modal);
   links → `host.call("openUrl")`; files → host dialogs (`saveAs`, `openJson`).
6. **Plain language** in every message: say what to do next (check the VPN, press Reload, pick the file…).
7. **Every write is checked first** (`src/checks.js`): errors block, warnings ask in a pop-up (`confirmIssues`), the
   send dialog re-runs all checks + `checkPatched` on every file + a git fetch (behind / wrong branch / staged).
8. **Encoding**: files are decoded as UTF-8 if valid, else Latin-1 (`util.decode`), and written back in the same
   encoding — TIBCO .properties files are often ISO-8859-1.

## Layout

```
extension/extension.js   host: settings, finding the repos, loadAll (every environment), watch, write, preflight
                         (fetch/behind), propose (branch/commit/push per repo, back to base), pull, pick repo/file once,
                         add environment, reveal key, Problems panel, sidebar tree, pending edits in workspaceState.
                         Webview protocol: request {id,type,payload} → reply {replyTo,ok,result|error}
extension/util.js        pure helpers (decode, remote → web URL, MR link, branch name, key line in .properties/YAML)
src/engine.js            matching engine — plain JS, zero deps
src/checks.js            all validation: suggestTwin, checkName, checkValue, checkNewVariable, checkEdit, checkPatched,
                         missingVsOtherEnvs (UMD: window.CMChecks / require("./checks")(engine))
src/ui/01-platform.jsx   host bridge, ask(), pop-ups (DialogHost, showDialog, confirmIssues, IssueList), small components
src/ui/03-app.jsx        <App>: all environments parsed with pending edits applied (what you see = what will be sent),
                         per-env analysis cache, edits (validated), add variable, file-changed handling, send
src/ui/04-tabs.jsx       Files, Comparison, Groups, Review, Only-in-X, Warnings, Rules, Changes
src/ui/05-home.jsx       Home (search, attention list, environments), Variables (+ env grid), Add-variable dialog
src/ui/09-main.jsx       render
scripts/build.js         → dist/webview.html (React, ReactDOM, js-yaml, engine, checks, compiled JSX inlined)
scripts/e2e-setup.sh     test bed: bare "GitLab" repos (Production + Testing files, Latin-1 line), clones, settings with
                         Production/Testing/Staging, code-server with the .vsix installed
test/*.test.js           engine, util, checks (node:test)       test/support/smoke.js  webview in Chromium, fake host
test/vscode.e2e.js       44 checks in real VS Code with real git (see the file for the list)
```

## Commands

```bash
npm install
npm test                 # engine + util + checks unit tests (30)
npm run smoke            # build + webview in Chromium with a fake host (fast, catches runtime errors)
npm run package          # build + dist/config-match-catch.vsix
CODE_SERVER=/path/to/code-server/bin/code-server ./scripts/e2e-setup.sh   # prints the command for:
npm run test:vscode      # the real-VS-Code test (needs the env vars the setup script prints)
```
Run all three after any change. code-server standalone: github.com/coder/code-server/releases (linux-amd64 tarball).

## Settings (contributes.configuration)

`configMatch.environments` [{name, bw5File, springFile, springRoot}] · `bw5RepoFolder` / `springRepoFolder` (empty =
find among open folders and VS Code's git repos by name `bw5RepoName`/`springRepoName`, then by the file existing) ·
`baseBranch` · `openMergeRequestPage` · `showProblems`. Learned rules are in `globalState` (`cmc.learned`), shared by all
environments; export/import JSON on the Rules tab.

## How the matcher works (src/engine.js → `analyze`)

0. **parse** `.properties` (continuations, comments, duplicates, commented-out keys) and YAML (flatten one block);
   resolve `${ref}` inside each file.
1. **enrich** each key: tokens (camelCase split, synonym table `BASE_SYN`, noise words dropped), a *semantic leaf*
   (host/port/user/password/url/sid/…), a *namespace* (tokens minus leaf), a value type
   (jdbc/host/port/bool/queue/secret/…), value fingerprints.
2. **anchors**: confirmed mappings → pattern rules → identical keys → normalized keys (loose, then token-set).
3. **cluster alignment**: match key groups (`database.ods.*` ⇄ `ods_database_*`) by namespace similarity + votes
   from anchors.
3b. **composite pairs**: a Spring JDBC/URL key vs the BW5 host/port/sid/service keys of the aligned group —
   checked part by part ("Connection groups" tab). This is where the real migration bugs showed up.
4. **value evidence** weighted by IDF (a shared rare value like an IP is strong evidence; `1521` is nearly none).
5. **score**: weighted blend (token Jaccard, bigram Dice, namespace, cluster, leaf, value, type) with hard
   penalties for conflicting leaves (port vs enabled) or types.
6. **assign** best-first, auto-accept only above `autoThreshold` (0.70) **and** clear of the runner-up by
   `margin` (0.07); otherwise → **Review** queue with reasons and alternatives.
7. **compare** values: exact/numeric/boolean/case/whitespace, `#!` TIBCO-obfuscated = "encrypted" (not a
   mismatch), JDBC-aware (host/port/service/sid, thin + descriptor + TIBCO DataDirect `AlternateServers`).
8. **learn**: confirming a pair stores the mapping, derives word synonyms (`loginuser`→`user`) and a pattern rule
   (`database.{x}.password ⇄ {x}_database_password`). Rejections are remembered. Stored per workspace.

Expected results on the fixtures are pinned in `test/engine.test.js` (12 pairs: 5 mismatch / 4 encrypted / 3 ok,
3 connection groups all mismatching, 5 in review). On the real files (1,257 BW5 keys vs 54 Spring keys) the
earlier measurement was 13 auto pairs, all correct, 3 connection groups, ~12 to review.

## Status and next ideas

- v1.0.0, 2026-11-16: 30 unit tests + 44 real-VS-Code checks pass (code-server 4.145 / VS Code 1.145, Linux).
  **Not yet run on the user's Windows laptop against the real GitLab** — first launch is the first real run.
- Comparison takes ~0.2 s per environment on a 1,250-key file; cached per environment.
- Ideas not built: shared rules file in git (team-wide learning), promotion report, CI check reusing `src/engine.js`
  + `src/checks.js` headless, ignore list UI for BW5 keys that will never move, JDBC URL ⇄ host/port/sid twin creation.

## Working with the user

Windows laptop on VPN, TortoiseGit, has Python, Node is old. Prefers short, plain-language answers and concrete
next steps over options. Says "domain" for a TIBCO domain/application. Built and iterated with Claude in a
cloud session; this repo is the hand-off to Claude Code.
