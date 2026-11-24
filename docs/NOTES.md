# Project notes: what the other .md files don't cover

`CLAUDE.md` covers the purpose, constraints, layout, commands and matcher. `README.md` is the user guide, and
`docs/HISTORY.md` covers versions and decisions. This file holds everything else: internals, data shapes, the exact
rules, test-bed tricks, gotchas, open questions and context about the owner.

---

## 1. Where things live

| What | Where |
|---|---|
| Current source (v1.0.0, git repo with 2 commits: "v5.0 baseline", "v1.0.0 …") | cloud sandbox `/home/claude/cmc-vscode` (ephemeral) and the delivered `config-match-catch-1.0.0-source.zip` |
| Installable extension | `dist/config-match-catch.vsix` (delivered as `config-match-catch-1.0.0.vsix`) |
| Context file | Voda project → `claude/CLAUDE.md` (kept in sync with the repo) |
| Older HTML repo hand-off | `config-match-catch-repo.zip` (sent earlier in chat) |
| Test VS Code | code-server 4.145.2 standalone at `/home/claude/cs/code-server-4.145.2-linux-amd64` (sandbox) |
| Test bed | `/home/claude/e2e` (made by `scripts/e2e-setup.sh`) |

The Voda project only stores text, so zips and the `.vsix` cannot be saved there. Keep the copies from the chat.

---

## 2. Extension ⇄ webview protocol

The webview sends `{id, type, payload}` and the host replies `{replyTo: id, ok, result | error}`. Host errors arrive as
`error` strings, which the UI shows in a "That didn't work" dialog.

