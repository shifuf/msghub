const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { createRequire } = require('node:module');
const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('reflect-metadata');
api('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
const load = (file) => require(path.resolve(__dirname, '../apps/api/src', file));
const { UnauthorizedException, HttpException } = api('@nestjs/common');

test('mapped loopback and non-global IPv6 addresses are rejected', async () => {
  const { assertSafeOutboundUrl, isPrivateIp } = load('adapters/http.util.ts');
  for (const ip of ['::ffff:7f00:1', '::ffff:c0a8:101', 'febf::1', '2001:db8::1']) assert.equal(isPrivateIp(ip), true, ip);
  await assert.rejects(assertSafeOutboundUrl('https://[::ffff:127.0.0.1]/'));
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
});

test('JWT rejects absent identity, stale sessions, missing users and realtime tickets', async () => {
  const { JwtStrategy } = load('auth/jwt.strategy.ts');
  const user = { id: 'u1', username: 'admin', tokenVersion: 3 };
  const strategy = new JwtStrategy({ get: () => 'test-secret-at-least-32-random-characters' }, { adminUser: { findUnique: async ({where}) => where.id === 'u1' ? user : null } });
  for (const payload of [{}, {sub:'missing', ver:3}, {sub:'u1', ver:2}, {sub:'u1', ver:3, aud:'realtime'}, {sub:'u1'}]) {
    await assert.rejects(async () => strategy.validate(payload), UnauthorizedException);
  }
  assert.equal((await strategy.validate({sub:'u1', ver:3})).id, 'u1');
});

test('structured errors retain safe business details and never leak internal errors', () => {
  const { AllExceptionsFilter } = load('common/http-exception.filter.ts');
  let body;
  const res = {status: () => res, json: value => {body=value;}};
  const host = {switchToHttp: () => ({getResponse: () => res})};
  new AllExceptionsFilter().catch(new HttpException({error:{code:'RATE_LIMITED',message:'Please retry'},data:{messageId:'m1'}},429),host);
  assert.deepEqual(body, {success:false,error:{code:'RATE_LIMITED',message:'Please retry'},data:{messageId:'m1'}});
  new AllExceptionsFilter().catch(new Error('password=secret'),host);
  assert.equal(body.error.message,'服务器内部错误');
  new AllExceptionsFilter().catch(new HttpException('database password=secret',500),host);
  assert.equal(body.error.message,'服务器内部错误');
});

test('invalid activity cleanup date cannot become an unfiltered deletion', async () => {
  const { ActivityService } = load('activity/activity.service.ts');
  let deleted = false;
  const service = new ActivityService({activityLog:{deleteMany:async()=>{deleted=true;return {count:10};}}});
  await assert.rejects(service.clear({before:'not-a-date'}), /日期/);
  assert.equal(deleted,false);
});

test('activity cleanup preview counts matching rows without deleting', async () => {
  const { ActivityService } = load('activity/activity.service.ts');
  let deleted = false;
  const service = new ActivityService({activityLog:{count:async({where})=>where.createdAt.lt.toISOString()==='2026-01-01T00:00:00.000Z'?3:100,deleteMany:async()=>{deleted=true;return {count:3};}}});
  const result=await service.clear({before:'2026-01-01T00:00:00.000Z',dryRun:true});
  assert.equal(result.matched,3);
  assert.equal(deleted,false);
});

test('production startup rejects known secrets and unsafe bootstrap passwords', () => {
  const { validateSecurityEnvironment } = load('common/env.ts');
  for(const value of ['', 'dev-secret-change-me', 'change-me-to-a-long-random-string-in-production', 'a'.repeat(40)]) {
    assert.throws(()=>validateSecurityEnvironment({APP_ENV:'production',JWT_SECRET:value,ADMIN_PASSWORD:'Unique-password-692!'}));
  }
  assert.throws(()=>validateSecurityEnvironment({APP_ENV:'production',JWT_SECRET:'A1-mixed-random-value-Mg79QvfsKxE9LX',ADMIN_PASSWORD:'ChangeMe@123456'}));
  assert.doesNotThrow(()=>validateSecurityEnvironment({APP_ENV:'production',JWT_SECRET:'A1-mixed-random-value-Mg79QvfsKxE9LX',ADMIN_PASSWORD:'Unique-password-692!'}));
});

test('JWT lifetime parses units and rejects malformed or unbounded values', () => {
  const {resolveJwtLifetime} = load('common/env.ts');
  assert.equal(resolveJwtLifetime('7d'),604800);
  assert.equal(resolveJwtLifetime('2h'),7200);
  for(const value of ['forever','0','999d']) assert.throws(()=>resolveJwtLifetime(value));
});

test('password change and session revocation invalidate signed sessions', async () => {
  const { AuthService } = load('auth/auth.service.ts');
  const bcrypt = api('bcryptjs');
  const user = {id:'u1',username:'admin',tokenVersion:0,passwordHash:await bcrypt.hash('old-password',4)};
  const prisma={adminUser:{findUnique:async()=>user, update:async({data})=>{if(data.tokenVersion)user.tokenVersion+=data.tokenVersion.increment; if(data.passwordHash)user.passwordHash=data.passwordHash;return user;}}};
  const auth = new AuthService(prisma,{signAsync:async payload=>payload},{get:()=>undefined});
  const login = await auth.login('admin','old-password');
  assert.equal(login.accessToken.ver,0);
  await auth.changePassword('u1','old-password','new-strong-password');
  assert.equal(user.tokenVersion,1);
  await auth.revokeSessions('u1');
  assert.equal(user.tokenVersion,2);
});

test('TOTP matches RFC 6238 and rejects invalid codes', () => {
  const {totpCode, verifyTotp} = load('auth/totp.util.ts');
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpCode(secret,1), '287082');
  assert.equal(verifyTotp(secret,'287082',59000),1);
  assert.equal(verifyTotp(secret,'000000',59000),null);
});

