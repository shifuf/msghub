const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const apiRequire = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
apiRequire('ts-node').register({transpileOnly:true,project:path.resolve(__dirname,'../apps/api/tsconfig.json')});
apiRequire('reflect-metadata');

test('draft leaves live content intact, publish saves history, rollback creates a new revision',async()=>{
  const { TemplateVersionsService } = require('../apps/api/src/templates/template-versions.service.ts');
  const row={id:'t1',name:'A',subject:'old',htmlBody:'<p>old</p>',variables:[],revision:1,draft:null}; const history=[];
  const model={findUnique:async()=>({...row}),update:async({data})=>{Object.assign(row,data);return {...row};},updateMany:async({where,data})=>{if(where.revision!==row.revision)return {count:0};Object.assign(row,data);return {count:1};}};
  const db={emailTemplate:model,templateRevision:{create:async({data})=>{history.push(data);return data;},findFirst:async({where})=>history.find(x=>x.revision===where.revision),findMany:async()=>history}}; db.$transaction=async fn=>fn(db);
  const versions=new TemplateVersionsService(db);
  await versions.saveDraft('email','t1',{subject:'new'}); assert.equal(row.subject,'old');
  await versions.publish('email','t1'); assert.equal(row.subject,'new');assert.equal(row.revision,2);assert.equal(history[0].snapshot.subject,'old');
  await versions.rollback('email','t1',1);assert.equal(row.subject,'old');assert.equal(row.revision,3);
});
test('saving a stale draft cannot overwrite a concurrently published revision',async()=>{
 const {TemplateVersionsService}=require('../apps/api/src/templates/template-versions.service.ts');
 const row={id:'t1',name:'A',subject:'newly published',htmlBody:'x',revision:2};
 const db={emailTemplate:{findUnique:async()=>({...row,revision:1}),update:async({data})=>Object.assign(row,data),updateMany:async()=>({count:0})}};
 await assert.rejects(new TemplateVersionsService(db).saveDraft('email','t1',{subject:'stale'}),/更新|刷新/);
 assert.equal(row.draft,undefined);
});
test('preview renders saved draft while send resolution stays published',async()=>{
 const {TemplatesService}=require('../apps/api/src/templates/templates.service.ts');
 const {PushTemplatesService}=require('../apps/api/src/push-templates/push-templates.service.ts');
 const email={id:'e',subject:'live {{who}}',htmlBody:'live',textBody:null,draft:{subject:'draft {{who}}',htmlBody:'draft'}};
 const push={id:'p',titleTpl:'live',contentTpl:'live',draft:{titleTpl:'draft {{who}}',contentTpl:'draft'}};
 const db={emailTemplate:{findUnique:async()=>email,findFirst:async()=>email},pushTemplate:{findUnique:async()=>push,findFirst:async()=>push}};
 const e=new TemplatesService(db,{}),p=new PushTemplatesService(db,{});
 assert.equal((await e.preview('e',{who:'Alice'})).subject,'draft Alice');
 assert.equal((await p.preview('p',{who:'Alice'})).title,'draft Alice');
 assert.equal((await e.resolve('project','test')).subject,'live {{who}}');
 assert.equal((await p.renderForSend('project','test')).content,'live');
});
