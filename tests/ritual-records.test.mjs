import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { issueSession } from '../netlify/lib/auth.mjs';
import { deitySeed } from '../netlify/lib/deities.mjs';
import { recordsHandler } from '../netlify/lib/records.mjs';
import { fieldJournalHandler } from '../netlify/lib/field-journal.mjs';
import { archiveManagementHandler } from '../netlify/lib/archive-management.mjs';

const origin = 'https://ritual-test.example';
const deityURL = '/api/deities?view=archive';
const xianbao = 'amap-B02F70NY0C';
const dedou = '6834721';
process.env.NAOZHOU_EDITOR_PASSWORD = randomBytes(32).toString('base64url');

function memoryStore() {
  const entries = new Map();
  let version = 0;
  return {
    async getWithMetadata(key) { return structuredClone(entries.get(key) || null); },
    async setJSON(key, data, {onlyIfMatch, onlyIfNew} = {}) {
      const previous = entries.get(key);
      if ((onlyIfNew && previous) || (onlyIfMatch && onlyIfMatch !== previous?.etag)) return {modified:false};
      const etag = String(++version);
      entries.set(key, {data:structuredClone(data), etag});
      return {modified:true, etag};
    }
  };
}

function request(path, body, editor = true) {
  const headers = {'Content-Type':'application/json', Origin:origin};
  if (editor) headers.Cookie = 'naozhou_editor='+issueSession(process.env.NAOZHOU_EDITOR_PASSWORD);
  return new Request(origin+path, {method:body ? 'POST' : 'GET', headers, ...(body ? {body:JSON.stringify(body)} : {})});
}