test('SSE accepts only scoped tickets and revalidates the backing session', async () => {
  const {RealtimeController} = load('realtime/realtime.controller.ts');
  const {JwtService} = api('@nestjs/jwt');
  const {of} = api('rxjs');
  const jwt = new JwtService({secret:'test-secret-at-least-32-random-characters'});
  const user = {id:'u1',tokenVersion:4};
  const controller = new RealtimeController({stream:()=>of({type:'ready',data:'ok'})},jwt,{adminUser:{findUnique:async()=>user}});
  const {data:{ticket}} = await controller.ticket({user:{id:'u1',tokenVersion:4}});
  await assert.rejects(async()=>controller.stream(jwt.sign({sub:'u1',ver:4})), UnauthorizedException);
  await controller.stream(ticket);
  user.tokenVersion++;
  await assert.rejects(async()=>controller.stream(ticket), UnauthorizedException);
});

test('outbound HTTP enforces private-target opt-in and bounded responses', async () => {
  const http = require('node:http');
  const {fetchJson} = load('adapters/http.util.ts');
  const server = http.createServer((req,res)=>res.end(req.url === '/large' ? 'x'.repeat(2048) : '{"delivered":true}'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(fetchJson(url), /HTTPS|内网/);
    const result = await fetchJson(url, {}, 2000, {allowHttp:true,allowPrivate:true});
    assert.deepEqual(result.data,{delivered:true});
    await assert.rejects(fetchJson(url+'/large',{},2000,{allowHttp:true,allowPrivate:true,maxResponseBytes:1024}), /响应/);
    const dns = require('node:dns/promises');
    const originalLookup = dns.lookup;
    let lookups = 0;
    dns.lookup = async () => { lookups++; return [{address: lookups === 1 ? '127.0.0.1' : '192.0.2.1',family:4}]; };
    try {
      const pinned = await fetchJson(`http://rebind-test.invalid:${server.address().port}`,{},2000,{allowHttp:true,allowPrivate:true});
      assert.deepEqual(pinned.data,{delivered:true});
      assert.equal(lookups,1);
    } finally {dns.lookup=originalLookup;}
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('SSE stops before delivering events after session revocation', async () => {
  const {RealtimeController} = load('realtime/realtime.controller.ts');
  const {JwtService} = api('@nestjs/jwt');
  const {Subject} = api('rxjs');
  const jwt = new JwtService({secret:'test-secret-at-least-32-random-characters'});
  const events = new Subject();
  const user = {id:'u1',tokenVersion:1};
  const controller = new RealtimeController({stream:()=>events},jwt,{adminUser:{findUnique:async()=>user}});
  const {data:{ticket}} = await controller.ticket({user:{id:'u1',tokenVersion:1}});
  const stream = await controller.stream(ticket);
  const seen = [];
  const subscription = stream.subscribe(value=>seen.push(value));
  try {
    events.next({data:'before'});
    await new Promise(resolve=>setImmediate(resolve));
    user.tokenVersion++;
    events.next({data:'after'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(seen,[{data:'before'}]);
    assert.equal(subscription.closed,true);
  } finally {subscription.unsubscribe();}
});

test('TOTP enabled login consumes a code once and refuses subsequent reuse', async () => {
  const {AuthService} = load('auth/auth.service.ts');
  const {totpCode} = load('auth/totp.util.ts');
  const {sealTotp} = load('auth/totp-storage.util.ts');
  const bcrypt = api('bcryptjs');
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const config = {get:key=>key==='JWT_SECRET'?'test-secret-at-least-32-random-characters':undefined};
  const user = {id:'u1',username:'admin',passwordHash:await bcrypt.hash('password',4),tokenVersion:0,totpEnabled:true,totpSecret:sealTotp(secret,config,'u1:active'),totpLastCounter:null};
  const prisma={adminUser:{findUnique:async()=>user,update:async()=>user,updateMany:async({data})=>{
    if(user.totpLastCounter !== null && user.totpLastCounter >= data.totpLastCounter)return {count:0};
    user.totpLastCounter=data.totpLastCounter;return {count:1};
  }}};
  const auth = new AuthService(prisma,{signAsync:async payload=>payload},config);
  const code=totpCode(secret,Math.floor(Date.now()/30000));
  await auth.login('admin','password',code);
  await assert.rejects(auth.login('admin','password',code),/已使用/);
  await assert.rejects(auth.login('admin','password'),/验证码/);
});

test('shared throttling fails closed when Redis is unavailable', async () => {
  const {RedisThrottleStorage} = load('common/redis-throttle.storage.ts');
  const storage = new RedisThrottleStorage();
  storage.redis = {eval:async()=>{throw new Error('offline');},disconnect:()=>{}};
  await assert.rejects(storage.increment('request-hash',60000,10,60000,'default'), /限流服务暂不可用/);
  storage.onModuleDestroy();
});
