import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = id => document.getElementById(id);
const view = $('terrain-view');
const labels = $('terrain-labels');
const switch2D = $('view-2d');
const switch3D = $('view-3d');
const detailButton = $('detail-view');
const bounds = { west: 110.548, south: 20.851, east: 110.650, north: 20.955 };
const center = { lng: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 };
const width = (bounds.east - bounds.west) * 111.32 * Math.cos(center.lat * Math.PI / 180);
const depth = (bounds.north - bounds.south) * 111.32;
const baseURL = new URL('./assets/', import.meta.url);
let renderer, scene, camera, controls, island, sea, outlines;
let points = [], activeId = null, draft = null, picking = false, ready = false, loading = null, running = false;
let referencePlaces = [], referenceFocus = null;
let labelEntries = [];
const raycaster = new THREE.Raycaster();
const referencePromise = fetch(new URL('reference-places.json', baseURL))
  .then(response => response.ok ? response.json() : [])
  .then(data => {
    referencePlaces = data;
    renderReferenceList();
    if (ready) renderLabels();
    return data;
  })
  .catch(error => {
    console.warn('Reference places unavailable:', error);
    $('reference-count').textContent = '暂不可用';
    return [];
  });

function renderReferenceList() {
  $('reference-count').textContent = `${referencePlaces.length} 处`;
  const list = $('reference-list');
  list.replaceChildren();
  for (const place of referencePlaces) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-button';
    const name = document.createElement('strong');
    name.textContent = place.name;
    const detail = document.createElement('span');
    detail.textContent = `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)} · ${place.nameSource || 'GeoNames 中文别名'}`;
    button.append(name, detail);
    button.addEventListener('click', () => focusReference(place));
    list.append(button);
  }
}

function worldPosition(lng, lat, y = 0) {
  return new THREE.Vector3(
    (lng - center.lng) / (bounds.east - bounds.west) * width,
    y,
    (center.lat - lat) / (bounds.north - bounds.south) * depth,
  );
}

function geoPosition(position) {
  return {
    lng: center.lng + position.x / width * (bounds.east - bounds.west),
    lat: center.lat - position.z / depth * (bounds.north - bounds.south),
  };
}

function insideIsland(lng, lat) {
  return outlines.some(ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (((a[1] > lat) !== (b[1] > lat)) &&
          lng < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  });
}

function readPoints() {
  try {
    const saved = JSON.parse(localStorage.getItem('naozhou-field-map-v1') || '{}');
    return Array.isArray(saved.points) ? saved.points : [];
  } catch { return []; }
}

function resize() {
  if (!renderer || !view.clientWidth || !view.clientHeight) return;
  renderer.setSize(view.clientWidth, view.clientHeight, false);
  camera.aspect = view.clientWidth / view.clientHeight;
  camera.updateProjectionMatrix();
}

function resetView() {
  if (!controls) return;
  controls.target.set(0, 0, 0);
  if (view.parentElement.clientWidth < 600) camera.position.set(0, 11, 10);
  else camera.position.set(0, 13.8, 11.8);
  controls.update();
}

async function focusReference(place) {
  try {
    await initialize();
    setMode('3d');
    referenceFocus = place.id;
    const location = worldPosition(place.lng, place.lat);
    controls.target.set(location.x, 0, location.z);
    camera.position.set(location.x, 7.2, location.z + 6.3);
    controls.update();
    renderLabels();
    window.dispatchEvent(new CustomEvent('naozhou:reference-selected', { detail: place }));
    if (matchMedia('(max-width:780px)').matches) view.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('Reference location failed:', error);
  }
}

function createCoastline() {
  const walls = [];
  for (const ring of outlines) {
    const edge = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = worldPosition(...ring[i]);
      const b = worldPosition(...ring[i + 1]);
      walls.push(
        a.x, -0.13, a.z, b.x, -0.13, b.z, a.x, 0.025, a.z,
        b.x, -0.13, b.z, b.x, 0.025, b.z, a.x, 0.025, a.z,
      );
      edge.push(a.x, 0.035, a.z);
    }
    const line = new THREE.BufferGeometry();
    line.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    scene.add(new THREE.LineLoop(line, new THREE.LineBasicMaterial({ color: 0xf5dda7, transparent: true, opacity: 0.47 })));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(walls, 3));
  geometry.computeVertexNormals();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x5c5b45, roughness: 1, side: THREE.DoubleSide })));
}

