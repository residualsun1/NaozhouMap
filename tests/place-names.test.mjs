import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import data from '../assets/vector-map-data.json' with {type:'json'};
import {faithPlaceIndex} from '../netlify/lib/faith-associations.mjs';

const awaitedNamesSource=await readFile(new URL('../place-names.js',import.meta.url),'utf8');
const context={window:{NAOZHOU_DATA:data}},byId=new Map(data.places.map(p=>[p.id,p]));
for(const file of ['place-names.js','deity-catalog.js','deity-villages.js'])runInNewContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context);
const names=context.window.PlaceNames;
const xibu=byId.get('6834722'),nancun=byId.get('osm-2065803493'),chima=byId.get('6834712');

test('canonical names handle the explicit Nancun exception without changing entity types or IDs',()=>{
  assert.equal(xibu.name,'西埠村');assert.equal(nancun.name,'南村村');assert.equal(chima.name,'赤马村');
  assert.equal(byId.get('6834714').name,'孟岗村');assert.equal(byId.get('6834714').placeKind,'administrative_seat');
  assert.equal(byId.get('1940784').name,'潭北湖');
  assert.ok(data.places.filter(p=>p.placeKind==='natural_village'&&p.id!=='1940784').every(p=>p.name.endsWith('村')));
});

test('only overview natural-village labels are shortened; selected and local labels stay complete',()=>{
  const before=structuredClone(data.places);
  for(const [place,short] of [[xibu,'西埠'],[nancun,'南村'],[chima,'赤马']]){
    assert.equal(names.mapLabel(place,true),short);
    assert.equal(names.mapLabel(place,false),place.name);
    assert.equal(names.mapLabel(place,true,true),place.name);
  }
  for(const place of data.places.filter(p=>p.placeKind!=='natural_village'))assert.equal(names.mapLabel(place,true),place.name);
  assert.equal(names.mapLabel(byId.get('1940784'),true),'潭北湖');
  assert.deepEqual(data.places,before);
});

test('short/full searches return the same ID once, preserve homonyms, aliases and pinyin',()=>{
  for(const pair of [['西埠','西埠村'],['南村','南村村'],['赤马','赤马村']]){
    const results=pair.map(term=>data.places.filter(p=>names.matches(p,term)).map(p=>p.id));
    assert.equal(results[0].length,1);assert.deepEqual(results[0],results[1]);
  }
  const homonyms=data.places.filter(p=>names.matches(p,'上岭村'));
  assert.equal(homonyms.length,2);assert.equal(new Set(homonyms.map(p=>p.id)).size,2);
  assert.equal(names.matches({...xibu,aliases:['既有别名'],pinyin:'Xibu'},'既有别名'),true);
  assert.equal(names.matches({...xibu,pinyin:'Xibu'},'xibu'),true);
});

test('legacy faith snapshots display canonical names by ID without rewriting observations',()=>{
  const records=[
    {id:'faith-one',villageId:xibu.id,villageKind:'reference',villageName:'西埠',deityLinks:[{deityId:'deity-id'}],temple:'旧宫庙',note:'受访原文：西埠'},
    {id:'faith-two',villageId:xibu.id,villageKind:'reference',villageName:'西埠',deityLinks:[{deityId:'deity-id'}],temple:'另一宫庙'},
    {id:'faith-three',villageId:nancun.id,villageKind:'reference',villageName:'南村',deityLinks:[{deityId:'deity-id'}]},
    {id:'survey',villageId:xibu.id,villageKind:'survey',villageName:'独立调查名称',deityLinks:[{deityId:'deity-id'}]}
  ],before=structuredClone(records);
  const villages=context.window.DeityAtlas.villagesFor('deity-id',records);
  assert.equal(villages.length,3);
  assert.equal(villages.find(v=>v.kind==='reference'&&v.id===xibu.id).name,'西埠村');
  assert.equal(villages.find(v=>v.id===nancun.id).name,'南村村');
  assert.equal(villages.find(v=>v.kind==='survey').name,'独立调查名称');
  assert.equal(villages.find(v=>v.id===xibu.id&&v.kind==='reference').records.length,2);
  assert.deepEqual(records,before);
  const located=context.window.DeityAtlas.locatedVillagesFor('deity-id',records,(kind,id)=>kind==='reference'?byId.get(id):null);
  assert.equal(located.find(v=>v.id===nancun.id).point.id,nancun.id);
});

test('deity workbench can register the existing API place index without a duplicated name dataset',()=>{
  const page={window:{}};
  runInNewContext('window.NAOZHOU_DATA=undefined',page);
  runInNewContext(awaitedNamesSource,page);
  page.window.PlaceNames.register(faithPlaceIndex.places);
  assert.equal(page.window.PlaceNames.name('reference',xibu.id,'西埠'),'西埠村');
  assert.equal(page.window.PlaceNames.name('survey',xibu.id,'调查点'),'调查点');
  const selection=context.window.DeityVillageLinks.createSelection(faithPlaceIndex,[],'deity-id');
  assert.equal(selection.rows('nangang','西埠')[0].name,'西埠村');
  assert.equal(selection.rows('nangang','西埠村')[0].id,xibu.id);
  assert.equal(selection.rows('menggang','南村村')[0].id,nancun.id);
});

test('static source names survive rebuild overlays and the runtime bundle contains the same places',async()=>{
  const sources=new Map();
  for(const file of ['reference-places','reference-additions','reference-corrections']){
    for(const place of JSON.parse(await readFile(new URL('../assets/'+file+'.json',import.meta.url),'utf8'))){
      if(place.name)sources.set(place.id,place.name);
    }
  }
  for(const place of data.places.filter(p=>p.placeKind==='natural_village'))assert.equal(sources.get(place.id),place.name);
  const runtime={window:{}};runInNewContext(await readFile(new URL('../map-data.js',import.meta.url),'utf8'),runtime);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.window.NAOZHOU_DATA)),data);
});
