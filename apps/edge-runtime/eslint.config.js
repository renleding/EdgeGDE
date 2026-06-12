import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

const RESTRICTED = ['DB', 'TENANT_KV', 'VAULT_BUCKET']

function isEnvExpr(node) {
  if (node.object?.name === 'env') return true
  if (node.object?.type === 'MemberExpression' && node.object.property.name === 'env') return true
  return false
}

function isRestrictedAccess(node) {
  return isEnvExpr(node) && node.property.type === 'Identifier' && RESTRICTED.includes(node.property.name)
}

const firewallRule = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid direct access to Cloudflare bindings outside secure wrappers' },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replace(/\\/g, '/')
    const allowed = ['src/lib/db.ts', 'src/lib/kv.ts', 'src/lib/r2.ts', 'src/queues/kb-ingest.ts', 'src/crons/dispatcher.ts', 'src/lib/ui-schemas.ts', 'src/middleware/tenant-resolver.ts']
    if (allowed.some(f => filename.endsWith(f))) return {}

    return {
      MemberExpression(node) {
        if (isRestrictedAccess(node)) {
          context.report({
            node,
            message: `[Architecture Violation] Direct access to '${node.property.name}' is prohibited. Use wrappers in src/lib/.`
          })
        }
      },
      VariableDeclarator(node) {
        if (!node.init || node.init.type !== 'MemberExpression') return
        if (isRestrictedAccess(node.init)) {
          context.report({
            node,
            message: '[Security Violation] Aliasing infrastructure bindings is prohibited.'
          })
        }
      },
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return
        if (isRestrictedAccess(node.callee.object)) {
          context.report({
            node,
            message: '[Architecture Violation] Direct calls on infrastructure bindings are prohibited.'
          })
        }
      },
    }
  },
}

export default [
  { ignores: ['dist/', 'node_modules/', '.wrangler/'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'warn',
    },
  },
  {
    files: ['**/*.ts'],
    plugins: { local: { rules: { 'no-raw-storage-access': firewallRule } } },
    rules: { 'local/no-raw-storage-access': 'error' },
  },
]
