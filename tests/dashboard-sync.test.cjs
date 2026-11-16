const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const path=require('node:path');
const apiRequire=createRequire(path.resolve(__dirname,'../apps/api/package.json'));
apiRequire('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../apps/api/tsconfig.json')});apiRequire('reflect-metadata');
const {DashboardService}=require('../apps/api/src/dashboard/dashboard.service.ts');
test('notification delta orders updates and returns a tie-safe continuation cursor',async()=>{
  let query;const rows=[{id:'a',updatedAt:new Date('2026-01-01T00:00:01Z')},{id:'b',updatedAt:new Date('2026-01-01T00:00:01Z')},{id:'c',updatedAt:new Date('2026-01-01T00:00:02Z')}];
  const service=new DashboardService({messageLog:{findMany:async q=>{query=q;return rows;},count:async()=>0}});
  const result=await service.notifications('2026-01-01T00:00:00Z',2);
  assert.equal(result.items.length,2);assert.equal(result.hasMore,true);assert.ok(result.nextCursor);
  assert.deepEqual(query.orderBy,[{updatedAt:'asc'},{id:'asc'}]);
  await service.notifications(undefined,2,result.nextCursor);
  assert.equal(query.where.OR[1].id.gt,'b');
});
