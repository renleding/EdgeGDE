import * as fs from 'fs';
import * as yaml from 'js-yaml';

const content = fs.readFileSync('/Users/warren/hermes-master/05_DOCS/portfolio/portfolio-manifest.yaml', 'utf-8');
const parsed = yaml.load(content);

console.log('=== Parsed Metadata ===');
console.log(JSON.stringify(parsed.metadata, null, 2));
console.log('\n=== Governance Gates ===');
console.log(JSON.stringify(parsed.metadata.governance_gates, null, 2));
