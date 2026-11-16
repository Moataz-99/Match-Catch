# Config Match & Catch

Keeps the TIBCO BW5 `.properties` files and the Spring Boot Helm values files in agreement, in every environment,
during the BW5 → Spring migration.

## Install

VS Code → Extensions → `…` (top right) → **Install from VSIX…** → pick `config-match-catch.vsix`.

## First time

1. Open your clones of **Common-Resources** and **helm-template** in VS Code (File → Add Folder to Workspace).
   The extension finds them by name. If they're somewhere else, it asks you once.
2. Click **Config Match** in the left bar.
3. Production is set up already. For any other environment, open **Files** and press **Pick the file…**
   once per file. The path is saved in your settings (Settings → Config Match & Catch).

## Everyday use

- **Home** shows the health of the current environment, what needs attention, and every environment at a glance.
- **Find a variable**: type part of a name or a value. Both files are searched at once. Press `/` to jump to the box.
- Click a result to see that variable in **every environment** side by side. Edit any value there, or **add here**
  where it is missing.
- **＋ Add variable** creates the key in BW5 **and** Spring, in **all** environments. The twin name is suggested
  from your existing naming (e.g. `crm.service.url` → `crm_service_url`), and you set each environment's value.
- If you add a key straight in the file and save, the extension offers to create its twin on the other side and in
  the other environments.
- **Changes** lists everything waiting to be sent, kept even if you close VS Code. **Check & send** re-checks
  everything, then makes a `config-sync/…` branch in each repository, commits, pushes, and opens GitLab's
  merge-request page. `master` is never committed to.

## What it warns you about

It **blocks**:

- a key that already exists
- a name with spaces or invalid characters
- a change that would make the YAML invalid
- a key defined twice

It **asks before continuing** when:

- a value is empty or has extra spaces
- a port isn't a number
- the same value is already used by another key
- two environments get the same server
- a value differs from its twin on the other side
- a password is in plain text in the values file
- your repository is behind GitLab

It **alerts you** when a file you just saved contains a duplicate key.

## Good to know

- Git work uses VS Code's own Git, so it uses the same login as TortoiseGit. You need the VPN for pull and push.
- Files are written back in their own encoding (Latin-1 or UTF-8). Comments, order and spacing stay as they were.
- Learned naming rules are kept on your computer. Export or import them on the **Rules** tab to share with the team.
