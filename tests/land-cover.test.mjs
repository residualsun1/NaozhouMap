import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const detail=JSON.parse(await readFile(new URL('assets/land-cover.geojson',root),'utf8'));
const overview=JSON.parse(await readFile(new URL('assets/land-cover-overview.geojson',root),'utf8'));

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

test('both levels keep the same classes and all accepted small water components',()=>{
  assert.deepEqual(detail.features.map(f=>f.properties.class),overview.features.map(f=>f.properties.class));
  const smallWater=collection=>collection.features.find(f=>f.properties.class==='inland_water').geometry.coordinates.length;
  assert.ok(smallWater(detail)>0);
  assert.equal(smallWater(overview),smallWater(detail));
});

test('published geometry uses closed finite geographic rings, not image pixels',()=>{
  const [west,south,east,north]=detail.metadata.bbox,epsilon=1e-7;
  for(const collection of [detail,overview])for(const feature of collection.features){
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

test('runtime wrapper preserves authoritative GeoJSON coordinates in both levels',async()=>{
  const context={window:{}};vm.runInNewContext(await readFile(new URL('land-cover-data.js',root),'utf8'),context);
  const packed=JSON.parse(JSON.stringify(context.window.NAOZHOU_LAND_COVER));
  assert.deepEqual(packed.levels.detail,detail.features);
  assert.deepEqual(packed.levels.overview,overview.features);
  assert.deepEqual(packed.metadata,detail.metadata);
});
