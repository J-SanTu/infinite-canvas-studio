import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `Santu-Infinite-Canvas-${version}-Windows-setup.exe`;
mkdirSync(path.join(root, 'Windows'), { recursive: true });
copyFileSync(path.join(root, '.build.noindex/windows', name), path.join(root, 'Windows', name));
console.log(`Windows installer: Windows/${name}`);