function addBoard() {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.35, 0.13, depth + 0.35),
    new THREE.MeshStandardMaterial({ color: 0x254c54, roughness: 0.9 }),
  );
  base.position.y = -0.25;
  scene.add(base);
  const underSea = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 2, depth + 2),
    new THREE.MeshBasicMaterial({ color: 0x0e3845 }),
  );
  underSea.rotation.x = -Math.PI / 2;
  underSea.position.y = -0.30;
  scene.add(underSea);
}

async function initialize() {
  if (ready) return;
  if (loading) return loading;
  loading = (async () => {
    const [outlineResponse, satellite, mask, height] = await Promise.all([
      fetch(new URL('island-outline.json', baseURL)).then(response => {
        if (!response.ok) throw Error('海岸线文件无法读取');
        return response.json();
      }),
      new THREE.TextureLoader().loadAsync(new URL('island-satellite.jpg', baseURL).href),
      new THREE.TextureLoader().loadAsync(new URL('island-mask.png', baseURL).href),
      new THREE.TextureLoader().loadAsync(new URL('island-height.png', baseURL).href),
    ]);
    outlines = outlineResponse;
    satellite.colorSpace = THREE.SRGBColorSpace;
    satellite.anisotropy = 8;
    mask.minFilter = THREE.LinearFilter;
    height.minFilter = THREE.LinearFilter;
    height.magFilter = THREE.LinearFilter;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x103b48);
    scene.add(new THREE.HemisphereLight(0xd7eeeb, 0x27434d, 2.3));
    const sun = new THREE.DirectionalLight(0xfff3d9, 2.1);
    sun.position.set(-4, 12, 5);
    scene.add(sun);
    addBoard();
    const seaMaterial = new THREE.MeshBasicMaterial({ map: satellite });
    sea = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), seaMaterial);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.12;
    scene.add(sea);
    island = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth, 220, 220),
      new THREE.MeshStandardMaterial({
        map: satellite,
        alphaMap: mask,
        alphaTest: 0.45,
        displacementMap: height,
        displacementScale: 0.24,
        displacementBias: 0.01,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
    );
    island.rotation.x = -Math.PI / 2;
    scene.add(island);
    createCoastline();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    view.insertBefore(renderer.domElement, labels);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableRotate = false;
    controls.screenSpacePanning = true;
    controls.minDistance = 4.2;
    controls.maxDistance = 28;
    controls.maxPolarAngle = Math.PI / 3;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    resetView();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    new ResizeObserver(resize).observe(view);
    ready = true;
    points = readPoints();
    renderLabels();
  })();
  try { await loading; } finally { loading = null; }
}

function renderLabels() {
  labels.replaceChildren();
  labelEntries = [];
  for (const point of points.slice(0, 300)) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'terrain-label' + (point.id === activeId ? ' is-active' : '');
    button.textContent = point.name;
    button.title = point.name + ' · 点击编辑调查记录';
    button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('naozhou:select-point', { detail: point.id })));
    labels.append(button);
    labelEntries.push({ button, position: worldPosition(point.lng, point.lat, 0.34) });
  }
  for (const place of referencePlaces) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'terrain-label is-reference' + (place.id === referenceFocus ? ' is-active' : '');
    button.textContent = place.name;
    button.title = `${place.name} · 公开地名参考，待核实`;
    button.addEventListener('click', () => focusReference(place));
    labels.append(button);
    labelEntries.push({ button, position: worldPosition(place.lng, place.lat, 0.32), reference: true, active: place.id === referenceFocus });
  }
  if (draft) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'terrain-label is-draft';
    button.textContent = '待保存的位置';
    labels.append(button);
    labelEntries.push({ button, position: worldPosition(draft.lng, draft.lat, 0.36) });
  }
}