async function ok(response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

const deity = (id, fields = {}) => ({id, name:'测试用同名神明', aliases:[], titleIds:[], ...fields});
const birthday = (id, fields = {}) => ({id, lunarMonth:9, lunarDay:28, leapMonth:'regular', ...fields});
const rotation = {
  id:'statue-a', name:'测试用南港轮祀', statueLabel:'PRIVATE_STATUE', scopeDescription:'PRIVATE_SCOPE', visibility:'public',
  cycleRules:[{id:'monthly', cycleType:'monthly', lunarDay:18, leapPolicy:'unknown', sourceNote:'PRIVATE_CYCLE'}],
  scheduleBatches:[{
    id:'draw-a', name:'测试用 2026—2027 排期', drawDate:{lunarYear:2026,lunarMonth:9,lunarDay:28,leapMonth:'regular'},
    note:'PRIVATE_BATCH', sourceNote:'PRIVATE_DRAW', scopeDescription:'PRIVATE_DRAW_SCOPE',
    stops:[
      {id:'stop-a', lunarYear:2026, lunarMonth:12, lunarDay:18, leapMonth:'regular', placeId:xianbao, recipientType:'household', recipientNote:'PRIVATE_HOUSEHOLD', note:'PRIVATE_STOP', status:'scheduled'},
      {id:'stop-b', lunarYear:2027, lunarMonth:2, lunarDay:18, leapMonth:'leap', placeId:dedou, status:'adjusted'},
      {id:'stop-c', lunarYear:2027, originalPlaceName:'PRIVATE_PLACE', recipientType:'other', status:'cancelled'}
    ]
  }]
};
const journalURL = '/api/field-entries';
const ritualURL = journalURL+'?view=rituals';
const link = (id, ritualTypeId, deityIds, note = '') => ({id, ritualTypeId, deityIds, note});
const log = (id, ritualLinks, fields = {}) => ({id, placeId:xianbao, placeKind:'reference', title:'测试日志 '+id,
  content:'第一段观察。\n\n第二段原文。', datePrecision:'day', observedAt:'2026-11-11', recordType:'observation',
  source:'测试访谈', tags:['隔离'], ritualLinks, ...fields});

async function saveLog(handler, revision, record, extras = {}) {
  return handler(request(journalURL, {version:1, action:'save', revision, record, ...extras}));
}

test('one optional lunar date and rotation time can be created, edited, cleared and read publicly', async () => {
  const store = memoryStore(), handler = recordsHandler('deities', () => store);
  let state = await ok(await handler(request(deityURL, {...deitySeed, records:[deity('old')]})));
  assert.equal(state.records[0].birthdayMonth, undefined);
  const save = fields => handler(request(deityURL, {...state, records:[{...state.records[0], ...fields}]}));
  assert.equal((await save({birthdayMonth:13})).status, 400);
  assert.equal((await save({birthdayDay:31})).status, 400);
  assert.equal((await save({rotationTime:['时间']})).status, 400);
  state = await ok(await save({birthdayMonth:3, birthdayDay:7, rotationTime:' 农历每月十八日 '}));
  const {birthdayMonth, birthdayDay, rotationTime, ...oldClient} = state.records[0];
  assert.deepEqual([birthdayMonth,birthdayDay,rotationTime], [3,7,'农历每月十八日']);
  state = await ok(await handler(request('/api/deities', {...state, records:[{...oldClient, description:'只修改原有简介'}]})));
  const response = await handler(request('/api/deities?id=old', undefined, false));
  assert.equal(response.headers.get('vary'), 'Cookie');
  const visible = await ok(response);
  assert.equal(visible.editable, false);
  assert.deepEqual(visible.records, state.records);
  assert.equal(visible.records[0].birthdayDay, 7);
  assert.equal(visible.records[0].rotationTime, '农历每月十八日');
  state = await ok(await save({birthdayDay:null}));
  assert.equal(state.records[0].birthdayMonth, 3);
  assert.equal(state.records[0].birthdayDay, null);
  state = await ok(await save({birthdayMonth:null, rotationTime:''}));
  const reopened = (await ok(await handler(request(deityURL)))).records[0];
  assert.equal(reopened.birthdayMonth, undefined);
  assert.equal(reopened.birthdayDay, undefined);
  assert.equal(reopened.rotationTime, undefined);
  assert.equal(reopened.description, '只修改原有简介');
});

test('legacy archives and backups retain one complete lunar date and the recurring time without disclosing notes or stops', async () => {
  const store = memoryStore(), handler = recordsHandler('deities', () => store);
  const readFaith = recordsHandler('faith', () => store);
  const originalFaith = await ok(await readFaith(request('/api/faith')));
  const legacy = {...deitySeed, records:[
    deity('rotation', {
      birthdays:[
        birthday('local-variant', {lunarMonth:3, lunarDay:7, visibility:'editors', sourceNote:'PRIVATE_BIRTH_SOURCE'}),
        birthday('nine-28', {visibility:'public', applicablePlaceIds:[xianbao], originalText:'PRIVATE_ORIGINAL'})
      ],
      rotationGroups:[rotation]
    }),
    deity('private-time', {
      birthdays:[birthday('partial', {lunarDay:null})],
      rotationGroups:[{...rotation, visibility:'editors', cycleRules:[{cycleType:'custom',originalText:'PRIVATE_CUSTOM_TIME'}]}]
    })
  ]};
  await store.setJSON('deities', legacy);
  const visible = await ok(await handler(request(deityURL, undefined, false)));
  const values = record => [record.birthdayMonth, record.birthdayDay, record.rotationTime];
  assert.deepEqual(visible.records.map(values), [[9,28,'农历每月18日'],[9,null,undefined]]);
  assert.doesNotMatch(JSON.stringify(visible), /PRIVATE|birthdays|rotationGroups|scheduleBatches|draw-a/);
  assert.deepEqual((await store.getWithMetadata('deities')).data, legacy);

  const importLegacy = recordsHandler('deities', memoryStoreFactory());
  await ok(await importLegacy(request(deityURL, legacy)));
  const exported = await ok(await importLegacy(request(deityURL)));
  assert.deepEqual(exported.records.map(values), visible.records.map(values));
  assert.doesNotMatch(JSON.stringify(exported), /PRIVATE|birthdays|rotationGroups/);
  const restore = recordsHandler('deities', memoryStoreFactory());
  await ok(await restore(request(deityURL, {...JSON.parse(JSON.stringify(exported)), revision:0})));
  assert.deepEqual((await ok(await restore(request(deityURL)))).records, exported.records);
  assert.deepEqual(await ok(await readFaith(request('/api/faith'))), originalFaith);
});

test('each ritual keeps its deity pairing, and summaries and counts can use only authorized logs', async () => {
  const store = memoryStore();
  const gods = [deity('statue-one'), deity('statue-two'), deity('private-only')];
  await ok(await recordsHandler('deities', () => store)(request(deityURL, {...deitySeed, records:gods})));
  const handler = fieldJournalHandler(() => store);
  let state = await ok(await saveLog(handler, 0, log('old', undefined, {visibility:'public'}), {confirmPublic:true}));
  const old = state.records[0];
  const ritualLinks = [link('celebrate','birthday-celebration',['statue-one'],'PRIVATE_RELATION_NOTE'), link('rotation','statue-rotation',['statue-two'])];
  const change = {...old, ritualLinks};
  assert.equal((await saveLog(handler,state.revision,change,{baseUpdatedAt:old.updatedAt})).status,400);
  state = await ok(await saveLog(handler,state.revision,change,{baseUpdatedAt:old.updatedAt,confirmPublic:true}));
  state = await ok(await saveLog(handler,state.revision,log('private', [link('private-ritual','birthday-celebration',['private-only'])], {content:'PRIVATE_JOURNAL_CONTENT',placeId:dedou})));
  const visible = await ok(await handler(request(ritualURL, undefined, false)));
  assert.equal(visible.revision, null);
  assert.deepEqual(visible.records.map(entry=>entry.id), ['old']);
  assert.deepEqual(visible.records[0].ritualLinks.map(relation=>relation.deityIds), [['statue-one'],['statue-two']]);
  assert.equal(visible.records[0].content, undefined);
  assert.doesNotMatch(JSON.stringify(visible), /PRIVATE|private-only|6834721/);
  const full = await ok(await handler(request(journalURL+'?placeId='+xianbao, undefined, false)));
  assert.equal(full.records[0].recordType, 'observation');
  assert.equal(full.records[0].content, old.content);
  assert.equal(full.records[0].ritualLinks[0].note, undefined);
  assert.equal((await ok(await handler(request(ritualURL)))).records.length, 2);
  assert.equal((await handler(request(ritualURL,{version:1,revision:state.revision,action:'save-ritual-types',ritualTypes:state.ritualTypes},false))).status, 401);
});

test('disabled ritual types retain historical links and backup restores stable IDs without duplicate writes', async () => {
  const store = memoryStore(), handler = fieldJournalHandler(() => store);
  let state = await ok(await saveLog(handler,0,log('archive-me',[link('record-link','qingguang',[],'保留原文')])));
  const directory = state.ritualTypes.map(type=>type.id==='qingguang' ? {...type,name:'庆光（地方用法）',aliases:['地方别称'],enabled:false,sortOrder:1} : type);
  const saveTypes = ritualTypes => handler(request(ritualURL,{version:1,revision:state.revision,action:'save-ritual-types',ritualTypes}));
  assert.equal((await saveTypes(directory.filter(type=>type.id!=='qingguang'))).status,400);
  state = await ok(await saveTypes(directory));
  assert.equal((await saveLog(handler,state.revision,log('new',[link('disabled','qingguang',[]) ]))).status,400);
  const backup = await ok(await handler(request(journalURL)));
  const {ritualLinks, ...oldClient} = backup.records[0];
  const edited = await ok(await saveLog(handler,backup.revision,{...oldClient,title:'旧表单编辑'},{baseUpdatedAt:oldClient.updatedAt}));
  assert.deepEqual(edited.records[0].ritualLinks, ritualLinks);
  assert.deepEqual(edited.ritualTypes, directory);
  const restored = fieldJournalHandler(memoryStoreFactory());
  const restore = revision => restored(request(ritualURL,{version:1,revision,action:'import',backup:JSON.parse(JSON.stringify(backup)),confirmPublic:true}));
  const imported = await ok(await restore(0));
  assert.equal(imported.importedCount,1);
  assert.deepEqual((await ok(await restored(request(journalURL)))).records,backup.records);
  assert.deepEqual(imported.ritualTypes, directory);
  const repeated = await ok(await restore(imported.revision));
  assert.equal(repeated.importedCount,0);
  assert.equal(repeated.revision,imported.revision);
});

function memoryStoreFactory() {
  const store = memoryStore();
  return () => store;
}

test('merging deities keeps the primary lunar date, fills a missing time and moves ritual deity references', async () => {
  const store = memoryStore();
  const gods = recordsHandler('deities', () => store);
  await ok(await gods(request(deityURL,{...deitySeed,records:[
    deity('one',{birthdayMonth:9,birthdayDay:28,rotationTime:'农历每月十八日'}),
    deity('two',{birthdayMonth:3,birthdayDay:7})
  ]})));
  const journals = fieldJournalHandler(() => store);
  const saved = await ok(await saveLog(journals,0,log('ritual-test',[link('both','statue-rotation',['one','two'])])));
  const handler = archiveManagementHandler(() => store);
  const path = '/api/archive-management';
  const preview = await ok(await handler(request(path,{action:'preview',kind:'deities',sourceId:'one',targetId:'two'})));
  await ok(await handler(request(path,{action:'merge',kind:'deities',sourceId:'one',targetId:'two',snapshotToken:preview.snapshotToken,choices:{},confirm:true})));
  const merged = (await ok(await gods(request('/api/deities?id=one')))).records[0];
  assert.deepEqual([merged.birthdayMonth,merged.birthdayDay], [3,7]);
  assert.equal(merged.rotationTime, '农历每月十八日');
  const entry = (await ok(await journals(request(journalURL)))).records[0];
  assert.deepEqual(entry.ritualLinks,[link('both','statue-rotation',['two'])]);
  assert.equal(entry.content,saved.records[0].content);
  const detail = await ok(await handler(request(path+'?kind=deities&id=two')));
  const ref = detail.refs.items.find(item=>item.field==='ritualLinks');
  assert.ok(ref);
  await ok(await handler(request(path,{action:'delete',kind:'deities',id:'two',snapshotToken:detail.snapshotToken,detach:[ref.key],confirm:true})));
  assert.deepEqual((await ok(await journals(request(journalURL)))).records[0].ritualLinks,[link('both','statue-rotation',[])]);
});
