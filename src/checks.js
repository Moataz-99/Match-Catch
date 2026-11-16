/* Config Match & Catch — checks.
   Everything that decides "is this a mistake?" before anything is written:
   twin names for a new variable, name rules, duplicate keys and values, values that look like they belong to
   another environment, and a last check of every patched file before it is sent.
   Plain JS, zero deps. Browser: window.CMChecks (needs window.CMEngine). Node: require("./checks")(engine). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.CMChecks = factory(root.CMEngine);
})(typeof self !== "undefined" ? self : this, function (E) {
"use strict";

const SIDE = { bw5: "BW5", spring: "Spring" };
const norm = k => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const issue = (level, msg, o) => Object.assign({ level, msg }, o || {});
const SECRET = /(pass(word)?|pwd|secret|token|credential|apikey|api_key)/i;
const ENC = /^#!/;

/* ---------------------------------------------------------------- twin names */
function ruleRe(pat) {
  const names = [];
  const src = String(pat).split(/(\{[a-zA-Z0-9_]+\})/).map(p => {
    const m = p.match(/^\{([a-zA-Z0-9_]+)\}$/);
    if (m) { names.push(m[1]); return "([A-Za-z0-9_.\\-]+?)"; }
    return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { re: new RegExp("^" + src + "$", "i"), names };
}
function fill(pat, names, vals) { let t = pat; names.forEach((n, i) => { t = t.replace(new RegExp("\\{" + n + "\\}", "g"), vals[i]); }); return t; }

/** majority style of the other side's keys: {lower: bool, sep: "_"|"."|"-"} */
function styleOf(keys) {
  const ks = (keys || []).filter(Boolean);
  if (!ks.length) return null;
  const count = re => ks.filter(k => re.test(k)).length;
  const sep = [["_", count(/_/)], [".", count(/\./)], ["-", count(/-/)]].sort((a, b) => b[1] - a[1])[0];
  return { lower: count(/[A-Z]/) <= ks.length / 2, sep: sep[1] ? sep[0] : "_" };
}

/** Name the other side should use for `key`. Order: a confirmed pair, a learned pattern rule, the naming style of the
 *  other file. Returns {name, how}. */
function suggestTwin(key, fromSide, learned, otherKeys) {
  key = String(key || "").trim();
  if (!key) return { name: "", how: "" };
  const L = learned || {};
  const toSide = fromSide === "bw5" ? "spring" : "bw5";
  const m = (L.mappings || []).find(x => (fromSide === "bw5" ? x.b : x.s) === key);
  if (m) return { name: fromSide === "bw5" ? m.s : m.b, how: "confirmed pair" };
  for (const r of (L.rules || [])) {
    if (!r || !r.bw5 || !r.spring) continue;
    const from = fromSide === "bw5" ? r.bw5 : r.spring, to = fromSide === "bw5" ? r.spring : r.bw5;
    const R = ruleRe(from), hit = key.match(R.re);
    if (hit) return { name: fill(to, R.names, hit.slice(1)), how: "rule " + r.bw5 + " ⇄ " + r.spring };
  }
  const st = styleOf(otherKeys) || (toSide === "spring" ? { lower: true, sep: "_" } : { lower: true, sep: "." });
  let name = String(key).replace(/([a-z0-9])([A-Z])/g, "$1" + st.sep + "$2").split(/[^A-Za-z0-9]+/).filter(Boolean).join(st.sep);
  if (st.lower) name = name.toLowerCase();
  return { name, how: "naming style of the " + SIDE[toSide] + " file" };
}

/* ---------------------------------------------------------------- names */
function checkName(side, key) {
  const out = [], k = String(key == null ? "" : key);
  const S = SIDE[side];
  if (!k.trim()) return [issue("error", S + " name is empty.", { side, field: "name" })];
  if (/\s/.test(k)) out.push(issue("error", S + " name can't contain spaces.", { side, field: "name" }));
  if (/[^\x21-\x7e]/.test(k.replace(/\s/g, ""))) out.push(issue("error", S + " name has a non-English character.", { side, field: "name" }));
  if (side === "bw5") {
    if (/[=:\\]/.test(k)) out.push(issue("error", "BW5 name can't contain = : or \\ (they end the name in a .properties file).", { side, field: "name" }));
    if (/^[#!]/.test(k)) out.push(issue("error", "BW5 name can't start with # or ! (the line would be a comment).", { side, field: "name" }));
  } else {
    if (/[:#'"{}\[\],&*?|<>=!%@`\\]/.test(k)) out.push(issue("error", "Spring name can only use letters, digits, _ and - (other characters break the YAML).", { side, field: "name" }));
    if (/^[-.]/.test(k)) out.push(issue("error", "Spring name can't start with - or .", { side, field: "name" }));
    if (/\./.test(k)) out.push(issue("warn", "Spring name contains a dot — Helm treats dots as nesting in some places. Prefer _ .", { side, field: "name" }));
  }
  if (k.length > 120) out.push(issue("warn", S + " name is very long (" + k.length + " characters).", { side, field: "name" }));
  return out;
}

/* ---------------------------------------------------------------- values */
const leaf = key => E.leafOf(E.tokenize(key, E.makeVocab({})));
const trivial = v => { const t = String(v).trim(); return t.length < 6 || /^(true|false|yes|no|on|off|null|none)$/i.test(t) || /^-?\d+(\.\d+)?$/.test(t); };
const hostLike = (key, v) => { const c = E.classify(key, v).type; return ["host", "hostport", "url", "jdbc"].indexOf(c) >= 0 || ["host", "url", "sid", "service"].indexOf(leaf(key)) >= 0; };

/** Checks one value for one key in one file. ctx: {env, side, parsed (that file), skipKey (the key itself, when editing),
 *  twin: {key, value} on the other side of the same environment, others: [{env, value}] the same key in other envs} */
function checkValue(key, value, ctx) {
  const c = ctx || {}, out = [], v = String(value == null ? "" : value), t = v.trim();
  const where = (c.env ? c.env + " · " : "") + SIDE[c.side] + " · " + key;
  const o = { env: c.env, side: c.side, key, field: "value" };
  if (/[\r\n]/.test(v)) out.push(issue("error", where + ": a value can't span several lines.", o));
  if (t === "") out.push(issue("warn", where + ": the value is empty.", o));
  else if (v !== t) out.push(issue("warn", where + ": the value starts or ends with a space — both runtimes keep it.", o));
  if (/\t/.test(v)) out.push(issue("warn", where + ": the value contains a TAB.", o));
  const lf = leaf(key);
  if (t && lf === "port" && !/^\d{1,5}$/.test(t) && !/^\$\{/.test(t)) out.push(issue("warn", where + ": a port should be a number, not \"" + t + "\".", o));
  if (t && lf === "enabled" && !/^(true|false)$/i.test(t) && !/^\$\{/.test(t)) out.push(issue("warn", where + ": an on/off setting should be true or false.", o));
  if (t && c.side === "spring" && SECRET.test(key) && !ENC.test(t) && !/^\$\{/.test(t)) out.push(issue("warn", where + ": password in plain text in the values file — it should come from a Secret.", o));
  let m; const re = /\$\{([^}]+)\}/g;
  const keys = new Set(((c.parsed && c.parsed.entries) || []).map(e => e.key));
  while ((m = re.exec(v))) if (!keys.has(m[1])) out.push(issue("warn", where + ": refers to ${" + m[1] + "}, which isn't defined in this file.", o));
  if (t && !trivial(t) && c.parsed) {
    const same = c.parsed.entries.filter(e => e.key !== key && e.key !== c.skipKey && String(e.value).trim() === t).map(e => e.key);
    if (same.length) out.push(issue("warn", where + ": the same value is already used by " + same.slice(0, 3).join(", ") + (same.length > 3 ? " and " + (same.length - 3) + " more" : "") + " — a copy-paste mistake?", o));
  }
  if (t && c.twin && c.twin.key && c.twin.value != null && String(c.twin.value).trim() !== "") {
    const cmp = E.compareValues(c.side === "bw5" ? key : c.twin.key, c.side === "bw5" ? t : c.twin.value, c.side === "bw5" ? c.twin.key : key, c.side === "bw5" ? c.twin.value : t, {});
    if (cmp.status === "mismatch") out.push(issue("warn", where + ": differs from its twin " + c.twin.key + " = \"" + c.twin.value + "\" on the " + (c.side === "bw5" ? "Spring" : "BW5") + " side.", o));
  }
  if (t && !trivial(t) && hostLike(key, t)) (c.others || []).forEach(x => {
    if (x.env !== c.env && String(x.value || "").trim() === t) out.push(issue("warn", where + ": the same value is used in " + x.env + " — environments usually point at different servers. Right environment?", o));
  });
  return out;
}

/* ---------------------------------------------------------------- a new variable */
/** spec: {bKey, sKey, createB, createS, values: {env: {bw5, spring}}}
 *  envs: [{name, bw5: parsed|null, spring: parsed|null}] (parsed = engine parse result of that file, null if not set) */
function checkNewVariable(spec, envs) {
  const out = [], s = spec || {};
  const sides = [s.createB && "bw5", s.createS && "spring"].filter(Boolean);
  if (!sides.length) return [issue("error", "Choose at least one side to create the variable in.")];
  const keyOf = side => side === "bw5" ? s.bKey : s.sKey;
  sides.forEach(side => checkName(side, keyOf(side)).forEach(i => out.push(i)));
  if (out.some(i => i.level === "error")) return out;
  let targets = 0;
  (envs || []).forEach(env => sides.forEach(side => {
    const p = env[side], key = keyOf(side);
    if (!p) { out.push(issue("info", env.name + " · " + SIDE[side] + ": file not set up yet — skipped. It will show as missing there until you add it.", { env: env.name, side })); return; }
    targets++;
    const exact = p.entries.find(e => e.key === key);
    if (exact) { out.push(issue("error", SIDE[side] + " key " + key + " already exists in " + env.name + " (= \"" + exact.value + "\"). Edit it instead of adding it again.", { env: env.name, side, field: "name" })); return; }
    const similar = p.entries.find(e => norm(e.key) === norm(key));
    if (similar) out.push(issue("warn", env.name + " · " + SIDE[side] + " already has " + similar.key + ", which differs only in case or punctuation. Same setting?", { env: env.name, side, field: "name" }));
    const commented = (p.commented || []).find(e => e.key === key);
    if (commented) out.push(issue("warn", env.name + " · " + SIDE[side] + " has " + key + " commented out at line " + commented.line + ". Uncomment it instead?", { env: env.name, side, field: "name" }));
    const val = ((s.values || {})[env.name] || {})[side];
    const twinSide = side === "bw5" ? "spring" : "bw5";
    // compare with the environments listed before this one only, so each clash is reported once
    const idx = (envs || []).indexOf(env);
    const others = (envs || []).filter((e, j) => j < idx && e[side]).map(e => ({ env: e.name, value: ((s.values || {})[e.name] || {})[side] }));
    const twinVal = ((s.values || {})[env.name] || {})[twinSide];
    checkValue(key, val, { env: env.name, side, parsed: p, others,
      twin: sides.indexOf(twinSide) >= 0 ? { key: keyOf(twinSide), value: twinVal } : null }).forEach(i => {
        // the Spring value is a copy of the BW5 one: don't say the same thing twice
        if (side === "spring" && sides.length === 2 && String(val) === String(twinVal) && /starts or ends with a space|is empty|same value is used in|TAB/.test(i.msg)) return;
        out.push(i);
      });
  }));
  if (!targets) out.push(issue("error", "None of the environments has its files set up — nothing to add to."));
  return dedupe(out);
}
function dedupe(list) { const seen = new Set(); return list.filter(i => { const k = i.level + "|" + i.msg; if (seen.has(k)) return false; seen.add(k); return true; }); }

/* ---------------------------------------------------------------- the final check before sending */
/** kind: "bw5"|"spring"; returns issues for what the patch would break. yamlLoad = jsyaml.load */
function checkPatched(kind, before, after, root, yamlLoad, label) {
  const out = [], L = label || SIDE[kind];
  if (kind === "spring") {
    try { yamlLoad(after); } catch (e) { return [issue("error", L + ": the file would no longer be valid YAML — " + String(e.message || e).split("\n")[0])]; }
  }
  const P = t => kind === "bw5" ? E.parseProperties(t) : E.parseYaml(t, root || "__ALL__", yamlLoad);
  const a = P(before), b = P(after);
  if (b.error) out.push(issue("error", L + ": " + b.error));
  const had = new Set((a.dups || []).map(d => d.key));
  (b.dups || []).filter(d => !had.has(d.key)).forEach(d => out.push(issue("error", L + ": the change would define " + d.key + " twice.", { key: d.key })));
  const lost = a.entries.filter(e => !b.entries.some(x => x.key === e.key)).map(e => e.key);
  if (lost.length) out.push(issue("warn", L + ": " + lost.length + " key(s) would disappear: " + lost.slice(0, 5).join(", ")));
  return out;
}

/* ---------------------------------------------------------------- environments compared */
/** keys that exist in another environment's file of the same side but not in `current`'s. */
function missingVsOtherEnvs(envs, current, side) {
  const cur = (envs || []).find(e => e.name === current);
  if (!cur || !cur[side]) return [];
  const have = new Set(cur[side].entries.map(e => e.key)), map = new Map();
  (envs || []).forEach(e => {
    if (e.name === current || !e[side]) return;
    e[side].entries.forEach(x => { if (have.has(x.key)) return; const m = map.get(x.key) || { key: x.key, side, from: [] }; m.from.push({ env: e.name, value: x.value }); map.set(x.key, m); });
  });
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/** issues for one value edit; same rules as a new variable's value */
function checkEdit(edit, envs, twin) {
  const env = (envs || []).find(e => e.name === edit.env) || {};
  const others = (envs || []).filter(e => e.name !== edit.env && e[edit.side]).map(e => {
    const x = e[edit.side].entries.find(y => y.key === edit.key); return { env: e.name, value: x ? x.value : null };
  });
  return checkValue(edit.key, edit.value, { env: edit.env, side: edit.side, parsed: env[edit.side], others, twin, skipKey: edit.key });
}

return { suggestTwin, checkName, checkValue, checkNewVariable, checkPatched, checkEdit, missingVsOtherEnvs, styleOf, norm };
});
