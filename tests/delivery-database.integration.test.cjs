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
const ids=[];
after(async()=>{if(db){await db.project.deleteMany({where:{id:{in:ids}}});await db.$disconnect();}});
async function project(data={}){
 const id=`delivery-audit-${randomUUID()}`;
 const row=await db.project.create({data:{id,name:id,apiKeyHash:id,apiKeyPrefix:'audit',...data}});
 ids.push(id);return row;
}
test('real concurrent quota admits one of three reservations',{skip:!db},async()=>{
 const {EmailPolicyService}=require('../apps/api/src/email-policy/email-policy.service.ts');
 const p=await project({dailyEmailQuota:1});const service=new EmailPolicyService(db);
 const results=await Promise.allSettled([1,2,3].map(()=>service.reserveEmailLog({projectId:p.id,channelType:'SMTP',source:'OPEN_API',status:'PENDING'})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(results));
 assert.equal(await db.messageLog.count({where:{projectId:p.id}}),1);
});
test('real cancellation and executor claim cannot both win',{skip:!db},async()=>{
 const {SchedulesService}=require('../apps/api/src/schedules/schedules.service.ts');
 const p=await project();const service=new SchedulesService(db,{});
 for(let i=0;i<5;i++){
  const row=await db.scheduledMessage.create({data:{projectId:p.id,runAt:new Date()}});
  const [cancelled,claimed]=await Promise.allSettled([service.cancel(row.id),db.scheduledMessage.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'RUNNING'}})]);
  const state=await db.scheduledMessage.findUnique({where:{id:row.id}});
  assert.ok(['RUNNING','CANCELLED'].includes(state.status));
  assert.equal(Number(cancelled.status==='fulfilled')+Number(claimed.status==='fulfilled'&&claimed.value.count===1),1);
 }
});
test('real idempotency null JSON and owner fencing survive expiry',{skip:!db},async()=>{
 const {IdempotencyService}=require('../apps/api/src/common/idempotency.service.ts');
 const p=await project();const service=new IdempotencyService(db);const opts={projectId:p.id,key:'key',ttlMin:1};
 const first=await service.begin(opts);
 await db.idempotencyRecord.updateMany({where:{projectId:p.id},data:{expiresAt:new Date(0)}});
 assert.equal((await service.begin(opts)).inFlight,true);
 await service.commit({...opts,owner:first.owner,response:{value:1},messageId:'m1'});
 await db.idempotencyRecord.updateMany({where:{projectId:p.id},data:{expiresAt:new Date(0)}});
 const second=await service.begin(opts);assert.notEqual(second.owner,first.owner);
 await assert.rejects(service.commit({...opts,owner:first.owner,response:{value:2}}),/ownership/);
 await service.release({...opts,owner:first.owner});assert.equal(await db.idempotencyRecord.count({where:{projectId:p.id}}),1);
 await service.release({...opts,owner:second.owner});assert.equal(await db.idempotencyRecord.count({where:{projectId:p.id}}),0);
});
test('real cleanup protects queued logs and scheduled references',{skip:!db},async()=>{
 const {MessagesService}=require('../apps/api/src/messages/messages.service.ts');
 const p=await project();const old=new Date('2020-01-01');
 const queued=await db.messageLog.create({data:{projectId:p.id,status:'PENDING',source:'OPEN_API',createdAt:old}});
 const referenced=await db.messageLog.create({data:{projectId:p.id,status:'SUCCESS',source:'OPEN_API',createdAt:old}});
 const removable=await db.messageLog.create({data:{projectId:p.id,status:'FAILED',source:'OPEN_API',createdAt:old}});
 await db.scheduledMessage.create({data:{projectId:p.id,runAt:new Date(),messageId:referenced.id}});
 const result=await new MessagesService(db).cleanup({projectId:p.id,before:'2021-01-01'});
 assert.equal(result.deleted,1);assert.ok(await db.messageLog.findUnique({where:{id:queued.id}}));assert.ok(await db.messageLog.findUnique({where:{id:referenced.id}}));assert.equal(await db.messageLog.findUnique({where:{id:removable.id}}),null);
});
test('real uncertain task resolution uses compare-and-set',{skip:!db},async()=>{
 const {SchedulesService}=require('../apps/api/src/schedules/schedules.service.ts');
 const p=await project();const row=await db.scheduledMessage.create({data:{projectId:p.id,runAt:new Date(),status:'UNCERTAIN'}});const service=new SchedulesService(db,{});
 const results=await Promise.allSettled([service.resolve(row.id,{action:'delivered'}),service.resolve(row.id,{action:'retry',acknowledgeDuplicateRisk:true})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
