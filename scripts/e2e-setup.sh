#!/usr/bin/env bash
# Fresh test bed for test/vscode.e2e.js: two clones whose "GitLab" origin is a local bare repo
# (git url.insteadOf keeps the real https address visible to VS Code), the built .vsix installed
# into code-server, and code-server started on 127.0.0.1:8080.
# Needs: code-server standalone (CODE_SERVER=/path/bin/code-server), git, the fixtures.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
E="${E2E_DIR:-/tmp/cmc-e2e}"
CS="${CODE_SERVER:?set CODE_SERVER to the code-server binary}"
pkill -f -- "--bind-addr 127.0.0.1:8080 --user-data-dir $E/ud" 2>/dev/null || true; sleep 1
rm -rf "$E"; mkdir -p "$E/remote/tibco" "$E/remote/integration-java" "$E/work" "$E/ud/User"
mk(){ d="$E/seed/$1"; mkdir -p "$d/$(dirname "$3")"; cp "$4" "$d/$3"
  (cd "$d" && git init -q -b master && git add -A && git -c user.name=seed -c user.email=s@x commit -qm init)
  git clone -q --bare "$d" "$E/remote/$2/$1.git"; }
# Testing = a copy of production with other hosts and one key missing (so "missing here" has something to find)
T="$E/fx"; mkdir -p "$T"
sed -e 's/10\.230\./10.99./g' -e '/^jms\.jndiuser=/d' "$ROOT/test/fixtures/env_prd.properties" > "$T/env_tst.properties"
printf 'company.name=Vodafone \xc9gypte\n' >> "$T/env_tst.properties"     # a Latin-1 byte, like real TIBCO files
sed -e 's/10\.230\./10.99./g' "$ROOT/test/fixtures/commonvalues.yaml" > "$T/tst.yaml"
mk2(){ d="$E/seed/$1"; mkdir -p "$d/$(dirname "$3")"; cp "$4" "$d/$3"; }
mk2 Common-Resources tibco _build/env_tst.properties "$T/env_tst.properties"
mk2 helm-template integration-java common/testing/common-values.yaml "$T/tst.yaml"
mk Common-Resources tibco _build/env_prd.properties "$ROOT/test/fixtures/env_prd.properties"
mk helm-template integration-java common/production/common-values.yaml "$ROOT/test/fixtures/commonvalues.yaml"
git config --global url."file://$E/remote/".insteadOf "https://git.vf-eg.internal.vodafone.com/"
git config --global user.name >/dev/null || git config --global user.name "Test Dev"
git config --global user.email >/dev/null || git config --global user.email dev@example.com
(cd "$E/work" && git clone -q https://git.vf-eg.internal.vodafone.com/tibco/Common-Resources.git \
  && git clone -q https://git.vf-eg.internal.vodafone.com/integration-java/helm-template.git)
echo '{ "folders": [ { "path": "Common-Resources" }, { "path": "helm-template" } ] }' > "$E/work/both.code-workspace"
cat > "$E/ud/User/settings.json" <<'JSON'
{ "security.workspace.trust.enabled": false, "workbench.startupEditor": "none", "git.autofetch": false, "telemetry.telemetryLevel": "off",
  "chat.disableAIFeatures": true, "workbench.secondarySideBar.defaultVisibility": "hidden",
  "configMatch.environments": [
    { "name": "Production", "bw5File": "_build/env_prd.properties", "springFile": "common/production/common-values.yaml", "springRoot": "" },
    { "name": "Testing", "bw5File": "_build/env_tst.properties", "springFile": "common/testing/common-values.yaml", "springRoot": "" },
    { "name": "Staging", "bw5File": "", "springFile": "", "springRoot": "" } ] }
JSON
"$CS" --user-data-dir "$E/ud" --extensions-dir "$E/ext" --install-extension "$ROOT/dist/config-match-catch.vsix" --force >/dev/null
nohup "$CS" --auth none --bind-addr 127.0.0.1:8080 --user-data-dir "$E/ud" --extensions-dir "$E/ext" --disable-telemetry --disable-update-check "$E/work" > "$E/cs.log" 2>&1 &
sleep 4
echo "CMC_URL='http://127.0.0.1:8080/?workspace=$E/work/both.code-workspace' CMC_REMOTE=$E/remote CMC_WORK=$E/work CMC_SETTINGS=$E/ud/User/settings.json node test/vscode.e2e.js"
