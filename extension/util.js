"use strict";
/* Pure helpers — no vscode import, so they can be unit-tested with plain node. */
const path = require("path");

/** git remote URL -> GitLab web URL of the project.
 *  git@host:group/proj.git | ssh://git@host:2222/group/proj.git | https://user@host/group/proj.git */
function remoteToWebUrl(remote) {
  const r = String(remote || "").trim();
  if (!r) return "";
  let m = r.match(/^[\w.-]+@([^:/]+):(?!\d+\/)(.+?)(?:\.git)?\/?$/);           // scp-like
  if (m) return "https://" + m[1] + "/" + m[2];
  m = r.match(/^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  if (m) return "https://" + m[1] + "/" + m[2];
  m = r.match(/^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (m) return m[1] + "://" + m[2] + "/" + m[3];
  return "";
}

function newMergeRequestUrl(webUrl, source, target, title) {
  if (!webUrl) return "";
  const q = new URLSearchParams();
  q.set("merge_request[source_branch]", source);
  if (target) q.set("merge_request[target_branch]", target);
  if (title) q.set("merge_request[title]", title);
  return webUrl + "/-/merge_requests/new?" + q.toString();
}

function stamp(d) {
  d = d || new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function slug(s) {
  return String(s || "config").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "config";
}
function branchName(envName, d) { return "config-sync/" + slug(envName) + "-" + stamp(d); }

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 0-based line of `key=`/`key:` in a .properties text, or -1 */
function findPropsLine(text, key) {
  const re = new RegExp("^\\s*" + esc(key) + "\\s*[=:\\s]");
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i]) || lines[i].trim() === key) return i;
  return -1;
}

/** 0-based line of a flattened YAML key (a.b.c) below an optional root block (x.y), or -1.
 *  Walks the indentation; falls back to the first line that starts with the leaf name. */
function findYamlLine(text, key, root) {
  const lines = String(text).split(/\r?\n/);
  const indent = l => l.match(/^\s*/)[0].length;
  const segs = [].concat(root && root !== "__ALL__" ? String(root).split(".") : [], String(key).split("."));
  const keyRe = l => { const m = l.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^:#]+?))\s*:(\s|$)/); return m ? (m[1] || m[2] || m[3] || "").trim() : null; };
  // try progressively joined segments, because a flattened key may itself contain dots
  function walk(from, to, si) {
    if (si >= segs.length) return -1;
    let childIndent = -1;
    for (let i = from; i < to; i++) {
      const l = lines[i]; if (!l.trim() || /^\s*#/.test(l) || /^\s*-/.test(l)) continue;
      const ind = indent(l); if (childIndent < 0) childIndent = ind; if (ind !== childIndent) continue;
      const k = keyRe(l); if (k == null) continue;
      for (let j = si + 1; j <= segs.length; j++) {
        if (k !== segs.slice(si, j).join(".")) continue;
        if (j === segs.length) return i;
        let end = lines.length;
        for (let x = i + 1; x < lines.length; x++) { const lx = lines[x]; if (!lx.trim() || /^\s*#/.test(lx)) continue; if (indent(lx) <= ind) { end = x; break; } }
        const r = walk(i + 1, end, j); if (r >= 0) return r;
      }
    }
    return -1;
  }
  const hit = walk(0, lines.length, 0);
  if (hit >= 0) return hit;
  const leaf = String(key).split(".").pop();
  const re = new RegExp("^\\s*[\"']?" + esc(leaf) + "[\"']?\\s*:");
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

/** loose folder-name match: "Common-Resources", "common_resources", "CommonResources" */
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function nameMatches(folder, wanted) { return !!wanted && norm(String(folder).replace(/[\\/]+$/, "").split(/[\\/]/).pop()) === norm(wanted); }

function samePath(a, b) {
  const n = p => path.resolve(String(p)).replace(/[\\/]+$/, "");
  return process.platform === "win32" || process.platform === "darwin" ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}

/** bytes → {text, enc}: UTF-8 when the bytes are valid UTF-8, else ISO-8859-1 (common for TIBCO .properties). */
function decode(buf) {
  const utf = buf.toString("utf8");
  const bad = utf.indexOf("\uFFFD") >= 0 && !buf.includes(Buffer.from([0xEF, 0xBF, 0xBD]));
  return bad ? { text: buf.toString("latin1"), enc: "latin1" } : { text: utf, enc: "utf8" };
}

module.exports = { decode, remoteToWebUrl, newMergeRequestUrl, stamp, slug, branchName, findPropsLine, findYamlLine, nameMatches, samePath };
