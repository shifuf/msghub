const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const api=createRequire(path.resolve(__dirname,'../apps/api/package.json'));
api('reflect-metadata');api('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../apps/api/tsconfig.json')});
const url=process.env.AUDIT_DATABASE_URL;
if(url && (!['127.0.0.1','localhost'].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith('/msghub_audit'))) throw Error('Integration tests require an isolated local msghub_audit database');
const {PrismaClient}=api('@prisma/client');
const db=url?new PrismaClient({datasources:{db:{url}}}):null;
after(async()=>{if(db)await db.$disconnect();});
test('real database backup import is atomic and idempotent with same-name projects',{skip:!db},async()=>{
 const {BackupService}=require('../apps/api/src/backup/backup.service.ts');
 const prefix=randomUUID();const p1=`${prefix}-p1`,p2=`${prefix}-p2`,c=`${prefix}-c`,s=`${prefix}-s`;
 const backup={version:3,channels:[{id:c,name:'shared-name',type:'INBOX',config:{}}],projects:[{id:p1,name:'same',bindings:[{channelId:c}],unreadEmailFallbackEnabled:true,unreadEmailFallbackHours:90},{id:p2,name:'same',bindings:[]}],schedules:[{id:s,projectId:p1,channelId:c,kind:'push',title:'test',runAt:'2035-01-01T00:00:00Z'}]};
 const service=new BackupService(db,{get:()=>({validateConfig:()=>{}})});
 await service.importConfig(backup);await service.importConfig(backup);
 assert.equal(await db.project.count({where:{id:{in:[p1,p2]}}}),2);assert.equal(await db.scheduledMessage.count({where:{id:s}}),1);
 assert.equal((await db.scheduledMessage.findUnique({where:{id:s}})).status,'PAUSED');
 const invalid=structuredClone(backup);invalid.projects[0].name='should rollback';invalid.emailTemplates=[{id:`${prefix}-t`,projectId:p1,code:'x',name:'x',subject:42,htmlBody:'x'}];
 await assert.rejects(service.importConfig(invalid));assert.equal((await db.project.findUnique({where:{id:p1}})).name,'same');
 await db.project.deleteMany({where:{id:{in:[p1,p2]}}});await db.channel.delete({where:{id:c}});
});
test('global event code is unique even when projectId is null',{skip:!db},async()=>{
 const code=`audit-${randomUUID()}`;const a=await db.eventDefinition.create({data:{code,name:'one'}});
 await assert.rejects(db.eventDefinition.create({data:{code,name:'two'}}),e=>e.code==='P2002');await db.eventDefinition.delete({where:{id:a.id}});
});
test('template publish and rollback preserve versions in the real database',{skip:!db},async()=>{
 const {TemplateVersionsService}=require('../apps/api/src/templates/template-versions.service.ts');
 const row=await db.emailTemplate.create({data:{code:`audit-${randomUUID()}`,name:'test',subject:'old',htmlBody:'<p>old</p>'}});
 const service=new TemplateVersionsService(db);await service.saveDraft('email',row.id,{subject:'new'});
 assert.equal((await db.emailTemplate.findUnique({where:{id:row.id}})).subject,'old');
 await service.publish('email',row.id);await service.rollback('email',row.id,1);
 assert.equal((await db.emailTemplate.findUnique({where:{id:row.id}})).revision,3);
 await db.templateRevision.deleteMany({where:{templateId:row.id}});await db.emailTemplate.delete({where:{id:row.id}});
});
test('backup restores template draft and history and published draft is SQL NULL',{skip:!db},async()=>{
 const {BackupService}=require('../apps/api/src/backup/backup.service.ts');
 const {TemplateVersionsService}=require('../apps/api/src/templates/template-versions.service.ts');
 const {Prisma}=api('@prisma/client');
 const id=`audit-template-${randomUUID()}`;
 const service=new BackupService(db,{get:()=>({validateConfig(){}})});
 const body={version:3,emailTemplates:[{id,projectId:null,code:id,name:'Notice',subject:'current',htmlBody:'current',variables:null,revision:2,draft:{subject:'draft'}}],templateRevisions:[{id:`${id}-history`,kind:'email',templateId:id,revision:1,snapshot:{name:'Notice',subject:'old',htmlBody:'old',variables:[]}}]};
 try {
  await service.importConfig(body);await service.importConfig(body);
  assert.equal((await db.emailTemplate.findUnique({where:{id}})).draft.subject,'draft');
  assert.equal(await db.templateRevision.count({where:{templateId:id}}),1);
  await new TemplateVersionsService(db).publish('email',id);
  assert.equal(await db.emailTemplate.count({where:{id,draft:{equals:Prisma.DbNull}}}),1);
 } finally {await db.templateRevision.deleteMany({where:{templateId:id}});await db.emailTemplate.deleteMany({where:{id}});}
});
test('dashboard aggregates bounded UTC buckets and distinguishes inbox acceptance',{skip:!db},async()=>{
 const {DashboardService}=require('../apps/api/src/dashboard/dashboard.service.ts');
 const project=await db.project.create({data:{name:'chart-test',apiKeyHash:randomUUID(),apiKeyPrefix:'audit'}});
 try {
  const createdAt=new Date();const deliveredAt=new Date(createdAt.getTime()+2500);
  await db.messageLog.createMany({data:[{projectId:project.id,source:'OPEN_API',status:'SUCCESS',channelType:'SMTP',createdAt,deliveredAt},{projectId:project.id,source:'OPEN_API',status:'SUCCESS',channelType:'INBOX',createdAt}]});
  const result=await new DashboardService(db).charts(7);
  assert.equal(result.trend.length,7);assert.equal(result.timezone,'UTC');
  const row=result.byProject.find(r=>r.projectId===project.id);
  assert.equal(row.count,2);assert.equal(row.delivered,1);assert.equal(row.latencyP95Ms,2500);
 } finally {await db.messageLog.deleteMany({where:{projectId:project.id}});await db.project.delete({where:{id:project.id}});}
});
test('sensitive retention redacts nullable bodies and keeps uncertain deliveries intact',{skip:!db},async()=>{
 const {RetentionService}=require('../apps/api/src/site/retention.service.ts');
 const ids=[randomUUID(),randomUUID()];const old=new Date(Date.now()-5*86400_000);
 const prior=await db.systemSetting.findUnique({where:{key:'sensitiveRetentionDays'}});
 try {
  await db.systemSetting.upsert({where:{key:'sensitiveRetentionDays'},create:{key:'sensitiveRetentionDays',value:'1'},update:{value:'1'}});
  await db.messageLog.createMany({data:[{id:ids[0],source:'OPEN_API',status:'SUCCESS',templateCode:'login',content:null,payload:{code:'123456'},attemptDetail:{secret:'123456'},createdAt:old},{id:ids[1],source:'OPEN_API',status:'FAILED',templateCode:'login',content:'123456',errorMessage:'DELIVERY_UNKNOWN: check provider',deliveryStartedAt:old,createdAt:old}]});
  await new RetentionService(db).run();
  const done=await db.messageLog.findUnique({where:{id:ids[0]}});const unknown=await db.messageLog.findUnique({where:{id:ids[1]}});
  assert.equal(done.content,'[已按保留策略脱敏]');assert.equal(done.attemptDetail,null);assert.equal(done.payload.code,undefined);
  assert.equal(unknown.content,'123456');
 }finally{
  await db.messageLog.deleteMany({where:{id:{in:ids}}});
  if(prior)await db.systemSetting.update({where:{key:prior.key},data:{value:prior.value}});else await db.systemSetting.delete({where:{key:'sensitiveRetentionDays'}});
 }
});
