const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const apiRequire = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
apiRequire('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
apiRequire('reflect-metadata');
const { BackupService } = require('../apps/api/src/backup/backup.service.ts');

function database(seed = {}) {
  const rows = Object.fromEntries(['channel','project','projectChannel','emailTemplate','pushTemplate','templateRevision','systemSetting','emailSuppress','scheduledMessage','eventDefinition','partnerLink'].map(k => [k, structuredClone(seed[k] || [])]));
  const db = {};
  for (const [key, values] of Object.entries(rows)) db[key] = {
    findMany: async () => structuredClone(values),
    findUnique: async ({where}) => structuredClone(values.find(v => Object.entries(where).every(([k,x]) => v[k] === x)) || null),
    findFirst: async ({where}) => structuredClone(values.find(v => Object.entries(where).every(([k,x]) => v[k] === x)) || null),
    create: async ({data}) => { const row = { id: `${key}-${values.length}`, ...data }; values.push(row); return structuredClone(row); },
    update: async ({where,data}) => { const row=values.find(v => Object.entries(where).every(([k,x])=>v[k]===x)); if(!row) throw Error('missing row'); Object.assign(row,data); return structuredClone(row); },
    upsert: async ({where,create,update}) => { const row=values.find(v=>Object.entries(where).every(([k,x])=>v[k]===x)); if(row) { Object.assign(row,update); return row; } values.push(create); return create; },
  };
  db.$transaction = async (fn) => { const before=structuredClone(rows); try { return await fn(db); } catch(e) { for(const k of Object.keys(rows)) rows[k].splice(0,rows[k].length,...before[k]); throw e; } };
  return { db, rows };
}
const adapters = { get: () => ({ validateConfig: () => {} }) };
const fixture = () => ({ version: 3, channels: [{ id:'c1',name:'通知',type:'BARK',config:{deviceKey:'private'},enabled:true,isDefault:false }], projects: [
  {id:'p1',name:'同名',enabled:true,unreadEmailFallbackEnabled:true,unreadEmailFallbackHours:60,unreadEmailTemplateCode:'notice',bindings:[{channelId:'c1',enabled:true}]},
  {id:'p2',name:'同名',enabled:true,bindings:[]},
], emailTemplates:[], pushTemplates:[], systemSettings:[], emailSuppress:[], eventDefinitions:[], partners:[{id:'l1',name:'网站',url:'https://example.org',enabled:true}], schedules:[{id:'s1',projectId:'p1',channelId:'c1',channelType:'BARK',kind:'push',title:'a',runAt:'2035-01-01T00:00:00Z',status:'PENDING'}] });

test('stable IDs preserve same-name projects and repeated import does not duplicate schedules', async()=>{
  const {db,rows}=database(); const s=new BackupService(db,adapters);
  await s.importConfig(fixture()); await s.importConfig(fixture());
  assert.equal(rows.project.length,2); assert.equal(rows.scheduledMessage.length,1);
  assert.equal(rows.scheduledMessage[0].channelId,'c1');
  assert.equal(rows.project.find(p=>p.id==='p1').unreadEmailFallbackHours,60);
  assert.equal(rows.partnerLink.length,1);
});
test('unknown scoped references reject before any database mutation',async()=>{
  const {db,rows}=database(); const s=new BackupService(db,adapters); const data=fixture();
  data.emailTemplates=[{id:'t1',projectId:'missing',code:'x',name:'x',subject:'x',htmlBody:'x'}];
  await assert.rejects(s.importConfig(data),/引用|项目/); assert.equal(rows.project.length,0); assert.equal(rows.channel.length,0);
});
test('preview reports changes and performs no mutation',async()=>{
  const {db,rows}=database(); const s=new BackupService(db,adapters);
  const preview=await s.previewImport(fixture()); assert.equal(preview.projects.created,2); assert.equal(rows.project.length,0);
});
test('password encrypted backup round trips and wrong password is rejected',async()=>{
  const {db}=database({project:[{id:'p1',name:'A',bindings:[],unreadEmailFallbackEnabled:true,unreadEmailFallbackHours:60}]});
  const s=new BackupService(db,adapters); const encrypted=await s.exportConfig({password:'a-long-backup-password'});
  assert.equal(encrypted.encrypted,true); assert.equal(encrypted.projects,undefined);
  await assert.rejects(s.previewImport(encrypted,{password:'wrong-password'}),/密码|损坏/);
  const preview=await s.previewImport(encrypted,{password:'a-long-backup-password'}); assert.equal(preview.projects.updated,1);
});
test('redacted export cannot silently overwrite channel credentials',async()=>{
  const {db}=database({channel:[{id:'c1',name:'A',type:'BARK',config:{deviceKey:'secret'}}]});
  const s=new BackupService(db,adapters); const data=await s.exportConfig({redact:true});
  assert.equal(JSON.stringify(data).includes('secret'),false); await assert.rejects(s.importConfig(data),/脱敏/);
});
test('configuration backup preserves draft and published template history',async()=>{
 const {db}=database({emailTemplate:[{id:'t1',projectId:null,code:'notice',name:'Notice',subject:'live',htmlBody:'live',revision:2,draft:{subject:'draft'}}],templateRevision:[{id:'r1',kind:'email',templateId:'t1',revision:1,snapshot:{name:'Notice',subject:'old',htmlBody:'old'}}]});
 const exported=await new BackupService(db,adapters).exportConfig();
 assert.deepEqual(exported.emailTemplates[0].draft,{subject:'draft'});assert.equal(exported.emailTemplates[0].revision,2);
 assert.equal(exported.templateRevisions[0].snapshot.subject,'old');
 const target=database();await new BackupService(target.db,adapters).importConfig(exported);
 assert.equal(target.rows.emailTemplate[0].revision,2);assert.equal(target.rows.templateRevision[0].snapshot.subject,'old');
});
test('backup cannot move a template identity into another project',async()=>{
 const {db}=database({emailTemplate:[{id:'t1',projectId:'original',code:'notice'}]});
 const data=fixture();data.emailTemplates=[{id:'t1',projectId:'p1',code:'notice',name:'X',subject:'x',htmlBody:'x'}];
 await assert.rejects(new BackupService(db,adapters).previewImport(data),/身份|范围/);
});
