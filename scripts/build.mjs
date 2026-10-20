import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
// Only runtime assets are published; local archives and survey files stay local.
for (const file of ['map.css', 'map-app.js', 'map-data.js', 'faith-records.js', 'cloud-access.js', 'sea-texture.svg']) {
  await copyFile(path.join(root, file), path.join(output, file));
}
const html = (await readFile(path.join(root, 'index.html'), 'utf8'))
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-deployment="netlify">');
await writeFile(path.join(output, 'index.html'), html);
await copyFile(path.join(root, 'work/lucide-atlas-license.txt'), path.join(output, 'lucide-license.txt'));
console.log('Built Netlify map into dist/');
