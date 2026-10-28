import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
// Only runtime assets are published; local archives and survey files stay local.
for (const file of ['map.css', 'map-app.js', 'map-data.js', 'faith-records.js', 'place-archives.js', 'cloud-access.js', 'cloud-access.css', 'field-journal.js', 'field-journal.css', 'place-reader.js', 'place-reader.css', 'sea-texture.svg', 'deity-catalog.js', 'deity-atlas.js', 'deity-atlas.css', 'deity-explorer.js', 'ritual-sphere.js', 'deity-explorer.css', 'people-catalog.js', 'people-page.js', 'people-map.js', 'people.css', 'people-explorer.js', 'people-explorer.css', 'archive-overview.js', 'archive-management.js', 'archive-management.css']) {
  await copyFile(path.join(root, file), path.join(output, file));
}
for(const file of ['index.html','deities.html','people.html']) {
  const html = (await readFile(path.join(root,file),'utf8')).replace('<html lang="zh-CN">','<html lang="zh-CN" data-deployment="netlify">');
  await writeFile(path.join(output,file),html);
}
await copyFile(path.join(root, 'work/lucide-atlas-license.txt'), path.join(output, 'lucide-license.txt'));
for(const file of ['deity-villages.js','deity-villages.css'])await copyFile(path.join(root,file),path.join(output,file));
console.log('Built Netlify map into dist/');
