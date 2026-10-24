import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLocalArchiveStore } from '../local-archive-bridge.mjs';
import { deitySeed } from '../netlify/lib/deities.mjs';

const workspace=path.resolve(fileURLToPath(new URL('../work/',import.meta.url)));
async function isolated(run) {
  const root=path.join(workspace,'local-archive-test-'+randomUUID()),data=path.join(root,'data');
  await mkdir(data,{recursive:true});
  try{return await run(data);}
  finally {
    const relative=path.relative(workspace,root);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unsafe test cleanup path.');
    await rm(root,{recursive:true,force:true});
  }
}

test('legacy fallback reads exact local documents without creating or changing any file',()=>isolated(async data=>{
  const faith={version:1,revision:7,records:[{id:'local-faith',villageId:'village',deities:['地方称谓']}]};
  const bytes='\uFEFF'+JSON.stringify(faith,null,2);
  await writeFile(path.join(data,'village-faith.json'),bytes);
  const store=createLocalArchiveStore(data),entry=await store.getWithMetadata('faith',{type:'json'});
  assert.deepEqual(entry.data,faith);assert.ok(entry.etag);
  assert.equal(await store.getWithMetadata('people'),null);
  assert.equal(await store.getWithMetadata('editor_credentials'),null);
  assert.equal(await readFile(path.join(data,'village-faith.json'),'utf8'),bytes);
  assert.deepEqual(await readdir(data),['village-faith.json']);
  await assert.rejects(store.setJSON('faith',{version:1,revision:8,records:[]}),/read-only/);
  assert.equal(await readFile(path.join(data,'village-faith.json'),'utf8'),bytes);
}));

test('missing or unreadable faith fails closed and never seeds a replacement',()=>isolated(async data=>{
  const store=createLocalArchiveStore(data);
  await assert.rejects(store.getWithMetadata('faith'),/missing/);
  assert.deepEqual(await readdir(data),[]);
  await writeFile(path.join(data,'village-faith.json'),'{ broken local file');
  await assert.rejects(store.getWithMetadata('faith'));
  assert.equal(await readFile(path.join(data,'village-faith.json'),'utf8'),'{ broken local file');
}));

test('file adapter serializes compare-and-swap across adapters and keeps snapshots immutable',()=>isolated(async data=>{
  const first=createLocalArchiveStore(data),second=createLocalArchiveStore(data);
  const initial=await first.setJSON('archive_manifest_v1',{version:1,revision:1},{onlyIfNew:true});
  assert.equal(initial.modified,true);
  const results=await Promise.all([first,second].map((store,index)=>store.setJSON('archive_manifest_v1',{version:1,revision:2,writer:index},{onlyIfMatch:initial.etag})));
  assert.deepEqual(results.map(result=>result.modified).sort(),[false,true]);
  const saved=await first.getWithMetadata('archive_manifest_v1');assert.equal(saved.data.revision,2);
  assert.notEqual(saved.etag,initial.etag);
  const snapshot='archive_snapshots/'+randomUUID()+'/people';
  assert.equal((await first.setJSON(snapshot,{records:[{id:'first'}]},{onlyIfNew:true})).modified,true);
  assert.equal((await second.setJSON(snapshot,{records:[]})).modified,false);
  assert.equal((await first.getWithMetadata(snapshot)).data.records[0].id,'first');
  assert.deepEqual(await readdir(path.join(data,'.archive-store','locks')),[]);
}));

test('raw keys cannot select arbitrary paths or overwrite local credentials',()=>isolated(async data=>{
  const store=createLocalArchiveStore(data);
  for(const key of ['../people','archive_snapshots/../../people','archive_snapshots/not-a-uuid/people','archive_manifest_v1/../people','editor_credentials']) {
    await assert.rejects(store.setJSON(key,{records:[]}));
    if(key!=='editor_credentials')await assert.rejects(store.getWithMetadata(key));
  }
  assert.deepEqual(await readdir(data),[]);
}));

function bridge(data,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('../local-archive-bridge.mjs',import.meta.url)),'--data-dir',data],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',error='';const timer=setTimeout(()=>{child.kill();reject(Error('Bridge test timed out.'));},15000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>error+=part);
    child.once('error',cause=>{clearTimeout(timer);reject(cause);});
    child.once('close',code=>{clearTimeout(timer);if(code)reject(Error('Bridge process failed: '+error));else try{resolve(JSON.parse(output));}catch(cause){reject(cause);}});
    child.stdin.end(JSON.stringify(input));
  });
}

test('one-shot bridge reuses authenticated handlers and snapshots without changing legacy bytes',()=>isolated(async data=>{
  const fixtures={'people.json':{version:1,revision:0,records:[]},'deities.json':deitySeed,'village-faith.json':{version:1,revision:3,records:[]},'field-entries.json':{version:1,revision:0,records:[]}};
  const originals=new Map();
  for(const [name,document] of Object.entries(fixtures)){const bytes=JSON.stringify(document,null,2);originals.set(name,bytes);await writeFile(path.join(data,name),bytes);}
  const initial=await bridge(data,{path:'/api/people'});
  assert.equal(initial.status,200);assert.equal(JSON.parse(initial.body).editable,true);
  const saved=await bridge(data,{path:'/api/people',method:'POST',headers:{'Content-Type':'application/json'},body:{version:1,revision:0,action:'save',record:{id:'test-person',displayName:'隔离测试人物'},baseUpdatedAt:null}});
  assert.equal(saved.status,200,saved.body);assert.equal(JSON.parse(saved.body).records[0].visibility,'editors');
  const reloaded=await bridge(data,{path:'/api/people'});assert.equal(JSON.parse(reloaded.body).records[0].id,'test-person');
  const overview=await bridge(data,{path:'/api/archive-management'});
  assert.equal(overview.status,200,overview.body);
  const archived=await bridge(data,{path:'/api/archive-management',method:'POST',headers:{'Content-Type':'application/json'},body:{kind:'people',action:'archive',id:'test-person',confirm:true,snapshotToken:JSON.parse(overview.body).snapshotToken}});
  assert.equal(archived.status,200,archived.body);
  const afterArchive=await bridge(data,{path:'/api/people'});assert.ok(JSON.parse(afterArchive.body).records[0].archivedAt);
  const store=createLocalArchiveStore(data),manifest=await store.getWithMetadata('archive_manifest_v1');
  assert.equal(Object.keys(manifest.data.documents).length,4);
  for(const [name,bytes] of originals)assert.equal(await readFile(path.join(data,name),'utf8'),bytes);
  assert.equal(await store.getWithMetadata('editor_credentials'),null);
  const blocked=await bridge(data,{path:'/api/people',headers:{Origin:'https://foreign.example'}});assert.equal(blocked.status,403);
}));
