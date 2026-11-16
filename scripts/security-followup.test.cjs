const assert = require('node:assert/strict');
const {test} = require('node:test');
const path = require('node:path');
const {createRequire} = require('node:module');
const api = createRequire(path.resolve(__dirname,'../apps/api/package.json'));
api('reflect-metadata');
api('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../apps/api/tsconfig.json')});
const load = name => require(path.resolve(__dirname,'../apps/api/src',name));
const config={get:key=>key==='JWT_SECRET'?'strong-encryption-test-secret-3Rj9@9wF8':undefined};

test('TOTP storage encrypts secrets, binds identity and rejects tampering/expiry',()=>{
  const {sealTotp,openTotp}=load('auth/totp-storage.util.ts');
  const stored=sealTotp('JBSWY3DPEHPK3PXP',config,'u1:pending',Date.now()+1000);
  assert.ok(!stored.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(openTotp(stored,config,'u1:pending'),'JBSWY3DPEHPK3PXP');
  assert.throws(()=>openTotp(stored,config,'u2:pending'));
  assert.throws(()=>openTotp(stored.slice(0,-4)+'AAAA',config,'u1:pending'));
  assert.throws(()=>openTotp(stored,config,'u1:pending',Date.now()+2000));
  assert.throws(()=>openTotp('JBSWY3DPEHPK3PXP',config,'u1:pending'));
});

test('TOTP setup stores ciphertext and refuses to overwrite a concurrently replaced setup',async()=>{
  const {AuthService}=load('auth/auth.service.ts');
  const {openTotp}=load('auth/totp-storage.util.ts');
  const bcrypt=api('bcryptjs');
  const user={id:'u1',username:'admin',passwordHash:await bcrypt.hash('password',4),tokenVersion:1,totpEnabled:false,totpPendingSecret:null};
  let race=false;
  const prisma={adminUser:{findUnique:async()=>({...user}),updateMany:async({where,data})=>{
    if(race)user.totpPendingSecret='newer-settings';
    if(where.tokenVersion!==user.tokenVersion||where.totpPendingSecret!==user.totpPendingSecret)return {count:0};
    Object.assign(user,data);return {count:1};
  }}};
  const auth=new AuthService(prisma,{},config);
  const result=await auth.setupTotp('u1','password',1);
  assert.notEqual(user.totpPendingSecret,result.secret);
  assert.equal(openTotp(user.totpPendingSecret,config,'u1:pending'),result.secret);
  race=true;
  await assert.rejects(auth.setupTotp('u1','password',1),/变更/);
  assert.equal(user.totpPendingSecret,'newer-settings');
  await assert.rejects(auth.setupTotp('u1','password',0),/会话/);
});

test('TOTP enable refuses expired enrollment and stale session',async()=>{
  const {AuthService}=load('auth/auth.service.ts');
  const {sealTotp}=load('auth/totp-storage.util.ts');
  const {totpCode}=load('auth/totp.util.ts');
  const secret='JBSWY3DPEHPK3PXP';
  const user={id:'u1',tokenVersion:2,totpEnabled:false,totpPendingSecret:sealTotp(secret,config,'u1:pending',Date.now()-1000)};
  let changed=false;
  const auth=new AuthService({adminUser:{findUnique:async()=>user,updateMany:async()=>{changed=true;return {count:1};}}},{},config);
  await assert.rejects(auth.enableTotp('u1',totpCode(secret,Math.floor(Date.now()/30000)),2));
  user.totpPendingSecret=sealTotp(secret,config,'u1:pending',Date.now()+600000);
  await assert.rejects(auth.enableTotp('u1',totpCode(secret,Math.floor(Date.now()/30000)),1),/会话/);
  assert.equal(changed,false);
});

test('readiness reports DB, Redis and worker failures while liveness remains available',async()=>{
  const {HealthController}=load('health/health.controller.ts');
  const queue={client:Promise.resolve({ping:async()=> 'PONG'}),getWorkers:async()=>[{id:'worker'}],isPaused:async()=>false,getJobCounts:async()=>({waiting:2,active:1,failed:0,delayed:0})};
  const controller=new HealthController({$queryRaw:async()=>[{ok:1}]},queue);
  assert.equal(controller.live().data.status,'ok');
  assert.equal((await controller.check()).data.status,'ok');
  queue.getWorkers=async()=>[];
  await assert.rejects(controller.check(),error=>error.getStatus()===503 && error.getResponse().error.code==='NOT_READY');
  queue.getWorkers=async()=>[{id:'worker'}];
  queue.client=Promise.resolve({ping:async()=>{throw new Error('redis failed');}});
  await assert.rejects(controller.check(),error=>error.getStatus()===503);
  const hanging=new HealthController({$queryRaw:()=>new Promise(()=>{})},queue);
  const started=Date.now();
  await assert.rejects(hanging.check(),error=>error.getStatus()===503);
  assert.ok(Date.now()-started<3000);
});

test('expired realtime ticket cannot establish a connection',async()=>{
  const {RealtimeController}=load('realtime/realtime.controller.ts');
  const {JwtService}=api('@nestjs/jwt');
  const jwt=new JwtService({secret:'test-secret-at-least-32-random-characters'});
  const controller=new RealtimeController({},jwt,{adminUser:{findUnique:async()=>({tokenVersion:1})}});
  const ticket=jwt.sign({sub:'u1',ver:1},{audience:'realtime',expiresIn:-1});
  await assert.rejects(controller.stream(ticket),error=>error.getStatus()===401);
});

test('backup parser authenticates before allowing large JSON and limits other Express 5 routes',async()=>{
  const {configureBodyParsers}=load('common/body-parser.ts');
  const {NestFactory}=api('@nestjs/core');
  const {Module}=api('@nestjs/common');
  class TestModule {}
  Module({})(TestModule);
  const app=await NestFactory.create(TestModule,{logger:false,bodyParser:false});
  const express=app.getHttpAdapter().getInstance();
  configureBodyParsers(express,async req=>{if(req.headers.authorization!=='Bearer accepted')throw new Error('unauthorized');});
  express.post('/api/admin/backup/preview',(req,res)=>res.json({size:req.body.data.length}));
  express.post('/api/webhook',(req,res)=>res.json({ok:true}));
  await app.listen(0,'127.0.0.1');
  const url=await app.getUrl();
  const body=JSON.stringify({data:'x'.repeat(300*1024)});
  try {
    assert.equal((await fetch(url+'/api/admin/backup/preview',{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
    const large=await fetch(url+'/api/admin/backup/preview?dryRun=true',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer accepted'},body});
    assert.equal(large.status,200);
    assert.equal((await large.json()).size,300*1024);
    assert.equal((await fetch(url+'/api/webhook',{method:'POST',headers:{'content-type':'application/json'},body})).status,413);
    assert.equal((await fetch(url+'/api/admin/backup/preview',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer accepted'},body:JSON.stringify({data:'x'.repeat(21*1024*1024)})})).status,413);
  } finally {await app.close();}
});

test('Redis realtime forwards across instances once and tolerates malformed envelopes',async()=>{
  const {RealtimeService}=load('realtime/realtime.service.ts');
  const {EventEmitter}=require('node:events');
  const clients=[];
  class FakeRedis extends EventEmitter {
    async connect(){} async subscribe(){} disconnect(){}
    async publish(channel,payload){for(const client of clients)client.emit('message',channel,payload);return clients.length;}
  }
  const make=()=>{const value=new FakeRedis();clients.push(value);return value;};
  const a=new RealtimeService(),b=new RealtimeService();
  a.createRedis=make;b.createRedis=make;
  await a.onModuleInit();await b.onModuleInit();
  const seenA=[],seenB=[];
  const sa=a.stream().subscribe(event=>{if(event.type==='message')seenA.push(JSON.parse(event.data).data.id);});
  const sb=b.stream().subscribe(event=>{if(event.type==='message')seenB.push(JSON.parse(event.data).data.id);});
  try {
    a.emitMessage({id:'m1'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(seenA,['m1']);assert.deepEqual(seenB,['m1']);
    for(const client of clients)client.emit('message','msghub:realtime:v1','{bad');
    b.emitMessage({id:'m2'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(seenA,['m1','m2']);assert.deepEqual(seenB,['m1','m2']);
  } finally {sa.unsubscribe();sb.unsubscribe();a.onModuleDestroy();b.onModuleDestroy();}
});

test('project rate limit fails closed without Redis and closes its connection',async()=>{
  const {ProjectRateLimitService}=load('common/project-rate-limit.service.ts');
  const service=Object.create(ProjectRateLimitService.prototype);
  service.logger={warn:()=>{},debug:()=>{}};service.redis=null;service.memory=new Map();
  assert.equal((await service.check('p1',3)).allowed,false);
  assert.equal((await service.check('p1',0)).allowed,true);
  let disconnected=false;
  service.redis={disconnect:()=>{disconnected=true;},status:'ready',eval:async()=>{throw Error('offline');}};
  assert.equal((await service.check('p1',3)).allowed,false);
  service.onModuleDestroy();assert.equal(disconnected,true);
});
