import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const context={window:{}};
runInNewContext(await readFile(new URL('../ritual-sphere.js',import.meta.url),'utf8'),context);
const sphere=context.window.RitualSphere;
const project=(lng,lat)=>({x:lng*100,y:lat*100});
const coast=[{x:0,y:0},{x:10000,y:0},{x:10000,y:10000},{x:0,y:10000}];
const village=(id,x,y,kind='reference')=>({key:kind+':'+id,kind,id,point:{lng:x/100,lat:y/100}});

test('zero, one and two real locations do not fabricate a connecting geometry',()=>{
  const empty=sphere.build([],project,coast);assert.equal(empty.kind,'empty');assert.equal(empty.count,0);
  const one=sphere.build([village('a',1000,1000)],project,coast);assert.equal(one.kind,'point');assert.equal(one.polygon.length,0);
  const two=sphere.build([village('a',1000,1000),village('b',2000,2000)],project,coast);assert.equal(two.kind,'pair');assert.equal(two.polygon.length,0);assert.equal(two.pointCount,2);
});
test('kind and stable ID dedup is separate from coincident geometry dedup',()=>{
  const places=[village('a',1000,1000),village('a',1200,1200),village('b',1000,1000),village('a',2000,2000,'survey')];
  const result=sphere.build(places,project,coast);
  assert.equal(result.count,3);assert.equal(result.pointCount,2);assert.equal(result.kind,'pair');
  assert.equal(result.points[0].x,1000);assert.equal(result.points[1].kind,'survey');
});
test('multiple spread locations form a gently buffered hull containing every accepted point without mutating input',()=>{
  const places=[village('a',2000,2000),village('b',4000,2000),village('c',3000,4000),village('inside',3000,2500)],before=JSON.stringify(places),coastBefore=JSON.stringify(coast);
  const result=sphere.build(places,project,coast);
  assert.equal(result.kind,'polygon');assert.equal(result.count,4);assert.equal(result.bufferMeters,120);assert.equal(result.outlineOnly,false);
  for (const point of result.points) assert.equal(sphere.contains(point,result.polygon),true);
  assert.ok(result.polygon.some(point=>point.x<2000));assert.ok(result.polygon.some(point=>point.y>4000));
  assert.ok(result.area>2000000);assert.equal(JSON.stringify(places),before);assert.equal(JSON.stringify(coast),coastBefore);
});
test('collinear and near-collinear locations remain independent markers',()=>{
  for (const offset of [0,8]) {
    const result=sphere.build([village('a',1000,1000),village('b',2000,2000+offset),village('c',3000,3000)],project,coast);
    assert.equal(result.kind,'degenerate');assert.equal(result.polygon.length,0);assert.equal(result.bufferMeters,0);
  }
});
test('invalid and offshore coordinates are excluded; near-coast acceptance is limited and large envelopes become outlines',()=>{
  const invalid=[village('valid',1000,1000),village('near',-100,5000),village('offshore',-181,5000),village('bad-lng',18100,1000),{kind:'reference',id:'nan',point:{lng:NaN,lat:20}},village('project-error',2000,2000)];
  const result=sphere.build(invalid,(lng,lat)=>{if(lng===20)throw Error('projection failed');return project(lng,lat);},coast);
  assert.equal(result.count,2);assert.equal(result.kind,'pair');assert.equal(result.rejectedCount,4);
  const large=sphere.build([village('a',100,100),village('b',9900,100),village('c',9900,8900),village('d',100,8900)],project,coast);
  assert.equal(large.kind,'polygon');assert.equal(large.outlineOnly,true);
  assert.equal(sphere.build([village('a',1000,1000)],project,[]).kind,'empty');
});
