import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
// Only runtime assets are published; local archives and survey files stay local.
for (const file of ['map.css', 'map-app.js', 'map-data.js', 'faith-records.js', 'place-archives.js', 'cloud-access.js', 'field-journal.js', 'field-journal.css', 'sea-texture.svg', 'deity-catalog.js', 'deity-atlas.js', 'deity-atlas.css', 'deity-explorer.js', 'deity-explorer.css']) {
  await copyFile(path.join(root, file), path.join(output, file));
}
for(const file of ['index.html','deities.html']) {
  const html = (await readFile(path.join(root,file),'utf8')).replace('<html lang="zh-CN">','<html lang="zh-CN" data-deployment="netlify">');
  await writeFile(path.join(output,file),html);
}
await copyFile(path.join(root, 'work/lucide-atlas-license.txt'), path.join(output, 'lucide-license.txt'));
console.log('Built Netlify map into dist/');
