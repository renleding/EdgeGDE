/**
 * EdgeGDE Canvas — CSS Token Extractor
 * Step 2: Pattern-based token inference from CSS classes.
 *
 * Fetches external stylesheets, parses CSS rules, and maps
 * class patterns to DesignTokens. NOT computed style resolution —
 * we read what the CSS CLASSES say, not what the browser computes.
 *
 * @packageDocumentation
 */

import type { DesignTokens } from '../lib/design-parser'

interface CSSRule {
  selectors: string[]
  declarations: Record<string, string>
  specificity: number
}

/**
 * Parse a CSS string into an array of rules.
 * Also builds a variable map for resolving var() references.
 */
function parseCSS(css: string): { rules: CSSRule[]; variables: Record<string, string> } {
  const rules: CSSRule[] = []
  const variables: Record<string, string> = {}
  // Remove comments
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  
  // Extract :root and * variable declarations first
  const rootRegex = /(:root|\*)\s*\{([^}]*)\}/g
  let rm: RegExpExecArray | null
  while ((rm = rootRegex.exec(css)) !== null) {
    for (const decl of rm[2].split(';')) {
      const colon = decl.indexOf(':')
      if (colon === -1) continue
      const prop = decl.slice(0, colon).trim()
      const val = decl.slice(colon + 1).trim()
      if (prop.startsWith('--') && val) variables[prop] = val
    }
  }
  
  // Resolve a value by following variable references
  function resolveValue(val: string): string {
    const varMatch = val.match(/var\((--[^,)\s]+)/)
    if (varMatch) {
      const resolved = variables[varMatch[1]]
      if (resolved) return resolveValue(resolved)
    }
    return val
  }
  
  // Match rule blocks: selector { declarations }
  const blockRegex = /([^{]+)\{([^}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(css)) !== null) {
    const rawSelectors = match[1].trim()
    const rawDeclarations = match[2].trim()
    if (!rawSelectors || !rawDeclarations) continue
    
    const selectors = rawSelectors.split(',').map(s => s.trim()).filter(Boolean)
    const declarations: Record<string, string> = {}
    
    for (const decl of rawDeclarations.split(';')) {
      const colon = decl.indexOf(':')
      if (colon === -1) continue
      const prop = decl.slice(0, colon).trim()
      const val = decl.slice(colon + 1).trim()
      if (prop && val) declarations[prop] = resolveValue(val)
    }
    
    if (Object.keys(declarations).length === 0) continue
    
    let specificity = 0
    for (const sel of selectors) {
      if (sel.startsWith('#')) specificity += 100
      else if (sel.startsWith('.')) specificity += 10
      else specificity += 1
    }
    
    rules.push({ selectors, declarations, specificity })
  }
  
  return { rules, variables }
}

/**
 * Match a class name against CSS rules and extract token-relevant properties.
 */
function matchClassToStyle(className: string, rules: CSSRule[]): Record<string, string> {
  const classSelector = '.' + className
  const matches: Array<{ specificity: number; declarations: Record<string, string> }> = []
  
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      // Direct class match: .classname or tag.classname
      if (sel === classSelector || sel.endsWith(classSelector)) {
        matches.push({ specificity: rule.specificity, declarations: rule.declarations })
        break
      }
      // Compound selector containing .classname (e.g., .classname > div, div.classname.other)
      if (sel.includes(classSelector + ' ') || sel.includes(' ' + classSelector) || sel.includes(classSelector + '.')) {
        matches.push({ specificity: rule.specificity, declarations: rule.declarations })
        break
      }
    }
  }
  
  // Sort by specificity descending, return highest
  matches.sort((a, b) => b.specificity - a.specificity)
  return matches[0]?.declarations || {}
}

/**
 * Extract a DesignTokens object from CSS rules and class usage in HTML.
 * 
 * @param cssText - Raw CSS text from stylesheets
 * @param classNames - Set of class names used in the page (from class attributes)
 * @returns Extracted design tokens
 */
