/**
 * Math Tutor PWA — Copy static assets into edge-runtime public dir.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'public');
const DST = join(__dirname, '..', '..', 'edge-runtime', 'public', 'ai-tutor');

if (!existsSync(SRC)) {
  console.error('Source directory not found:', SRC);
  process.exit(1);
}

mkdirSync(DST, { recursive: true });

let count = 0;
function copyDir(src, dst) {
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const dstPath = join(dst, entry);
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(dstPath, { recursive: true });
      copyDir(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
      count++;
    }
  }
}
copyDir(SRC, DST);
console.log(`Copied ${count} asset(s) to ${DST}`);
