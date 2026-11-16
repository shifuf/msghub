const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const api=createRequire(path.resolve(__dirname,'../apps/api/package.json'));
api('reflect-metadata');api('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../apps/api/tsconfig.json')});
const load=name=>require(path.resolve(__dirname,'../apps/api/src',name));
const redisUrl=process.env.AUDIT_REDIS_URL;
const databaseUrl=process.env.AUDIT_DATABASE_URL;
if(redisUrl){const u=new URL(redisUrl);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='56488')throw Error('Use isolated loopback Redis on audit port 56488 only');process.env.REDIS_HOST=u.hostname;process.env.REDIS_PORT=u.port;process.env.REDIS_PASSWORD=u.password;}
if(databaseUrl){const u=new URL(databaseUrl);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.port!=='56487'||u.pathname!=='/msghub_audit')throw Error('Use isolated loopback audit PostgreSQL only');}

test('real Redis shared throttling atomically admits the configured number across instances',{skip:!redisUrl},async()=>{
 const {RedisThrottleStorage}=load('common/redis-throttle.storage.ts');const a=new RedisThrottleStorage(),b=new RedisThrottleStorage();
 try{const key=randomUUID();const results=await Promise.all(Array.from({length:40},(_,i)=>(i%2?a:b).increment(key,5000,7,5000,'default')));assert.equal(results.filter(r=>!r.isBlocked).length,7);assert.ok(results.filter(r=>r.isBlocked).every(r=>r.timeToBlockExpire>0));}
 finally{a.onModuleDestroy();b.onModuleDestroy();}
});

test('real project limit is shared, expiring and reconnects after a dropped connection',{skip:!redisUrl},async()=>{
 const {ProjectRateLimitService}=load('common/project-rate-limit.service.ts');const Redis=api('ioredis');const client=new Redis(redisUrl);const a=new ProjectRateLimitService(),b=new ProjectRateLimitService();const project=randomUUID();
 const ready=service=>new Promise((resolve,reject)=>{if(service.redis.status==='ready'){resolve();return;}const timer=setTimeout(()=>reject(Error('initial Redis readiness timeout')),5000);service.redis.once('ready',()=>{clearTimeout(timer);resolve();});});
 try{
  await Promise.all([ready(a),ready(b)]);
  const results=await Promise.all(Array.from({length:30},(_,i)=>(i%2?a:b).check(project,5)));
  assert.equal(results.filter(r=>r.allowed).length,5);
  const keys=await client.keys('rl:project:'+project+':*');assert.equal(keys.length,1);assert.ok(await client.ttl(keys[0])>0);
  const reconnected=readyAfterReconnect(a);a.redis.connector.stream.destroy();await reconnected;
  assert.equal((await a.check(project+'-new',5)).allowed,true);
  await client.del(...keys);
 }finally{a.onModuleDestroy();b.onModuleDestroy();await client.quit();}
 function readyAfterReconnect(service){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('reconnect timeout')),5000);service.redis.once('ready',()=>{clearTimeout(timer);resolve();});});}
});

test('project limit recovers after Redis is unavailable during construction',{skip:!redisUrl},async()=>{
 const net=require('node:net');const {ProjectRateLimitService}=load('common/project-rate-limit.service.ts');
 const proxy=net.createServer(socket=>{const upstream=net.connect(56488,'127.0.0.1');socket.pipe(upstream);upstream.pipe(socket);socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const port=proxy.address().port;await new Promise(resolve=>proxy.close(resolve));
 const old=process.env.REDIS_PORT;process.env.REDIS_PORT=String(port);const service=new ProjectRateLimitService();process.env.REDIS_PORT=old;
 const client=service.redis;let timer;
 try{
  await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('initial connection did not fail')),3000);client.once('error',()=>{clearTimeout(timer);resolve();});});
  assert.equal((await service.check('initial-outage',2)).allowed,false);assert.equal(service.redis,client);
  const recovered=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('initial outage did not recover')),5000);client.once('ready',()=>{clearTimeout(timer);resolve();});});
  await new Promise(resolve=>proxy.listen(port,'127.0.0.1',resolve));await recovered;
  assert.equal((await service.check(randomUUID(),2)).allowed,true);
 }finally{clearTimeout(timer);service.onModuleDestroy();if(proxy.listening)await new Promise(resolve=>proxy.close(resolve));}
});

