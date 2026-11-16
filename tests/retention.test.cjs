const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {createRequire}=require('node:module');
const api=createRequire(path.resolve(__dirname,'../apps/api/package.json'));api('reflect-metadata');api('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../apps/api/tsconfig.json')});
test('activity retention is off by default and configured cleanup has a date boundary',async()=>{
 const {RetentionService}=require('../apps/api/src/site/retention.service.ts');let removed;
 const db={systemSetting:{findMany:async()=>[]},activityLog:{deleteMany:async q=>{removed=q;return {count:0};}},messageLog:{findMany:async()=>[]},scheduledMessage:{findMany:async()=>[]},idempotencyRecord:{deleteMany:async()=>({count:0})}};
 const service=new RetentionService(db);await service.run();assert.equal(removed,undefined);
 db.systemSetting.findMany=async()=>[{key:'activityRetentionDays',value:'30'}];await service.run();
 assert.ok(removed.where.createdAt.lt instanceof Date);
});
