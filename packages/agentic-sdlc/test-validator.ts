import { manifestValidator } from './src/validator/ManifestValidator';
import { gateEngine } from './src/gate/GateEngine';

console.log('=== Testing Manifest Validator ===\n');

// Load manifest
const manifest = manifestValidator.load();
console.log(`Loaded manifest v${manifest.version} (${manifest.generated})`);
console.log(`Total projects: ${manifest.portfolio.length}\n`);

// Validate all projects
const results = manifestValidator.validateAll();
console.log('=== Validation Results ===');
for (const result of results) {
  const status = result.valid ? '✅' : '❌';
  console.log(`${status} ${result.project}: ${result.errors.length} errors, ${result.warnings.length} warnings`);
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.log(`  ERROR: ${err.code} - ${err.message}`);
    }
  }
  if (result.warnings.length > 0) {
    for (const warn of result.warnings) {
      console.log(`  WARN: ${warn.code} - ${warn.message}`);
    }
  }
}

console.log('\n=== Project Health ===');
for (const project of manifest.portfolio) {
  if (project.health.implementation_started || project.lifecycle.stage !== 'planned') {
    const health = manifestValidator.getProjectHealth(project.project);
    if (health) {
      const overall = health.overall === 'pass' ? '✅' : health.overall === 'fail' ? '❌' : '⚠️';
      console.log(`${overall} ${project.project} (${health.stage}): ${health.checks.filter(c => c.passed).length}/${health.checks.length} gates passed`);
      for (const check of health.checks) {
        if (!check.passed) {
          console.log(`  ❌ ${check.gate}: ${check.details}`);
        }
      }
    }
  }
}

console.log('\n=== Transition Candidates ===');
const candidates = manifestValidator.getTransitionCandidates();
for (const c of candidates) {
  console.log(`${c.ready ? '✅' : '❌'} ${c.project}: ${c.from} → ${c.to} (ready: ${c.ready})`);
}

console.log('\n=== Gate Engine Test ===');
const gateResult = gateEngine.evaluateTransition('agentic-sdlc', 'active');
console.log(`agentic-sdlc → active: ${gateResult.passed ? '✅ PASS' : '❌ FAIL'}`);
for (const check of gateResult.checks) {
  const icon = check.passed ? '✅' : '❌';
  console.log(`  ${icon} ${check.gate}: ${check.details}`);
}
if (gateResult.blockers.length > 0) {
  console.log('Blockers:', gateResult.blockers);
}