test('real Redis broadcasts between realtime instances without duplicate local events',{skip:!redisUrl},async()=>{
 const {RealtimeService}=load('realtime/realtime.service.ts');const a=new RealtimeService(),b=new RealtimeService();await Promise.all([a.onModuleInit(),b.onModuleInit()]);
 const id=randomUUID();let seenA=0,seenB=0;let receive;const delivered=new Promise(resolve=>receive=resolve);
 const sa=a.stream().subscribe(e=>{if(e.type==='message'&&JSON.parse(e.data).data.id===id)seenA++;});
 const sb=b.stream().subscribe(e=>{if(e.type==='message'&&JSON.parse(e.data).data.id===id){seenB++;receive();}});
 let timer;
 try{a.emitMessage({id});await Promise.race([delivered,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Redis pubsub timeout')),2000))]);assert.equal(seenA,1);assert.equal(seenB,1);}
 finally{clearTimeout(timer);sa.unsubscribe();sb.unsubscribe();a.onModuleDestroy();b.onModuleDestroy();}
});

test('real readiness detects worker absence, active worker and paused queue',{skip:!redisUrl||!databaseUrl},async()=>{
 const {Queue,Worker}=api('bullmq');const {PrismaClient}=api('@prisma/client');const {HealthController}=load('health/health.controller.ts');
 const connection={host:'127.0.0.1',port:56488};const queue=new Queue('audit-readiness-'+randomUUID(),{connection});const db=new PrismaClient({datasources:{db:{url:databaseUrl}}});const controller=new HealthController(db,queue);let worker;
 try{await assert.rejects(controller.check(),e=>e.getStatus()===503);worker=new Worker(queue.name,async()=>{}, {connection});await worker.waitUntilReady();assert.equal((await controller.check()).data.status,'ok');await queue.pause();await assert.rejects(controller.check(),e=>e.getStatus()===503);assert.equal(controller.live().data.status,'ok');}
 finally{await worker?.close();await queue.obliterate({force:true});await queue.close();await db.$disconnect();}
});

test('real Nest HTTP login, scoped ticket, revocation and encrypted TOTP flow',{skip:!redisUrl||!databaseUrl},async()=>{
 process.env.DATABASE_URL=databaseUrl;process.env.APP_ENV='development';process.env.JWT_SECRET='Integration-secret-9R4d7Hv3Nz28Qm5Tt8';
 const {Module,ValidationPipe}=api('@nestjs/common');const {ConfigModule}=api('@nestjs/config');const {NestFactory}=api('@nestjs/core');const {JwtService}=api('@nestjs/jwt');
 const {PrismaModule}=load('prisma/prisma.module.ts');const {PrismaService}=load('prisma/prisma.service.ts');const {AuthModule}=load('auth/auth.module.ts');const {JwtStrategy}=load('auth/jwt.strategy.ts');const {RealtimeModule}=load('realtime/realtime.module.ts');const {AllExceptionsFilter}=load('common/http-exception.filter.ts');const {configureBodyParsers}=load('common/body-parser.ts');const {totpCode}=load('auth/totp.util.ts');
 class HttpModule{};Module({imports:[ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true}),PrismaModule,AuthModule,RealtimeModule]})(HttpModule);
 const app=await NestFactory.create(HttpModule,{logger:false,bodyParser:false});
 configureBodyParsers(app.getHttpAdapter().getInstance(),async req=>{const token=String(req.headers.authorization||'').slice(7);const payload=await app.get(JwtService).verifyAsync(token);await app.get(JwtStrategy).validate(payload);});
 app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));app.useGlobalFilters(new AllExceptionsFilter());
 const db=app.get(PrismaService);const username='audit-'+randomUUID();const password='Strong-audit-password-38!';const user=await db.adminUser.create({data:{username,passwordHash:await api('bcryptjs').hash(password,4)}});
 let url;const request=async(endpoint,body,token)=>{const response=await fetch(url+endpoint,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  await app.listen(0,'127.0.0.1');url=await app.getUrl();
  const login=await request('/api/admin/auth/login',{username,password});assert.equal(login.status,201);let token=login.body.data.accessToken;
  const ticket=await request('/api/admin/realtime/ticket',{},token);assert.equal(ticket.status,201);
  assert.equal((await request('/api/admin/auth/me',undefined,ticket.body.data.ticket)).status,401);
  const abort=new AbortController();const abortTimer=setTimeout(()=>abort.abort(),5000);
  try{
   const stream=await fetch(url+'/api/admin/realtime/stream?ticket='+encodeURIComponent(ticket.body.data.ticket),{signal:abort.signal});assert.equal(stream.status,200);
   const reader=stream.body.getReader();let received='';while(!received.includes('ready')){const chunk=await reader.read();assert.equal(chunk.done,false);received+=Buffer.from(chunk.value).toString();}
   assert.equal((await request('/api/admin/auth/revoke-sessions',{},token)).status,201);
   const {RealtimeService}=load('realtime/realtime.service.ts');app.get(RealtimeService).emitMessage({id:'must-not-reach-revoked-session'});
   while(true){const chunk=await reader.read();if(chunk.done)break;received+=Buffer.from(chunk.value).toString();}
   assert.ok(!received.includes('must-not-reach-revoked-session'));
  }finally{clearTimeout(abortTimer);abort.abort();}
  assert.equal((await request('/api/admin/auth/me',undefined,token)).status,401);
  token=(await request('/api/admin/auth/login',{username,password})).body.data.accessToken;
  const enrollment=await request('/api/admin/auth/totp/setup',{password},token);assert.equal(enrollment.status,201);const secret=enrollment.body.data.secret;
  const stored=await db.adminUser.findUnique({where:{id:user.id}});assert.ok(stored.totpPendingSecret.startsWith('v1.'));assert.ok(!stored.totpPendingSecret.includes(secret));
  // Previous accepted timestep enables TOTP; current timestep permits immediate login without reusing a code.
  const step=Math.floor(Date.now()/30000);
  assert.equal((await request('/api/admin/auth/totp/enable',{code:totpCode(secret,step-1)},token)).status,201);
  assert.equal((await request('/api/admin/auth/me',undefined,token)).status,401);
  assert.equal((await request('/api/admin/auth/login',{username,password})).status,401);
  const secured=await request('/api/admin/auth/login',{username,password,code:totpCode(secret,step)});assert.equal(secured.status,201);
  assert.equal((await request('/api/admin/auth/login',{username,password,code:totpCode(secret,step)})).status,401);
  assert.equal((await request('/api/admin/auth/change-password',{oldPassword:password,newPassword:'New-strong-password-49!'},secured.body.data.accessToken)).status,201);
  assert.equal((await request('/api/admin/auth/me',undefined,secured.body.data.accessToken)).status,401);
 }finally{await db.adminUser.delete({where:{id:user.id}});await app.close();}
});
