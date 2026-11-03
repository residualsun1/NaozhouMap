import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
// GeoJSON is the authoritative derived source; this small wrapper also supports
// the existing local map without requiring runtime GIS services or credentials.
const coverDetail = JSON.parse(await readFile(path.join(root, 'assets/land-cover.geojson'), 'utf8'));
const coverOverview = JSON.parse(await readFile(path.join(root, 'assets/land-cover-overview.geojson'), 'utf8'));
if(coverDetail.metadata.storageCrs !== 'EPSG:4326' || coverOverview.metadata.id !== coverDetail.metadata.id)throw Error('Invalid land-cover source pair.');
const coverScript = '// Generated from assets/land-cover*.geojson by npm run build.\nwindow.NAOZHOU_LAND_COVER = ' + JSON.stringify({metadata:coverDetail.metadata,levels:{overview:coverOverview.features,detail:coverDetail.features}}) + ';\n';
await writeFile(path.join(root, 'land-cover-data.js'), coverScript);
await writeFile(path.join(output, 'land-cover-data.js'), coverScript);
await copyFile(path.join(root, 'land-cover.js'), path.join(output, 'land-cover.js'));
// Only runtime assets are published; local archives and survey files stay local.
for (const file of ['map.css', 'map-app.js', 'map-data.js', 'faith-records.js', 'place-archives.js', 'cloud-access.js', 'cloud-access.css', 'field-journal.js', 'field-journal.css', 'place-reader.js', 'place-reader.css', 'sea-texture.svg', 'deity-catalog.js', 'deity-atlas.js', 'deity-atlas.css', 'deity-explorer.js', 'ritual-sphere.js', 'deity-explorer.css', 'people-catalog.js', 'people-page.js', 'people-map.js', 'people.css', 'people-explorer.js', 'people-explorer.css', 'archive-overview.js', 'archive-management.js', 'archive-management.css']) {
  await copyFile(path.join(root, file), path.join(output, file));
}
for(const file of ['index.html','deities.html','people.html']) {
  const html = (await readFile(path.join(root,file),'utf8')).replace('<html lang="zh-CN">','<html lang="zh-CN" data-deployment="netlify">');
  await writeFile(path.join(output,file),html);
}
await copyFile(path.join(root, 'work/lucide-atlas-license.txt'), path.join(output, 'lucide-license.txt'));
for(const file of ['deity-villages.js','deity-villages.css','place-names.js','worship-info.js','worship-editor.js','worship-filter.js','worship.css'])await copyFile(path.join(root,file),path.join(output,file));
console.log('Built Netlify map into dist/');
