/**
 * Validate the web manifest JSON before copy.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, '..', 'public', 'manifest.webmanifest');

if (!existsSync(manifestPath)) {
  console.error('Manifest not found:', manifestPath);
  process.exit(1);
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const required = ['name', 'short_name', 'start_url', 'display'];
  const missing = required.filter(f => !manifest[f]);
  if (missing.length) {
    console.error(`Manifest missing required fields: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('Manifest valid:', manifest.name);
} catch (e) {
  console.error('Invalid manifest JSON:', e.message);
  process.exit(1);
}
