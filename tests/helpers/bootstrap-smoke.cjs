const assert=require('node:assert/strict');const {createRequire}=require('node:module');const path=require('node:path');
const api=createRequire(path.resolve(__dirname,'../../apps/api/package.json'));
const u=new URL(process.env.AUDIT_SMOKE_DATABASE||'http://invalid');
if(u.hostname!=='127.0.0.1'||u.port!=='56487'||!/^\/msghub_audit_seed_[a-f0-9]{8}$/.test(u.pathname)||process.env.DATABASE_URL!==u.href||process.env.REDIS_PORT!=='56488')throw Error('Only isolated smoke database permitted');
api('reflect-metadata');const compiled=process.env.AUDIT_COMPILED==='true';if(!compiled)api('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../../apps/api/tsconfig.json')});
const load=file=>require(path.resolve(__dirname,compiled?'../../apps/api/dist/src':'../../apps/api/src',compiled?file.replace(/\.ts$/,'.js'):file));
(async()=>{
 const {NestFactory}=api('@nestjs/core');const {ValidationPipe}=api('@nestjs/common');const {AppModule}=load('app.module.ts');const {AllExceptionsFilter}=load('common/http-exception.filter.ts');
 const app=await NestFactory.create(AppModule,{logger:['error'],abortOnError:false});app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true,forbidNonWhitelisted:true}));app.useGlobalFilters(new AllExceptionsFilter());
 try{
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  for(const route of ['/api/health/live','/api/health','/api/health/ready']){const response=await fetch(base+route);assert.equal(response.status,200,route+':'+await response.text());}
  const schema=await fetch(base+'/api/openapi/schema');assert.equal(schema.status,200);assert.equal((await schema.json()).openapi,'3.0.3');
  assert.equal((await fetch(base+'/api/admin/auth/me')).status,401);
  const login=await fetch(base+'/api/admin/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD})});assert.equal(login.status,201);const token=(await login.json()).data.accessToken;
  assert.equal((await fetch(base+'/api/admin/auth/me',{headers:{authorization:'Bearer '+token}})).status,200);
  for(const route of ['/api/admin/devices','/api/admin/operations/version']){const response=await fetch(base+route,{headers:{authorization:'Bearer '+token}});assert.equal(response.status,200,route);assert.equal((await response.json()).success,true);}
  console.log('FULL_APP_BOOT_OK');
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exit(1);});
