import { manifestValidator, gateEngine } from './src/index';

const health = manifestValidator.getProjectHealth('ai-tutor');
console.log('=== ai-tutor Health ===');
console.log(`Stage: ${health?.stage}`);
console.log(`Owner: ${health?.owner}`);
console.log('Checks:');
for (const check of health?.checks || []) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`  ${icon} ${check.gate}: ${check.details}`);
}

const gateResult = gateEngine.evaluateTransition('ai-tutor', 'production');
console.log(`\nTransition to production: ${gateResult.passed ? '✅ PASS' : '❌ FAIL'}`);
for (const check of gateResult.checks) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`  ${icon} ${check.gate}: ${check.details}`);
}
if (gateResult.blockers.length > 0) {
    console.log('Blockers:', gateResult.blockers);
}
