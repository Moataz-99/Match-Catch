#!/usr/bin/env node
/* Builds dist/webview.html — the page shown inside VS Code, one self-contained file:
   React + ReactDOM + js-yaml + src/engine.js + src/ui/*.jsx (pre-compiled), all inlined.
   Script tags carry __NONCE__ and the CSP carries __CSP_SOURCE__; extension.js fills both in at runtime. */
"use strict";
const fs=require("fs"), path=require("path"), babel=require("@babel/core");
const ROOT=path.join(__dirname,"..");
const read=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
const uiDir=path.join(ROOT,"src","ui");
const uiFiles=fs.readdirSync(uiDir).filter(f=>f.endsWith(".jsx")).sort();      // order matters: 01-…, 02-…
const pre="const {useState,useMemo,useCallback,useRef,useEffect}=React;\nconst E=window.CMEngine;\nconst C=window.CMChecks;\n";
const jsx=pre+uiFiles.map(f=>fs.readFileSync(path.join(uiDir,f),"utf8")).join("\n");
const js=babel.transformSync(jsx,{presets:[["@babel/preset-react",{runtime:"classic"}]],compact:false,comments:false}).code;
const guard=s=>String(s).replace(/<\/script/gi,"<\\/script");
const tag=(n,c)=>"<script nonce=\"__NONCE__\">/*! "+n+" */\n"+guard(c)+"\n</script>";
const libs=[
  tag("React 18.2.0 (MIT)",read("node_modules/react/umd/react.production.min.js")),
  tag("ReactDOM 18.2.0 (MIT)",read("node_modules/react-dom/umd/react-dom.production.min.js")),
  tag("js-yaml 4.1.0 (MIT)",read("node_modules/js-yaml/dist/js-yaml.min.js")),
  tag("Config Match & Catch engine",read("src/engine.js")),
  tag("Config Match & Catch checks",read("src/checks.js"))
].join("\n");
const html=read("src/shell.html").replace("<!--LIBS-->",()=>libs).replace("<!--APP-->",()=>"<script nonce=\"__NONCE__\">\n"+guard(js)+"\n</script>");
fs.mkdirSync(path.join(ROOT,"dist"),{recursive:true});
fs.writeFileSync(path.join(ROOT,"dist","webview.html"),html);
console.log("built dist/webview.html  "+(html.length/1024).toFixed(0)+" KB  ("+uiFiles.join(", ")+")");
