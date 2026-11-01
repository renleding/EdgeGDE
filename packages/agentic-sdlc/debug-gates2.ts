import * as fs from 'fs';
import * as yaml from 'js-yaml';

const content = fs.readFileSync('/Users/warren/hermes-master/05_DOCS/portfolio/portfolio-manifest.yaml', 'utf-8');
const parsed = yaml.load(content);

console.log('=== Full parsed keys ===');
console.log(Object.keys(parsed));

console.log('\n=== Raw content tail ===');
const lines = content.split('\n');
console.log(lines.slice(-30).join('\n'));
