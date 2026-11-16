# History and decisions

Built Aug–Sep 2026 in a Claude cloud session, handed off to Claude Code in Nov 2026.

| Version | What | Why it changed |
|---|---|---|
| v1 | Single HTML (React via CDN) comparing a pasted `.properties` and Helm YAML; simple normalized-name + fuzzy matching; JDBC-aware value compare; warnings; exports | — |
| v1.1 | Self-contained build (libs inlined, JSX pre-compiled) | The sandbox — and likely the corporate network — couldn't reach the CDN |
| v2 | Inline edit, take-BW5/take-Spring, add orphans, Changes tab with diff, save via File System Access API | User asked to edit and write the files |
| v3 | Node service (zero deps) + git CLI: workspaces, clone/fetch, branch + commit + push + GitLab MR. **Matching engine v2**: semantic leaf, cluster alignment, composite JDBC groups, IDF value evidence, ambiguity margin + Review queue, learning (synonyms, pattern rules). Group/repo/file picker | User wanted to pick a workspace, pull both repos, auto-branch on edit, smarter matching, and add new settings |
| v3.1 | Network diagnostics (`fetch failed` → DNS/TCP/TLS/API/token steps), proxy + CA file + allow-self-signed | First real run failed: Node's fetch hides the cause and ignores HTTPS_PROXY |
| — | Analysis of how TortoiseGit connects: Git for Windows uses schannel (Windows cert store) + Git Credential Manager. Found bug: server ran git with `GIT_CONFIG_NOSYSTEM=1`, hiding the system config where those are set. `node --use-system-ca` unavailable (user's Node < 22.15); PowerShell export of the Windows store to PEM offered as a workaround | User asked "check how TortoiseGit does it" |
| — | Cloud sandbox was reset; v3 source lost (only the delivered zip survived on the user's side) | Ephemeral container. Since then the build is also saved in the claude.ai project |
| **v4** | **Back to one HTML file, GitLab via REST from the browser.** No Node, no git, no server. Commits with `last_commit_id` (refused if changed meanwhile). Workspaces + learned rules in browser storage, export/import JSON | User: "can't we do it all in one HTML file?" — and the browser already trusts the internal CA, which removes the whole certificate problem |
| v4.1 | **Sign in with GitLab** (OAuth authorization code + PKCE), silent refresh; token mode kept | User asked for username/password. GitLab's API doesn't accept them and has no password grant; OAuth lets them log in with their normal credentials on GitLab's own page |
| v4.2 | Built-in workspace for `tibco/Common-Resources:_build/env_prd.properties` ⇄ `integration-java/helm-template:common/production/common-values.yaml` (master), opens automatically; "paste two GitLab links" | User: these are the two files — "not to choose" |
| v4.2 hand-off | Source tree rebuilt from the delivered HTML and **proven byte-identical** (`scripts/verify-source.js`, `cmp`); redacted fixtures; unit + e2e tests; this repo | Migration to Claude Code |
| **v5** | **VS Code extension.** Reads the two files from the local clones; branch/commit/push through VS Code's built-in Git (same Git + login as TortoiseGit); opens GitLab's new-MR page; paths per environment in VS Code settings, pick-once for unknown paths; Problems panel; click a key → file at that line; Pull latest | User asked to convert the whole thing into a VS Code extension before any other updates. Removes OAuth/token/CORS entirely |
| **v1.0.0** | **First release.** Home page (search, attention list, environments); Variables with every environment side by side; Add variable creates both sides in all environments with twin naming from learned rules; checks + pop-ups for duplicate keys/values, bad names, empty/space values, ports, same server in two environments, twin mismatch, plain-text passwords, invalid YAML; new-key/duplicate-key detection when a file is saved; send dialog with fetch/behind check; one branch, one commit per repo across environments; unsent edits persisted; Latin-1 files kept Latin-1 | User asked for an easier landing page, search/validate/add, auto-twin across environments, pop-ups for mistakes, a design review and a full retest before launch |

## Findings on the real sample files

- 1,257 BW5 keys vs 54 Spring keys (`common.CommonResourcesdata`).
- 13 auto pairs, all correct; ~12 sent to review instead of guessed.
- The three Spring JDBC URLs (`ods_database_URL`, `eai_database_URL`, `databases_engines_trans_url`) point at
  different hosts/SIDs than the BW5 `database.*.host/port/sid` they replace — expected for a test values file vs
  prod properties, but exactly the class of bug the tool exists to catch.
- 7 duplicate keys in the prod properties (the last one silently wins), commented-out BW5 keys that are live on
  the Spring side, values with trailing spaces, plaintext secrets in the values file.

## Dead ends worth not repeating

- Testing with downloaded desktop VS Code: blocked in the cloud sandbox; the code-server standalone build from GitHub works.

- Node service with git CLI: blocked by the internal CA, proxies, old Node, and git config isolation.
- Asking users to paste a token as the only option: works, but they asked for their normal login → OAuth.
- Opening the OAuth flow from `file://`: impossible — GitLab can't redirect back to a file.
