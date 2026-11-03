import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const detail=JSON.parse(await readFile(new URL('assets/land-cover.geojson',root),'utf8'));
const overview=JSON.parse(await readFile(new URL('assets/land-cover-overview.geojson',root),'utf8'));
const regional=JSON.parse(await readFile(new URL('assets/land-cover-regional.geojson',root),'utf8'));

test('land cover has historical, licensed, WGS84 provenance and no inferred built areas',()=>{
  assert.equal(detail.metadata.observationYear,2021);
  assert.equal(detail.metadata.storageCrs,'EPSG:4326');
  assert.deepEqual(detail.metadata.sources.map(s=>s.year),[2021,2020]);
  assert.equal(detail.metadata.license.name,'CC BY 4.0');
  assert.ok(detail.metadata.statistics.levels.detail.unknownAreaKm2>0);
  for(const feature of detail.features){
    assert.notEqual(feature.properties.sourceClass,50);
    assert.equal(feature.properties.status,'remote_sensing_reference');
    assert.equal(feature.properties.observedYear,2021);
  }
});

test('all levels retain the exact water, wetland and mangrove geometries',()=>{
  for(const layer of [overview,regional]){
    assert.deepEqual(detail.features.map(f=>f.properties.class),layer.features.map(f=>f.properties.class));
    for(const kind of ['inland_water','wetland','mangrove'])assert.deepEqual(layer.features.find(f=>f.properties.class===kind).geometry,detail.features.find(f=>f.properties.class===kind).geometry);
  }
});

test('overview reduces fragmentation while retaining broad unknown areas',async()=>{
  const metadata=overview.metadata,source=metadata.cartography.sourceStructure.forest;
  const forest=metadata.statistics.levels.overview.classes.forest;
  assert.ok(forest.polygonCount<source.polygonCount*.5);
  assert.ok(forest.holeCount<source.holeCount*.5);
  assert.ok(metadata.statistics.levels.overview.unknownAreaKm2>detail.metadata.statistics.levels.detail.unknownAreaKm2*.8);
  const original=await readFile(new URL('assets/land-cover.geojson',root));
  assert.equal(metadata.cartography.sourceDetailSha256,createHash('sha256').update(original).digest('hex'));
});

test('published geometry uses closed finite geographic rings, not image pixels',()=>{
  const [west,south,east,north]=detail.metadata.bbox,epsilon=1e-7;
  for(const collection of [detail,regional,overview])for(const feature of collection.features){
    assert.equal(feature.geometry.type,'MultiPolygon');
    for(const polygon of feature.geometry.coordinates)for(const ring of polygon){
      assert.ok(ring.length>=4);assert.deepEqual(ring.at(-1),ring[0]);
      for(const [lng,lat] of ring){
        assert.ok(Number.isFinite(lng)&&Number.isFinite(lat));
        assert.ok(lng>=west-epsilon&&lng<=east+epsilon&&lat>=south-epsilon&&lat<=north+epsilon);
      }
    }
  }
});

test('runtime wrapper preserves source and display coordinates in all levels',async()=>{
  const context={window:{}};vm.runInNewContext(await readFile(new URL('land-cover-data.js',root),'utf8'),context);
  const packed=JSON.parse(JSON.stringify(context.window.NAOZHOU_LAND_COVER));
  assert.deepEqual(packed.levels.detail,detail.features);
  assert.deepEqual(packed.levels.overview,overview.features);
  assert.deepEqual(packed.levels.regional,regional.features);
  assert.deepEqual(packed.metadata,overview.metadata);
});
