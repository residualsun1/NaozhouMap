/* Loopback-only adapter: existing documents stay read-only; archive commits use CAS snapshots. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { issueSession, cookieName } from './netlify/lib/auth.mjs';

const legacyNames={people:'people.json',deities:'deities.json',faith:'village-faith.json',field_entries:'field-entries.json'};
const managed=new Set(Object.keys(legacyNames));
const MAX_BYTES=10*1024*1024;
const localSecret='naozhou-loopback-adapter-only-not-a-cloud-credential';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

function safeKey(key) {
  if(typeof key!=='string'||!(managed.has(key)||key==='archive_manifest_v1'||/^archive_snapshots\/[0-9a-f-]{36}\/(people|deities|faith|field_entries)$/.test(key)))throw Error('Unsupported local archive key.');
  return key;
}

export function createLocalArchiveStore(dataDirectory) {
  if(typeof dataDirectory!=='string'||!path.isAbsolute(dataDirectory))throw Error('An absolute local data directory is required.');
  const root=path.resolve(dataDirectory),objects=path.join(root,'.archive-store','objects'),locks=path.join(root,'.archive-store','locks');
  const objectPath=key=>path.join(objects,Buffer.from(safeKey(key)).toString('base64url')+'.json');
  async function readDocument(file) {
    let handle;
    try {
      handle=await open(file,'r');
      if((await handle.stat()).size>MAX_BYTES)throw Error('Local archive document exceeds 10 MB.');
      const bytes=await handle.readFile();
      if(bytes.length>MAX_BYTES)throw Error('Local archive document exceeds 10 MB.');
      return {data:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),etag:digest(bytes)};
    } catch(error) {if(error.code==='ENOENT')return null;throw error;}
    finally {await handle?.close();}
  }
  async function locked(key,action) {
    await mkdir(locks,{recursive:true});
    const lockPath=path.join(locks,digest(key)+'.lock');let lock;
    const deadline=Date.now()+5000;
    while(!lock) {
      try{lock=await open(lockPath,'wx',0o600);}
      catch(error){if(error.code!=='EEXIST')throw error;if(Date.now()>=deadline)throw Error('Local archive is busy; retain the form and retry.');await pause(35);}
    }
    try{return await action();}
    finally{await lock.close();await unlink(lockPath);}
  }
  return {
    async getWithMetadata(key) {
      // The trusted local server has no cloud credential document or remote secret.
      if(key==='editor_credentials')return null;
      safeKey(key);
      if(managed.has(key)) {
        const entry=await readDocument(path.join(root,legacyNames[key]));
        // Legacy local faith records were required, never silently replaced by a deployment seed.
        if(!entry&&key==='faith')throw Error('Local faith file is missing. Existing files have not been initialized.');
        return entry;
      }
      return readDocument(objectPath(key));
    },
    async setJSON(key,data,options={}) {
      safeKey(key);
      if(managed.has(key))throw Error('Legacy local archive documents are read-only.');
      const bytes=Buffer.from(JSON.stringify(data));
      if(bytes.length>MAX_BYTES)throw Error('Local archive document exceeds 10 MB.');
      return locked(key,async()=>{
        const target=objectPath(key),previous=await readDocument(target);
        if((options.onlyIfNew&&previous)||(options.onlyIfMatch&&previous?.etag!==options.onlyIfMatch))return {modified:false};
        // Immutable snapshots may never be overwritten, even by an accidentally unconditional call.
        if(key.startsWith('archive_snapshots/')&&previous)return {modified:false};
        await mkdir(objects,{recursive:true});
        const temporary=target+'.'+randomUUID()+'.tmp';let handle;
        try {
          handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
          await rename(temporary,target);
          return {modified:true,etag:digest(bytes)};
        } finally {await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      });
    }
  };
}

export async function handleLocalArchiveRequest(input,{dataDirectory}={}) {
  const allowed=new Set(['/api/people','/api/deities','/api/faith','/api/field-entries','/api/archive-management']);
  const url=new URL(input?.url||input?.path||'','http://127.0.0.1:8765');
  if(url.origin!=='http://127.0.0.1:8765'||!allowed.has(url.pathname))throw Error('Unsupported loopback archive endpoint.');
  const method=typeof input.method==='string'?input.method.toUpperCase():'GET';
  const headers=new Headers(input.headers||{});
  const origin=headers.get('origin');
  if(origin&&origin!==url.origin)return {status:403,headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({error:'Only the loopback map can access local archives.'})};
  // This constant exists only in the one-shot local child. No production environment secret is read.
  process.env.NAOZHOU_EDITOR_PASSWORD=localSecret;
  headers.set('cookie',cookieName+'='+issueSession(localSecret));headers.set('origin',url.origin);
  const body=input.body==null?undefined:typeof input.body==='string'?input.body:JSON.stringify(input.body);
  const request=new Request(url,{method,headers,...(!['GET','HEAD'].includes(method)&&body!==undefined?{body}:{})});
  const store=createLocalArchiveStore(dataDirectory),factory=()=>store;
  let handler;
  if(url.pathname==='/api/people')handler=(await import('./netlify/lib/people.mjs')).peopleHandler(factory);
  else if(url.pathname==='/api/field-entries')handler=(await import('./netlify/lib/field-journal.mjs')).fieldJournalHandler(factory);
  else if(url.pathname==='/api/archive-management')handler=(await import('./netlify/lib/archive-management.mjs')).archiveManagementHandler(factory);
  else handler=(await import('./netlify/lib/records.mjs')).recordsHandler(url.pathname==='/api/faith'?'faith':'deities',factory);
  const response=await handler(request);
  return {status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const at=process.argv.indexOf('--data-dir');
    if(at<0||!process.argv[at+1])throw Error('Missing local data directory.');
    let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>12*1024*1024)throw Error('Local request is too large.');}
    const output=await handleLocalArchiveRequest(JSON.parse(raw),{dataDirectory:process.argv[at+1]});
    process.stdout.write(JSON.stringify(output));
  } catch {
    process.stdout.write(JSON.stringify({status:503,headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({error:'Local archives could not be read or saved. Existing files are retained; keep the form open and retry.'})}));
  }
}
