module.exports = {
  rules: {
    'no-raw-storage-access': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow direct access to Cloudflare bindings'
        },
        schema: []
      },

      create(context) {
        const filename = context.getFilename().replace(/\\/g, '/')

        const allowedFiles = [
          'src/lib/db.ts',
          'src/lib/kv.ts',
          'src/lib/r2.ts',
          'src/queues/kb-ingest.ts'
        ]

        const isAllowed = allowedFiles.some(f => filename.endsWith(f))
        if (isAllowed) return {}

        function isEnvBinding(node) {
          // env.DB
          if (node.object?.name === 'env') return true

          // c.env.DB or ctx.env.DB
          if (
            node.object?.type === 'MemberExpression' &&
            node.object.property.name === 'env'
          ) {
            return true
          }

          return false
        }

        const restricted = ['DB', 'TENANT_KV', 'VAULT_BUCKET']

        return {
          // direct access: env.DB
          MemberExpression(node) {
            if (!isEnvBinding(node)) return
            if (
              node.property.type === 'Identifier' &&
              restricted.includes(node.property.name)
            ) {
              context.report({
                node,
                message: `[Architecture Violation] Direct access to '${node.property.name}' is prohibited. Use wrappers in src/lib/.`
              })
            }
          },

          // alias protection: const db = c.env.DB
          VariableDeclarator(node) {
            if (!node.init || node.init.type !== 'MemberExpression') return
            if (isEnvBinding(node.init)) {
              context.report({
                node,
                message: '[Security Violation] Aliasing infrastructure bindings is prohibited.'
              })
            }
          },

          // call protection: c.env.DB.prepare(...)
          CallExpression(node) {
            if (node.callee.type !== 'MemberExpression') return
            if (isEnvBinding(node.callee.object)) {
              context.report({
                node,
                message: '[Architecture Violation] Direct calls on infrastructure bindings are prohibited.'
              })
            }
          }
        }
      }
    }
  }
}
