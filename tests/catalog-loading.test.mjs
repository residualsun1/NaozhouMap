import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function client(kind,request,ready=Promise.resolve()){
  const listeners=new Map(),context={window:{NaozhouCloud:{ready,request}},crypto:webcrypto,URLSearchParams,
    document:{addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);}}};
  runInNewContext(await readFile(new URL('../'+kind+'-catalog.js',import.meta.url),'utf8'),context);
  return {api:context.window[kind==='people'?'PeopleArchive':'DeityAtlas'],access(reason){for(const fn of listeners.get('naozhou-access-change')||[])fn({detail:{reason}});}};
}
const records={people:{version:1,revision:1,editable:true,records:[{id:'person-stable',displayName:'测试',researchNotes:'private'}]},
  deity:{version:1,revision:1,titles:[],records:[{id:'deity-stable',name:'测试',aliases:[],titleIds:[]}]}};

for(const kind of ['people','deity'])test(kind+': map catalogs load on demand and coalesce concurrent reads',async()=>{
  let calls=0;const gate=defer(),{api}=await client(kind,async()=>{calls++;await gate.promise;return Response.json(records[kind]);});
  const catalog=api.createCatalog({lazy:true});await catalog.ready;assert.equal(calls,0);
  const first=catalog.ensure(),second=catalog.ensure();
  gate.resolve();await Promise.all([first,second]);await catalog.ensure();assert.equal(calls,1);
  assert.equal(catalog.state.records[0].id,records[kind].records[0].id);
});

test('initial session discovery does not duplicate a pending people read',async()=>{
  const auth=defer();let calls=0;const {api,access}=await client('people',async()=>{calls++;return Response.json(records.people);},auth.promise);
  const catalog=api.createCatalog();access('session');auth.resolve();await catalog.ready;assert.equal(calls,1);
});

test('logout immediately clears private people and rejects a stale in-flight result',async()=>{
  const gates=[defer(),defer()];let calls=0;
  const {api,access}=await client('people',async()=>{const index=calls++;if(index)await gates[index-1].promise;return Response.json(index===2?{...records.people,editable:false,records:[]}:records.people);});
  const catalog=api.createCatalog();await catalog.ready;assert.equal(catalog.state.records[0].researchNotes,'private');
  const stale=catalog.load();await Promise.resolve();access('logout');assert.equal(catalog.state,null);
  gates[0].resolve();await stale;assert.equal(catalog.state,null);
  const current=catalog.ensure();gates[1].resolve();await current;assert.equal(catalog.state.editable,false);assert.equal(catalog.state.records.length,0);
});

test('failed catalog reads can be retried',async()=>{
  let calls=0;const {api}=await client('people',async()=>++calls===1?new Response('',{status:503}):Response.json(records.people));
  const catalog=api.createCatalog({lazy:true});await assert.rejects(catalog.ensure());assert.equal(catalog.state,null);
  await catalog.ensure();assert.equal(calls,2);assert.equal(catalog.state.records[0].id,'person-stable');
});

test('saving into a lazy deity catalog preserves unrelated existing records',async()=>{
  let submitted;const {api}=await client('deity',async(_url,options)=>{
    if(options.method==='POST'){submitted=JSON.parse(options.body);return Response.json({...submitted,revision:2});}
    return Response.json(records.deity);
  });
  const catalog=api.createCatalog({lazy:true});await catalog.saveRecord({name:'新增测试',aliases:[],titleIds:[]});
  assert.equal(submitted.revision,1);assert.equal(submitted.records.length,2);assert.equal(submitted.records[0].id,'deity-stable');
});