| type | payload | returns / effect |
|---|---|---|
| `init` | — | `{environments, baseBranch, lastEnv, learned, pending, version}` |
| `loadAll` | `{current}` | `{envs:[EnvLoad], current, baseBranch}`, re-watches every loaded file |
| `setCurrent` | `{env}` | stores last env, updates status bar |
| `pull` | `{current}` | checkout base + pull in every distinct repo, then `loadAll` result + `pulled:[repo names]` |
| `chooseRepo` | `{env, side}` | folder dialog → setting `bw5RepoFolder`/`springRepoFolder` → `loadAll` |
| `setup` | `{current}` | folder dialog → clone each repo not already there (`git clone` with VS Code's git binary) → settings `bw5RepoFolder`/`springRepoFolder` → `loadAll` result + `setup:{folder, repos:[{side, name, folder, cloned}]}` |
| `chooseFile` | `{env, side}` | file dialog inside that repo → saves relative path into the env → `loadAll` |
| `addEnvironment` | — | input box → appends `{name, bw5File:"", springFile:"", springRoot:""}` → `loadAll` |
| `setRoot` | `{env, root}` | saves `springRoot` ("" = auto) |
| `saveLearned` | `{learned}` | `globalState["cmc.learned"]` |
| `savePending` | `{pending}` | `workspaceState["cmc.pending"]` (undefined when empty) |
| `writeFiles` | `{files:[{abs, content}]}` | writes without git; `{written:[{env, side, file}]}` |
| `preflight` | `{files}` | per repo: `git fetch` then `{repo, files:[{env, side, rel}], fetched/fetchError, branch, behind, staged, webUrl}` |
| `propose` | `{files, title, description, label}` | branch + commit + push per repo → `{branch, base, results:[{repo, files, commit, pushed, pushError, mrUrl, backOn, error}]}` |
| `reveal` | `{env, side, key, root}` or `{abs}` | opens file beside, selects the key's line |
| `problems` | `{env, items:{bw5:[{key, sev, msg}], spring:[…]}, root}` | fills the Problems panel (`high`→Error, `med`→Warning, else Info) |
| `confirm` | `{message, yes, detail}` | VS Code modal; true if the `yes` button was pressed |
| `openUrl`, `copy`, `openSettings`, `saveAs {name, text}`, `openJson`, `takeStartCmd` | | small helpers |

Host → webview events: `fileChanged {env, side, abs}`, `config {state}` (settings changed), `switchEnv {env}`,
`reload`, `command {cmd:"addVariable"}`.

The host only writes a file that it loaded (`loaded` map keyed by normalized absolute path) and whose disk content still
equals the loaded text. It also refuses if the file has unsaved edits in an editor.

## 3. Data shapes

- **EnvLoad**: `{env, springRoot, bw5:Side, spring:Side}`; **Side**: `{side, rel, folder, abs, text, encoding,
  git:{root, name, branch, commit, behind, ahead, fileChanged, staged, remote, webUrl}, gitError, error, code}`.
  `code` is `"no-repo"` or `"no-file"`.
- **Change (pending edit)**: `{id, env, side:"bw5"|"spring", op:"set"|"add"|"remove", key, value, from}`. `from` is
  always the value on disk. Re-editing keeps the first `from`, and setting a value back to `from` removes the edit.
  `set` on a pending `add` stays `add`. `remove` exists in the engine (comments the line out) but no button creates it
  yet.
- **Learned dictionary** (`cmc.learned`): `{rules:[{bw5, spring, source:"learned"|"manual", sample, count}],
  synonyms:[{from, to, count}], mappings:[{b, s}], rejected:[{b, s}], ignored:{b:{key:true}, s:{key:true}}}`.
  There is one dictionary per computer, shared by all environments and workspaces.
- **Storage keys**: `globalState`: `cmc.lastEnv`, `cmc.learned`, `cmc.startCmd`. `workspaceState`: `cmc.pending`.
  The webview's own state holds `cmc.opts` (matcher sliders).
- Settings are written to the scope where the value already lives (folder → workspace → user/global).

## 4. How the UI decides things

- **What you see is what will be sent.** Every environment is parsed with its pending edits already applied, and the
  comparison, warnings and counts are computed on that patched text.
- **Analysis cache**: per environment, it is redone only when that environment's text, YAML block, matcher options or
  learned dictionary change. One run takes about 0.2 s on a 1,250-key file.
- **Variables list** row kinds: `pair`, `group` (connection group), `onlyB`, `onlyS`, `missing` (the key exists in
  another environment's file of the same side). Sort order: mismatch, missing here, case/spaces, empty, review,
  only-one-side, encrypted, ok. "Problems" = mismatch, missing, case, whitespace, empty.
- **Home "Needs your attention"** order: duplicate keys → connection-group mismatches and value mismatches → missing
  here and broken `${…}` → case/space/empty. It shows 10, with "See all" for the rest.
- **Search**: case-insensitive substring over both keys and both values. Exact key matches come first. If no key
  matches exactly and the text has no spaces, it offers "Add as new variable". A name with a dot, or without `_`,
  prefills the BW5 name; otherwise it prefills the Spring name.
- **File changed on disk**:
  - If there are pending edits for that file, a banner offers "Reload it" (edits are re-applied).
  - Otherwise it reloads silently, then compares old and new:
    - a new duplicate key raises an error pop-up;
    - 1–5 new keys raise a "Create the twin…" offer that opens the Add dialog with the existing side locked and its
      values carried over;
    - more than 5 new keys are ignored, since that is a pull and not hand typing.
- **Branch label**: the environment name if every edit is in one environment, otherwise `multi-env`. Branch name:
  `config-sync/<label-slug>-YYYYMMDD-HHMMSS` (local time).
- **Auto MR title**: `Config: add|update|change <first 2 keys> +N more (<envs>)`. **Auto description**: a markdown
  table of every edit (env, file, action, key, old, new).
- After a successful push, each repo is checked out back on the base branch, so the app shows `master` again until
  the MR is merged. On a commit error it also tries to go back to base. On a push error it stays on the new branch
  (the commit is there) and tells the user to push from Source Control.

## 5. Validation rules: exact behaviour (`src/checks.js`)

**Names** (errors unless noted):
- empty name;
- spaces;
- non-ASCII characters;
- BW5 names containing `= : \` or starting with `#`/`!`;
- Spring names containing anything other than letters, digits, `_` and `-`, or starting with `-` or `.`;
- a dot in a Spring name (warning only);
- a name longer than 120 characters (warning only).

**New variable**:
- An exact key that exists in any environment is an error ("edit it instead").
- These are warnings:
  - a key that differs only in case or punctuation (`norm` = lowercase with non-alphanumerics removed);
  - the key exists commented out (BW5).
- An environment whose file isn't set up is skipped, shown as info.
- If no target file exists at all, that is an error.

**Values** (all warnings except the newline case):
- empty;
- leading or trailing space;
- TAB;
- a newline (error);
- a port leaf that isn't 1–5 digits;
- an enabled leaf that isn't true/false;
- a Spring password-like key in plain text (not `#!`, not `${…}`);
- an unresolved `${x}`;
- the same non-trivial value used by another key in the same file;
- a value that differs from its twin in the same environment (via `E.compareValues` = mismatch);
- a host-like value equal to another environment's value.

What the value rules treat as "trivial" and "host-like":
- **Trivial** values are never flagged as duplicates: shorter than 6 characters, booleans, or plain numbers.
- **Host-like** means a value of type host, hostport, url or jdbc, or a key whose leaf is host, url, sid or service.

To report each problem once:
- A cross-environment clash is reported only on the later environment (in settings order).
- When the Spring value is a copy of the BW5 value, Spring's space, empty, TAB and same-in-other-env warnings are
  dropped.

**Final check before sending** (`checkPatched`):
- These block sending:
  - the patched YAML must still parse;
  - no key may become duplicated that wasn't before.
- Keys that would disappear are a warning.
- Every pending non-remove edit is re-checked for errors.
- Preflight adds:
  - fetch failed → warning (VPN);
  - behind GitLab → warning;
  - not on the base branch → error;
  - staged files → error.

**Twin naming** (`suggestTwin`):
1. a confirmed mapping;
2. the first learned or manual pattern rule that matches (in either direction);
3. the majority style of the other file's keys (separator `_`, `.` or `-`, and lowercase if most keys have no
   capitals). It falls back to BW5 = `a.b.c` and Spring = `a_b_c`.

It doesn't reorder words, so `database.crm.host` becomes `database_crm_host` until a rule like
`database.{x}.host ⇄ {x}_database_host` is learned from one confirmed pair.

## 6. Encoding and file format details

- Decode as UTF-8. If that produces U+FFFD and the file didn't literally contain the UTF-8 bytes `EF BF BD`, decode
  as Latin-1 instead. Write back with the same encoding (`Buffer.from(text, enc)`). A character that Latin-1 can't
  hold, typed into a Latin-1 file, would be lost. Non-ASCII names are blocked; values only get a low warning.
- CRLF is preserved by the engine (it detects the EOL and joins with it). A BOM is kept as the first character;
  `trim()` and `\s` treat it as whitespace when parsing.
- New BW5 keys are appended at the end under the `# ---- managed by Config Match & Catch ----` stamp. New Spring
  keys go at the end of the chosen YAML block, with the block's indentation.
- Spring values are written with `yamlScalar`. These are quoted: values with special characters
  (`: # { } [ ] , & * ? | < > = ! % @` and quotes), leading or trailing spaces, empty values, and `null`/`yes`/`no`/
  `on`/`off`/`~`/`-`. Booleans and numbers are written bare.
- Multi-line values (BW5 `\` continuations, YAML block scalars) are read correctly. An edit replaces the whole span
  with a single line.

## 7. Test bed tricks (`scripts/e2e-setup.sh`) and test gotchas

- **Fake GitLab without a server**: bare repos at `$E/remote/tibco/Common-Resources.git` and
  `$E/remote/integration-java/helm-template.git`, plus
  `git config --global url."file://$E/remote/".insteadOf "https://git.vf-eg.internal.vodafone.com/"`.
  The clones keep the real https URL as `origin`, so the MR link generated in tests is the real GitLab address.
  *This changes the sandbox's global git config. Don't run it on a real machine.*
- **Testing fixture**: the production fixtures with `10.230.` replaced by `10.99.`, `jms.jndiuser` deleted, and one
  Latin-1 line `company.name=Vodafone \xC9gypte`. Paths `_build/env_tst.properties` and
  `common/testing/common-values.yaml` are guesses; the real Testing paths are unknown.
- **Settings for the test**: Production + Testing with paths, and Staging empty. Workspace trust and AI chat are
  off.
- Desktop VS Code downloads are blocked in the sandbox (`update.code.visualstudio.com` 403). The code-server npm
  package needs Node 24 and native builds, which fail. **Use the standalone tarball from GitHub releases** (bundles
  its own Node).
- Use the preinstalled `require("playwright")`. The repo's `playwright-core` dev dependency wants a different browser
  build. Override with `PW_MODULE`.
- The webview sits two iframes deep: `frameLocator("iframe.webview.ready").frameLocator("iframe#active-frame")`.
- Expected code-server prompts:
  - "Do you want code-server to open the external website?" (the MR page, once per repo) → the test clicks Cancel;
  - "periodically run git fetch?" (ignored).
- To close the panel, use the command palette "View: Close All Editors". The editor tab's close-button selector
  wasn't reliable.
- Never `pkill -f` a pattern that also matches the shell command running it. An earlier setup killed itself (exit
  144). The script now matches `--bind-addr 127.0.0.1:8080 --user-data-dir $E/ud`.
- Editing a value so it differs from its twin opens a confirm pop-up. Tests use `editCell()`, which accepts it.
- `xxd` isn't installed in the sandbox. Check bytes with Node `Buffer`.

## 8. Known limitations and risks (v1.0.0)

- **Never run on Windows or the real GitLab.** Unverified there:
  - VS Code finding both clones by folder name;
  - push credentials through Git Credential Manager;
  - the MR page URL on the real host;
  - Latin-1 detection on the real files;
  - Windows path case handling (paths are lowercased for comparison on win32/darwin).
- Real Testing paths are unknown. The Testing environment ships empty.
- A connection group (BW5 host/port/sid ⇄ one Spring JDBC URL) can't be created as a twin. The Add dialog makes
  one key per side.
- No "remove variable" button.
- No UI for adding to the ignore list. Old ignores are still honoured, and "restore" exists on the Rules tab.
- Learned rules live on one computer. Team sharing is export/import JSON only.
- `preflight` needs the VPN, since it runs `git fetch`. Without it there's a warning, not a block; the push then
  fails with a clear message and the commit stays on its branch.
- If two people edit the same file between load and send, the second is refused ("changed on disk, Reload").
  There's no merge.
- Pull switches every repo to `master` and pulls. A repo with uncommitted work on another branch makes the pull fail
  (by design, with a message).
- Minimum VS Code 1.80. It activates on startup and depends on the built-in `vscode.git` extension.

## 9. Security notes

- The user's company Python clone script contained **two hard-coded GitLab personal access tokens**. He was told to
  revoke and rotate them. Never copy that script or its tokens anywhere.
- Fixtures are redacted excerpts: fake passwords (`redacted_*`, `#!FAKE…`). Never commit real env files.
- The extension never sees credentials. Git uses the user's own credential manager.
- The user's email is private. Don't put it in commits, files or requests to outside services.

## 10. Real-data facts worth remembering

- The real production BW5 file has about 1,970 lines and 1,257 keys; the Spring block has 54 keys.
- Seven duplicate keys exist in the real prod properties (the last one wins), for example `cms.rv.network.dr.1`.
- The three Spring JDBC URLs (`ods_database_URL`, `eai_database_URL`, `databases_engines_trans_url`) point at
  different hosts or SIDs than the BW5 `database.*` keys. This was the first real bug class found.
- TIBCO `#!` values are reversible obfuscation, not encryption. They are shown as "encrypted, can't compare".

## 11. Open questions for the owner

1. The real Testing (and any other environment) file paths in both repos.
2. Is `master` the right base branch for both repos, and do MRs need a specific target or approvers?
3. Should new variables also go into environments whose files aren't set up yet? (Today they're skipped and later
   shown as "missing".)
4. Should the learned naming rules be shared in a file in git, so the whole team gets the same twin names?

## 12. About the owner and how to work with him

- Moataz, integration team, Vodafone Egypt. Windows laptop, corporate VPN, TortoiseGit, Python, old Node. Says
  "domain" for a TIBCO domain/application.
- Wants **exactly what he asked for, in plain words**. He got frustrated when given more than he asked (a full repo
  when he wanted only a context text) and with long option lists. He doesn't like being asked clarifying questions
  when a sensible default exists. Explain steps very simply ("I don't understand step 2" happened once).
- Planned first launch to the team: **2026-11-17**.