function updateLabels() {
  const size = { width: view.clientWidth, height: view.clientHeight };
  const placed = [];
  for (const item of labelEntries) {
    const projected = item.position.clone().project(camera);
    const x = (projected.x + 1) * size.width / 2;
    const y = (1 - projected.y) * size.height / 2;
    item.button.hidden = projected.z > 1 || projected.z < -1 || Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1 ||
      (item.reference && !item.active && placed.some(existing => Math.abs(existing.x - x) < 84 && Math.abs(existing.y - y) < 24));
    if (item.button.hidden) continue;
    item.button.style.left = `${x}px`;
    item.button.style.top = `${y}px`;
    placed.push({ x, y });
  }
}

function frame() {
  if (!running) return;
  controls.update();
  const previous = controls.target.clone();
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -width / 2, width / 2);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -depth / 2, depth / 2);
  camera.position.add(controls.target.clone().sub(previous));
  renderer.render(scene, camera);
  updateLabels();
  requestAnimationFrame(frame);
}

function start() {
  if (running) return;
  running = true;
  resize();
  frame();
}

function setMode(mode) {
  window.naozhouViewMode = mode;
  view.hidden = mode !== '3d';
  detailButton.hidden = mode !== '3d';
  switch2D.setAttribute('aria-pressed', String(mode === '2d'));
  switch3D.setAttribute('aria-pressed', String(mode === '3d'));
  $('map-message').hidden = mode === '3d' ? !picking : true;
  if (mode === '3d') start();
  else running = false;
}

let pointerDown = null;
function onPointerDown(event) {
  pointerDown = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event) {
  if (!picking || !pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const cursor = new THREE.Vector2(
    (event.clientX - rect.left) / rect.width * 2 - 1,
    -(event.clientY - rect.top) / rect.height * 2 + 1,
  );
  raycaster.setFromCamera(cursor, camera);
  const hit = raycaster.intersectObject(island)[0];
  if (!hit) return;
  const geo = geoPosition(hit.point);
  if (!insideIsland(geo.lng, geo.lat)) return;
  window.dispatchEvent(new CustomEvent('naozhou:terrain-picked', { detail: geo }));
}

switch3D.disabled = false;
switch3D.addEventListener('click', async () => {
  switch3D.disabled = true;
  try {
    await initialize();
    setMode('3d');
  } catch (error) {
    console.error('Terrain view failed:', error);
    $('search-status').textContent = '浅立体地图未能加载，请确认从“打开地图.cmd”启动，并检查地图资源文件。';
    $('search-status').classList.add('error');
  } finally {
    switch3D.disabled = false;
  }
});
switch2D.addEventListener('click', () => setMode('2d'));
detailButton.addEventListener('click', () => {
  if (!controls) return;
  const location = geoPosition(controls.target);
  const distance = camera.position.distanceTo(controls.target);
  const zoom = distance < 7.5 ? 18 : distance < 12 ? 17 : 16;
  window.dispatchEvent(new CustomEvent('naozhou:inspect-2d', { detail: { ...location, zoom } }));
  setMode('2d');
});
$('search-form').addEventListener('submit', () => {
  if (window.naozhouViewMode === '3d') setMode('2d');
}, true);
window.addEventListener('naozhou:points-changed', event => {
  points = event.detail.points;
  activeId = event.detail.activeId;
  if (ready) renderLabels();
});
window.addEventListener('naozhou:draft-changed', event => {
  draft = event.detail;
  if (ready) renderLabels();
});
window.addEventListener('naozhou:draft-cleared', () => {
  draft = null;
  if (ready) renderLabels();
});
window.addEventListener('naozhou:picking-changed', event => {
  picking = event.detail;
  view.classList.toggle('is-picking', picking);
  $('map-message').hidden = !picking || window.naozhouViewMode !== '3d';
});
window.addEventListener('naozhou:reset-view', resetView);
window.addEventListener('naozhou:point-selected', event => {
  if (!controls || window.naozhouViewMode !== '3d') return;
  const location = worldPosition(event.detail.lng, event.detail.lat);
  const offset = camera.position.clone().sub(controls.target);
  controls.target.set(location.x, 0, location.z);
  camera.position.copy(controls.target).add(offset.multiplyScalar(0.68));
  controls.update();
});
