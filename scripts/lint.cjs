// Lightweight repository checks; semantic TypeScript/Vue analysis is pnpm typecheck.
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');let failed=false;
const check=spawnSync('git',['-c','core.safecrlf=false','diff','--check'],{cwd:root,encoding:'utf8'});
if(check.status!==0){console.error(check.stdout||check.stderr);failed=true;}
function walk(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(cjs|js)$/.test(entry.name)){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){console.error(result.stderr);failed=true;}
 }
}}
for(const dir of ['scripts','tests','apps/web/tests'])walk(path.join(root,dir));
if(failed)process.exitCode=1;else console.log('Diff whitespace and JavaScript syntax checks passed.');