export function extractTokensFromCSS(
  cssText: string,
  classNames: Set<string>
): Partial<DesignTokens> {
  const { rules } = parseCSS(cssText)
  const tokens: Partial<DesignTokens> = {
    colors: {},
    typography: {},
    spacing: {},
  }
  
  const foundColors: string[] = []
  const foundFonts: string[] = []
  const foundRadii: string[] = []
  const foundFontSizes: string[] = []
  
  // Map CSS property names to our token names
  const keyMapping: Record<string, string> = {
    'background-color': 'backgroundColor',
    'background': 'backgroundColor',
    'color': 'color',
    'font-family': 'fontFamily',
    'font-size': 'fontSize',
    'font-weight': 'fontWeight',
    'border-radius': 'borderRadius',
    'padding': 'padding',
    'gap': 'gap',
  }
  
  for (const className of classNames) {
    if (!className.trim()) continue
    const style = matchClassToStyle(className, rules)
    
    for (const [prop, val] of Object.entries(style)) {
      const mapped = keyMapping[prop]
      if (!mapped) continue
      
      if (prop === 'background-color' || prop === 'background') {
        if (val.startsWith('#') || val.startsWith('rgb')) foundColors.push(val)
      } else if (prop === 'color') {
        if (val.startsWith('#') || val.startsWith('rgb')) foundColors.push(val)
      } else if (prop === 'font-family') {
        const clean = val.replace(/['"]/g, '').split(',')[0].trim()
        if (clean && !clean.includes(' ')) foundFonts.push(clean)
      } else if (prop === 'font-size') {
        foundFontSizes.push(val)
      } else if (prop === 'border-radius') {
        foundRadii.push(val)
      }
    }
  }
  
  // Bucket colors by frequency
  if (foundColors.length > 0) {
    const freq = new Map<string, number>()
    for (const c of foundColors) freq.set(c, (freq.get(c) || 0) + 1)
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])
    
    // Assign: most common bg-like colors → background/surface, text-like → text
    for (const [color] of sorted) {
      if (!tokens.colors!.background && !color.startsWith('#f')) {
        tokens.colors!.background = color
      } else if (!tokens.colors!.text) {
        tokens.colors!.text = color
      } else if (!tokens.colors!.primary) {
        tokens.colors!.primary = color
      } else if (!tokens.colors!.surface) {
        tokens.colors!.surface = color
      } else break
    }
  }
  
  // Fonts
  if (foundFonts.length > 0) {
    tokens.typography!.fontFamily = foundFonts[0]
  }
  if (foundFontSizes.length > 0) {
    tokens.typography!.fontSize = tokens.typography!.fontSize || {}
    tokens.typography!.fontSize!.body = foundFontSizes[0]
  }
  
  // Spacing
  if (foundRadii.length > 0) {
    tokens.spacing!.borderRadius = foundRadii[0]
  }
  
  return tokens
}

/**
 * Fetch and parse CSS from a page's stylesheet links.
 */
export async function fetchStylesheets(html: string, baseUrl: string): Promise<string> {
  let cssText = ''
  const linkRegex = /<link[^>]*href=["']([^"']+\.css[^"']*)["'][^>]*>/gi
  let match: RegExpExecArray | null
  
  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1]
    // Resolve relative URLs
    if (href.startsWith('/')) {
      const url = new URL(baseUrl)
      href = url.origin + href
    } else if (!href.startsWith('http')) {
      href = new URL(href, baseUrl).href
    }
    
    try {
      const res = await fetch(href)
      if (res.ok) {
        cssText += await res.text() + '\n'
      }
    } catch {
      // Skip failed fetches silently
    }
  }
  
  return cssText
}

/**
 * Extract all class names from parsed HTML class attributes.
 */
export function extractClassNames(html: string): Set<string> {
  const classRegex = /\sclass=["']([^"']*)["']/gi
  const names = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = classRegex.exec(html)) !== null) {
    for (const cls of match[1].split(/\s+/)) {
      if (cls.trim()) names.add(cls.trim())
    }
  }
  return names
}
