/**
 * EdgeGDE Canvas — Website clone quality tests.
 *
 * @packageDocumentation
 */

import assert from 'node:assert'
import { cloneWebsite } from '../../src/cloner/website-cloner'
import type { CanvasDocument, Node } from '../../src/canvas/canvas-types'

let passed = 0
let failed = 0

function run(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.message}`)
  }
}

run('cloneWebsite — marks first h1 plus CTA section as hero with horizontal layout', () => {
  const html = `
    <html>
      <body>
        <header>
          <nav>
            <a href="/plans">Plans</a>
            <a href="/pricing">Pricing</a>
            <a href="/contact">Contact</a>
          </nav>
        </header>
        <main>
          <section>
            <h1>Build better asymmetric exercise</h1>
            <p>Science-backed workouts for modern athletes.</p>
            <a href="/start">Start now</a>
            <button>Learn more</button>
          </section>
          <section>
            <h2>Features</h2>
            <p>Body shaping and strength training.</p>
          </section>
        </main>
      </body>
    </html>
  `
  const doc = cloneWebsite('https://example.com', html)
  const hero = findFirstRole(doc, 'hero')
  const nav = findFirstRole(doc, 'nav')

  assert.ok(hero, 'Should infer a hero section')
  assert.strictEqual(hero?.style.display, 'flex')
  assert.strictEqual(hero?.style.flexDirection, 'row')
  assert.strictEqual(hero?.style.alignItems, 'center')
  assert.strictEqual(hero?.style.justifyContent, 'space-between')
  assert.ok(hero?.style.gap, 'Should add hero gap')
  assert.ok(hero?.style.padding, 'Should add hero padding')
  assert.ok(nav, 'Should infer nav section')
  assert.strictEqual(nav?.style.flexDirection, 'row')
  assert.ok(findText(doc, 'Build better asymmetric exercise'), 'Should preserve hero h1')
  assert.ok(findText(doc, 'Start now'), 'Should preserve hero CTA link text')
  assert.ok(findText(doc, 'Learn more'), 'Should preserve hero button text')
})

run('cloneWebsite — keeps hero content grouped instead of flattening it into root', () => {
  const html = `
    <html>
      <body>
        <section>
          <h1>Asymmetry Training</h1>
          <button>Book a session</button>
        </section>
        <section>
          <h2>Proof</h2>
          <p>Evidence-based movement.</p>
        </section>
      </body>
    </html>
  `
  const doc = cloneWebsite('https://example.com', html)
  const hero = findFirstRole(doc, 'hero')

  if (!hero) throw new Error('Hero section not found')
  assert.strictEqual(hero.parentId, doc.rootId)
  assert.ok(hero.children.some(id => doc.nodes[id]?.type === 'Text' && doc.nodes[id]?.props?.level === 1), 'Hero should contain h1')
  assert.ok(hero.children.some(id => doc.nodes[id]?.type === 'Button'), 'Hero should contain CTA button')
  assert.ok(doc.nodes[doc.rootId].children.includes(hero.id), 'Hero should remain a direct root child')
})

console.log(`\nWebsite Clone Quality: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

function findFirstRole(doc: CanvasDocument, role: string): Node | undefined {
  return Object.values(doc.nodes).find(node => node.props?.role === role)
}

function findText(doc: CanvasDocument, text: string): boolean {
  return Object.values(doc.nodes).some(node => node.props?.text === text || node.props?.href?.includes(text))
}
