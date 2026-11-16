const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const fs=require('node:fs');const path=require('node:path');const {randomBytes}=require('node:crypto');
const url=process.env.AUDIT_DATABASE_URL;
if(url){const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.port!=='56487'||u.pathname!=='/msghub_audit')throw Error('Only isolated audit database permitted');}
test('upgrade archives duplicate global rows before creating partial uniqueness',{skip:!url},async()=>{
 const database='msghub_audit_migration_'+randomBytes(4).toString('hex');
 const admin=new Client({connectionString:url});await admin.connect();await admin.query(`CREATE DATABASE "${database}"`);
 const target=new URL(url);target.pathname='/'+database;const db=new Client({connectionString:target.href});
 try{
  await db.connect();const dir=path.resolve(__dirname,'../apps/api/prisma/migrations');
  const migrations=fs.readdirSync(dir).filter(name=>fs.existsSync(path.join(dir,name,'migration.sql'))).sort();
  await db.query(fs.readFileSync(path.join(dir,migrations[0],'migration.sql'),'utf8'));
  await db.query(`INSERT INTO "EventDefinition" (id,code,name,"updatedAt") VALUES ('old','audit-duplicate','old','2025-01-01'),('new','audit-duplicate','new','2026-01-01')`);
  for(const migration of migrations.slice(1))await db.query(fs.readFileSync(path.join(dir,migration,'migration.sql'),'utf8'));
  assert.deepEqual((await db.query(`SELECT id FROM "EventDefinition" WHERE code='audit-duplicate'`)).rows,[{id:'new'}]);
  const archive=(await db.query(`SELECT snapshot FROM "MigrationArchive" WHERE "tableName"='EventDefinition' AND "rowId"='old'`)).rows;
  assert.equal(archive[0].snapshot.name,'old');
  await assert.rejects(db.query(`INSERT INTO "EventDefinition" (id,code,name,"updatedAt") VALUES ('third','audit-duplicate','x',now())`),e=>e.code==='23505');
 }finally{await db.end();await admin.query(`DROP DATABASE "${database}"`);await admin.end();}
});
