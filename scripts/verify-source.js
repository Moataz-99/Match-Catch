/* Proves the JSX sources are exactly the code inside a given build:
   compiles src/ui/*.jsx the same way build.js does and compares with the <script> in the HTML. */
const fs=require("fs"), path=require("path"), babel=require("@babel/core");
const html=fs.readFileSync(process.argv[2],"utf8");
const blocks=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const builtApp=blocks[blocks.length-1].replace(/<\\\/script/g,"</script");
const dir=path.join(__dirname,"..","src","ui");
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".jsx")).sort();
const pre="const {useState,useMemo,useCallback,useRef,useEffect}=React;\nconst E=window.CMEngine;\n";
const jsx=pre+files.map(f=>fs.readFileSync(path.join(dir,f),"utf8")).join("\n");
const ours=babel.transformSync(jsx,{presets:[["@babel/preset-react",{runtime:"classic"}]],compact:false,comments:false}).code;
const norm=s=>s.replace(/\s+/g," ").trim();
const a=norm(ours), b=norm(builtApp);
if(a===b){ console.log("IDENTICAL — "+files.join(", ")+" reproduce the build exactly"); process.exit(0); }
let i=0; while(i<a.length&&a[i]===b[i]) i++;
const partial=process.argv[3]==="--prefix";
if(partial&&i===a.length){ console.log("prefix OK ("+a.length+" of "+b.length+" chars)"); process.exit(0); }
console.log("DIFFERENT at char "+i+" of "+a.length+"/"+b.length);
console.log(" ours : …"+a.slice(Math.max(0,i-150),i+150));
console.log(" build: …"+b.slice(Math.max(0,i-150),i+150));
process.exit(1);
