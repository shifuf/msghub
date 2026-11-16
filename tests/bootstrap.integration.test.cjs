const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {randomBytes}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const root=path.resolve(__dirname,'..');const api=createRequire(path.join(root,'apps/api/package.json'));const {Client}=require('pg');
const url=process.env.AUDIT_DATABASE_URL,redis=process.env.AUDIT_REDIS_URL;
if(url){const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.port!=='56487'||u.pathname!=='/msghub_audit')throw Error('Only isolated audit PostgreSQL is permitted');}
if(redis){const u=new URL(redis);if(u.hostname!=='127.0.0.1'||u.port!=='56488')throw Error('Only isolated audit Redis is permitted');}
test('production seed rejects APP_ENV-only missing password; cold seed and full AppModule boot succeed',{skip:!url||!redis,timeout:90000},async()=>{
 const database='msghub_audit_seed_'+randomBytes(4).toString('hex');const control=new Client({connectionString:url});await control.connect();await control.query(`CREATE DATABASE "${database}"`);
 const fresh=new URL(url);fresh.pathname='/'+database;
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'msghub-bootstrap-'));const deep=path.join(cwd,'isolated','cwd');fs.mkdirSync(deep,{recursive:true});
 const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,APP_ENV:'production',NODE_ENV:'development',JWT_SECRET:randomBytes(32).toString('hex'),DATABASE_URL:fresh.href,REDIS_HOST:'127.0.0.1',REDIS_PORT:'56488',ADMIN_USERNAME:'audit-bootstrap',ADMIN_PASSWORD:'Safe-audit-password-7X!'};
 const run=(args,extra={})=>spawnSync(process.execPath,args,{cwd:deep,env:{...env,...extra},encoding:'utf8',timeout:45000});
 const prisma=api.resolve('prisma/build/index.js');const compiled=process.env.AUDIT_COMPILED==='true';const seed=path.join(root,compiled?'apps/api/dist/prisma/seed.js':'apps/api/prisma/seed.ts');const register=api.resolve('ts-node/register/transpile-only');
 const seedArgs=compiled?[seed]:['-r',register,seed];
 const tsenv={TS_NODE_PROJECT:path.join(root,'apps/api/tsconfig.json')};
 try{
  const schemaDir=path.join(deep,'prisma');fs.mkdirSync(schemaDir);fs.copyFileSync(path.join(root,'apps/api/prisma/schema.prisma'),path.join(schemaDir,'schema.prisma'));fs.cpSync(path.join(root,'apps/api/prisma/migrations'),path.join(schemaDir,'migrations'),{recursive:true});
  const migration=run([prisma,'migrate','deploy','--schema',path.join(schemaDir,'schema.prisma')]);assert.equal(migration.status,0,migration.stderr+ migration.stdout);
  const refused=run(seedArgs,{...tsenv,ADMIN_PASSWORD:''});assert.notEqual(refused.status,0,'APP_ENV=production must refuse first seed without explicit password');
  assert.match(refused.stderr,/ADMIN_PASSWORD/);
  const initialized=run(seedArgs,tsenv);assert.equal(initialized.status,0,initialized.stderr+initialized.stdout);
  const helper=path.join(root,'tests/helpers/bootstrap-smoke.cjs');const boot=run([helper],{...tsenv,AUDIT_SMOKE_DATABASE:fresh.href});assert.equal(boot.status,0,boot.stderr+boot.stdout);assert.match(boot.stdout,/FULL_APP_BOOT_OK/);
 }finally{await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await control.query(`DROP DATABASE "${database}"`);await control.end();if(!path.resolve(cwd).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(cwd).startsWith('msghub-bootstrap-'))throw Error('Unsafe cleanup target');fs.rmSync(cwd,{recursive:true,force:true});}
});
