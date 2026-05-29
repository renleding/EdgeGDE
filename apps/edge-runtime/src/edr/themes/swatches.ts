/**
 * OneEnd Design System — Swatch Library
 * 10 curated design styles with full color palettes, typography, spacing, and component specs.
 *
 * @packageDocumentation
 */

export interface SwatchColor {
  name: string
  value: string
  description: string
}

export interface SwatchTypography {
  font: string
  category: 'heading' | 'body' | 'mono'
  weights: number[]
  sizes: { name: string; value: string }[]
}

export interface SwatchComponent {
  name: string
  preview: string
  variants: string[]
}

export interface SwatchDesign {
  id: string
  name: string
  tagline: string
  description: string
  author: string
  category: string[]
  colors: {
    palette: SwatchColor[]
    semantic: { label: string; value: string }[]
  }
  typography: SwatchTypography[]
  spacing: { base: string; scale: string[] }
  components: SwatchComponent[]
  elevation: { name: string; shadow: string }[]
  dos: string[]
  donts: string[]
  downloads: number
  likes: number
  version: string
}

export const SWATCH_LIBRARY: SwatchDesign[] = [
  {
    id: 'atmospheric-glass',
    name: 'Atmospheric Glass',
    tagline: 'Dark frosted elegance',
    description: 'A deep navy glassmorphism design system with translucent surfaces, layered blur effects, and subtle border highlights. Built for premium financial applications that need to convey trust and sophistication.',
    author: 'EdgeGDE',
    category: ['dark', 'glass', 'premium'],
    colors: {
      palette: [
        { name: 'Primary', value: '#6366F1', description: 'CTAs, active states, links, interactive highlights' },
        { name: 'Primary Hover', value: '#4F46E5', description: 'Darker indigo for hover states' },
        { name: 'Background', value: '#0B1326', description: 'Page background, deep navy' },
        { name: 'Surface', value: 'rgba(255,255,255,0.12)', description: 'Glass card surface' },
        { name: 'Text Primary', value: '#FFFFFF', description: 'Headings and primary labels' },
        { name: 'Text Secondary', value: 'rgba(255,255,255,0.75)', description: 'Descriptions and secondary labels' },
        { name: 'Border', value: 'rgba(255,255,255,0.18)', description: 'Card borders, subtle glass edge' },
        { name: 'Input Background', value: 'rgba(255,255,255,0.18)', description: 'Input field surface' },
        { name: 'Success', value: '#51CF66', description: 'Positive indicators, surplus' },
        { name: 'Error', value: '#FF6B6B', description: 'Destructive actions, validation errors' },
        { name: 'Warning', value: '#FCC419', description: 'Caution states' },
      ],
      semantic: [
        { label: 'Primary', value: '#6366F1' },
        { label: 'Secondary', value: '#0B1326' },
        { label: 'Neutral', value: 'rgba(255,255,255,0.75)' },
        { label: 'Background', value: '#0B1326' },
        { label: 'Surface', value: 'rgba(255,255,255,0.12)' },
      ],
    },
    typography: [
      {
        font: 'Inter', category: 'heading', weights: [600, 700],
        sizes: [{ name: 'Large', value: '42px' }, { name: 'Medium', value: '24px' }, { name: 'Small', value: '18px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '16px' }, { name: 'Small', value: '14px' }, { name: 'Caption', value: '12px' }],
      },
    ],
    spacing: { base: '8px', scale: ['4px', '8px', '16px', '24px', '32px', '48px', '64px'] },
    components: [
      { name: 'Primary Button', preview: 'White filled, rounded 18px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Glass surface, rounded 18px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Glass Card', preview: 'Translucent with blur backdrop', variants: ['Section', 'Subsection'] },
      { name: 'Select', preview: 'Glass surface with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 8px 32px rgba(0,0,0,0.25)' },
      { name: 'Hover', shadow: '0 12px 40px rgba(0,0,0,0.35)' },
      { name: 'Modal', shadow: '0 24px 64px rgba(0,0,0,0.4)' },
    ],
    dos: [
      'Use translucent surfaces for layered depth',
      'Maintain 8px spacing grid for all elements',
      'Use glass blur effect on cards and inputs',
      'Keep borders subtle — light opacity only',
      'Use white for primary interactive elements on dark surfaces',
    ],
    donts: [
      'Use pure black — the deep navy background is the darkest value',
      'Stack more than three glass layers — depth flattens',
      'Use solid backgrounds on cards — glass should be translucent',
      'Mix border opacities — keep consistent at 0.12-0.18',
      'Use shadows on static elements — reserve for interactive states',
    ],
    downloads: 3842, likes: 1214, version: '1.0',
  },
  {
    id: 'minimal-edge',
    name: 'Minimal Edge',
    tagline: 'Clean, sharp, distraction-free',
    description: 'A minimalist design system built on tight spacing, sharp corners, and generous white space. No gradients, no shadows, no glass — just pure typographic hierarchy and precise grids.',
    author: 'EdgeGDE',
    category: ['minimal', 'clean', 'light'],
    colors: {
      palette: [
        { name: 'Primary', value: '#1A1A2E', description: 'CTAs, headers, active indicators' },
        { name: 'Primary Hover', value: '#16213E', description: 'Slightly darker for hover' },
        { name: 'Background', value: '#FAFAFA', description: 'Page background, warm white' },
        { name: 'Surface', value: '#FFFFFF', description: 'Cards, panels, modals' },
        { name: 'Text Primary', value: '#1A1A2E', description: 'Headings and body text' },
        { name: 'Text Secondary', value: '#6B7280', description: 'Descriptions, placeholders' },
        { name: 'Border', value: '#E5E7EB', description: 'Card borders, dividers' },
        { name: 'Input Background', value: '#F3F4F6', description: 'Input field surface' },
        { name: 'Success', value: '#10B981', description: 'Positive indicators' },
        { name: 'Error', value: '#EF4444', description: 'Errors and destructive actions' },
        { name: 'Warning', value: '#F59E0B', description: 'Warning states' },
      ],
      semantic: [
        { label: 'Primary', value: '#1A1A2E' },
        { label: 'Secondary', value: '#6B7280' },
        { label: 'Neutral', value: '#E5E7EB' },
        { label: 'Background', value: '#FAFAFA' },
        { label: 'Surface', value: '#FFFFFF' },
      ],
    },
    typography: [
      {
        font: 'Inter', category: 'heading', weights: [500, 600, 700],
        sizes: [{ name: 'Large', value: '32px' }, { name: 'Medium', value: '20px' }, { name: 'Small', value: '16px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '15px' }, { name: 'Small', value: '13px' }, { name: 'Caption', value: '11px' }],
      },
    ],
    spacing: { base: '4px', scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px'] },
    components: [
      { name: 'Primary Button', preview: 'Dark filled, sharp 4px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Light gray, sharp 4px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'White with subtle border', variants: ['Default', 'Bordered', 'Elevated'] },
      { name: 'Select', preview: 'Light gray with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 1px 3px rgba(0,0,0,0.06)' },
      { name: 'Hover', shadow: '0 4px 12px rgba(0,0,0,0.08)' },
      { name: 'Modal', shadow: '0 8px 24px rgba(0,0,0,0.12)' },
    ],
    dos: [
      'Use sharp corners (4px radius) consistently across all elements',
      'Maintain generous white space between sections',
      'Use only one font weight per hierarchy level',
      'Keep card borders light and recessive',
      'Use color only for interactive elements and hierarchy',
    ],
    donts: [
      'Add shadows to every element — minimal means minimal elevation',
      'Use rounded corners larger than 4px',
      'Mix more than two typefaces on a single page',
      'Use saturated colors for non-interactive elements',
      'Stack cards — use generous padding instead',
    ],
    downloads: 2810, likes: 934, version: '1.0',
  },
  {
    id: 'premium-suite',
    name: 'Premium Suite',
    tagline: 'Luxurious, spacious, refined',
    description: 'A premium design system with generous spacing, large radius, soft elevation, and a warm inviting palette. Designed for high-end service applications where every pixel communicates quality.',
    author: 'EdgeGDE',
    category: ['premium', 'warm', 'light'],
    colors: {
      palette: [
        { name: 'Primary', value: '#8B5CF6', description: 'CTAs, active states, links' },
        { name: 'Primary Hover', value: '#7C3AED', description: 'Darker purple for hover' },
        { name: 'Background', value: '#F8F6FE', description: 'Page background, soft lavender tint' },
        { name: 'Surface', value: '#FFFFFF', description: 'Cards, panels, modals' },
        { name: 'Text Primary', value: '#1F1B2E', description: 'Headings and body text' },
        { name: 'Text Secondary', value: '#6D6390', description: 'Descriptions and labels' },
        { name: 'Border', value: '#E8E3F5', description: 'Subtle lavender borders' },
        { name: 'Input Background', value: '#F3F0FF', description: 'Input field surface' },
        { name: 'Success', value: '#34D399', description: 'Positive indicators' },
        { name: 'Error', value: '#FB7185', description: 'Errors and destructive actions' },
        { name: 'Warning', value: '#FBBF24', description: 'Warning states' },
      ],
      semantic: [
        { label: 'Primary', value: '#8B5CF6' },
        { label: 'Secondary', value: '#6D6390' },
        { label: 'Neutral', value: '#E8E3F5' },
        { label: 'Background', value: '#F8F6FE' },
        { label: 'Surface', value: '#FFFFFF' },
      ],
    },
    typography: [
      {
        font: 'Playfair Display', category: 'heading', weights: [500, 600, 700],
        sizes: [{ name: 'Large', value: '40px' }, { name: 'Medium', value: '28px' }, { name: 'Small', value: '20px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '16px' }, { name: 'Small', value: '14px' }, { name: 'Caption', value: '12px' }],
      },
    ],
    spacing: { base: '12px', scale: ['8px', '12px', '20px', '32px', '48px', '64px', '96px'] },
    components: [
      { name: 'Primary Button', preview: 'Purple filled, rounded 14px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Lavender tint, rounded 14px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'White with soft purple border', variants: ['Default', 'Elevated', 'Highlighted'] },
      { name: 'Select', preview: 'Lavender surface with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 4px 16px rgba(139,92,246,0.08)' },
      { name: 'Hover', shadow: '0 8px 32px rgba(139,92,246,0.12)' },
      { name: 'Modal', shadow: '0 20px 60px rgba(139,92,246,0.15)' },
    ],
    dos: [
      'Use generous padding — premium feels spacious',
      'Use the serif heading font for a refined editorial feel',
      'Keep purple accents consistent across interactive elements',
      'Use soft lavender tones for surfaces and borders',
      'Layer elevation with purple-tinted shadows',
    ],
    donts: [
      'Cram elements — premium requires breathing room',
      'Use the serif font for body text — it\'s for headings only',
      'Use pure gray — stay in the lavender/warm range',
      'Use strong contrast borders — keep them soft and subtle',
      'Mix elevation heights within the same card set',
    ],
    downloads: 2190, likes: 803, version: '1.0',
  },
  {
    id: 'neutral-studio',
    name: 'Neutral Studio',
    tagline: 'Balanced, versatile, professional',
    description: 'A balanced design system for professional applications that need to feel neutral and trustworthy. Medium contrast, subtle elevation, and a restrained palette that works across any brand color.',
    author: 'EdgeGDE',
    category: ['neutral', 'clean', 'professional'],
    colors: {
      palette: [
        { name: 'Primary', value: '#2563EB', description: 'CTAs, active states, links' },
        { name: 'Primary Hover', value: '#1D4ED8', description: 'Darker blue for hover' },
        { name: 'Background', value: '#F8FAFC', description: 'Page background, cool white' },
        { name: 'Surface', value: '#FFFFFF', description: 'Cards, panels, modals' },
        { name: 'Text Primary', value: '#0F172A', description: 'Headings and body text' },
        { name: 'Text Secondary', value: '#475569', description: 'Descriptions and labels' },
        { name: 'Border', value: '#E2E8F0', description: 'Slate borders and dividers' },
        { name: 'Input Background', value: '#F1F5F9', description: 'Input field surface' },
        { name: 'Success', value: '#22C55E', description: 'Positive indicators' },
        { name: 'Error', value: '#EF4444', description: 'Errors and destructive actions' },
        { name: 'Warning', value: '#EAB308', description: 'Warning states' },
      ],
      semantic: [
        { label: 'Primary', value: '#2563EB' },
        { label: 'Secondary', value: '#475569' },
        { label: 'Neutral', value: '#E2E8F0' },
        { label: 'Background', value: '#F8FAFC' },
        { label: 'Surface', value: '#FFFFFF' },
      ],
    },
    typography: [
      {
        font: 'Inter', category: 'heading', weights: [500, 600, 700],
        sizes: [{ name: 'Large', value: '36px' }, { name: 'Medium', value: '22px' }, { name: 'Small', value: '18px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '16px' }, { name: 'Small', value: '14px' }, { name: 'Caption', value: '12px' }],
      },
    ],
    spacing: { base: '8px', scale: ['4px', '8px', '16px', '24px', '32px', '48px', '72px'] },
    components: [
      { name: 'Primary Button', preview: 'Blue filled, rounded 8px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Slate tint, rounded 8px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'White with slate border', variants: ['Default', 'Elevated', 'Interactive'] },
      { name: 'Select', preview: 'Slate surface with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 1px 3px rgba(0,0,0,0.08)' },
      { name: 'Hover', shadow: '0 4px 12px rgba(0,0,0,0.1)' },
      { name: 'Modal', shadow: '0 10px 40px rgba(0,0,0,0.12)' },
    ],
    dos: [
      'Use the slate palette consistently — warm grays break the system',
      'Keep card radius at 8px for all standard components',
      'Use blue as the single accent color',
      'Maintain the 8px spacing grid for layout consistency',
      'Use medium-weight text for all interactive labels',
    ],
    donts: [
      'Use pure black text — slate-900 is the darkest approved value',
      'Mix accent colors — only blue is approved for interactive elements',
      'Use rounded corners larger than 8px on standard components',
      'Apply shadows to borderless cards',
      'Use different border colors for cards vs inputs',
    ],
    downloads: 1845, likes: 675, version: '1.0',
  },
  {
    id: 'bold-impact',
    name: 'Bold Impact',
    tagline: 'Strong, vivid, commanding',
    description: 'A bold design system built for attention. High contrast, spacious layouts, strong typography, and vivid accent colors. Designed for marketing sites, landing pages, and brand showcases.',
    author: 'EdgeGDE',
    category: ['bold', 'dark', 'marketing'],
    colors: {
      palette: [
        { name: 'Primary', value: '#FF6B35', description: 'CTAs, active states, highlights' },
        { name: 'Primary Hover', value: '#E85D2C', description: 'Darker orange for hover' },
        { name: 'Background', value: '#0F0F1A', description: 'Page background, near-black' },
        { name: 'Surface', value: '#1A1A2E', description: 'Cards, panels, modals' },
        { name: 'Text Primary', value: '#FFFFFF', description: 'Headings and primary labels' },
        { name: 'Text Secondary', value: '#A0A0B8', description: 'Descriptions and labels' },
        { name: 'Border', value: '#2A2A40', description: 'Bold borders on dark' },
        { name: 'Input Background', value: '#1A1A2E', description: 'Input field surface' },
        { name: 'Success', value: '#00D68F', description: 'Positive indicators' },
        { name: 'Error', value: '#FF3B5C', description: 'Errors and destructive actions' },
        { name: 'Warning', value: '#FFB400', description: 'Warning states' },
      ],
      semantic: [
        { label: 'Primary', value: '#FF6B35' },
        { label: 'Secondary', value: '#1A1A2E' },
        { label: 'Neutral', value: '#A0A0B8' },
        { label: 'Background', value: '#0F0F1A' },
        { label: 'Surface', value: '#1A1A2E' },
      ],
    },
    typography: [
      {
        font: 'Inter', category: 'heading', weights: [700, 800, 900],
        sizes: [{ name: 'Display', value: '56px' }, { name: 'Large', value: '40px' }, { name: 'Medium', value: '28px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500, 600],
        sizes: [{ name: 'Body', value: '18px' }, { name: 'Small', value: '15px' }, { name: 'Caption', value: '13px' }],
      },
    ],
    spacing: { base: '8px', scale: ['8px', '16px', '24px', '40px', '56px', '80px', '120px'] },
    components: [
      { name: 'Primary Button', preview: 'Orange filled, sharp 4px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Dark surface, rounded 8px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'Dark elevated surface', variants: ['Default', 'Bordered', 'Highlighted'] },
      { name: 'Select', preview: 'Dark surface with bold chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 4px 20px rgba(255,107,53,0.15)' },
      { name: 'Hover', shadow: '0 8px 32px rgba(255,107,53,0.25)' },
      { name: 'Modal', shadow: '0 20px 60px rgba(0,0,0,0.5)' },
    ],
    dos: [
      'Use bold typography weights — 700 minimum for headings',
      'Use orange as the single accent color throughout',
      'Use spacious padding — bold needs room to breathe',
      'Use orange-tinted shadows for elevation depth',
      'Use high contrast between surfaces and text',
    ],
    donts: [
      'Use subtle or thin typography — bold requires weight',
      'Use round corners larger than 8px',
      'Use muted or pastel colors — the palette is intentionally saturated',
      'Stack elements close together — bold needs white space',
      'Use the secondary text color for primary actions',
    ],
    downloads: 1632, likes: 542, version: '1.0',
  },
  {
    id: 'dark-matter',
    name: 'Dark Matter',
    tagline: 'Deep, immersive, technical',
    description: 'An ultra-dark design system for developer tools, dashboards, and technical applications. Deep charcoal surfaces, electric blue accents, and precise typography for data-dense interfaces.',
    author: 'EdgeGDE',
    category: ['dark', 'technical', 'dashboard'],
    colors: {
      palette: [
        { name: 'Primary', value: '#38BDF8', description: 'CTAs, active states, data highlights' },
        { name: 'Primary Hover', value: '#0EA5E9', description: 'Darker blue for hover' },
        { name: 'Background', value: '#050814', description: 'Page background, deepest blue-black' },
        { name: 'Surface', value: '#0D1117', description: 'Cards, panels, code blocks' },
        { name: 'Text Primary', value: '#E6EDF3', description: 'Headings and primary text' },
        { name: 'Text Secondary', value: '#8B949E', description: 'Descriptions, line numbers' },
        { name: 'Border', value: '#21262D', description: 'Code-style borders' },
        { name: 'Input Background', value: '#161B22', description: 'Input surface' },
        { name: 'Success', value: '#3FB950', description: 'Git-style green for positive' },
        { name: 'Error', value: '#F85149', description: 'Errors and destructive' },
        { name: 'Warning', value: '#D29922', description: 'Warning states' },
      ],
      semantic: [
        { label: 'Primary', value: '#38BDF8' },
        { label: 'Secondary', value: '#0D1117' },
        { label: 'Neutral', value: '#21262D' },
        { label: 'Background', value: '#050814' },
        { label: 'Surface', value: '#0D1117' },
      ],
    },
    typography: [
      {
        font: 'JetBrains Mono', category: 'mono', weights: [400, 500, 600],
        sizes: [{ name: 'Large', value: '28px' }, { name: 'Medium', value: '18px' }, { name: 'Small', value: '14px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '14px' }, { name: 'Small', value: '12px' }, { name: 'Caption', value: '11px' }],
      },
    ],
    spacing: { base: '8px', scale: ['2px', '4px', '8px', '12px', '16px', '24px', '32px'] },
    components: [
      { name: 'Primary Button', preview: 'Blue filled, sharp 2px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Dark surface, sharp 2px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'Dark with code-style border', variants: ['Default', 'Bordered', 'Interactive'] },
      { name: 'Select', preview: 'Dark surface with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 2px 8px rgba(0,0,0,0.4)' },
      { name: 'Hover', shadow: '0 4px 16px rgba(0,0,0,0.5)' },
      { name: 'Modal', shadow: '0 16px 48px rgba(0,0,0,0.6)' },
    ],
    dos: [
      'Use monospace for headings — reinforces the developer tool feel',
      'Keep corners sharp (2px) for a technical precision look',
      'Use electric blue as the primary accent against deep dark',
      'Use tight spacing — data-dense layouts need efficiency',
      'Use code-style borders for card elements',
    ],
    donts: [
      'Use rounded corners — this system is deliberately sharp',
      'Use font weights below 500 for any interactive text',
      'Use saturated colors beyond the electric blue accent',
      'Use generous white space — this is a dense information design',
      'Use the mono font for body text — it\'s display-only',
    ],
    downloads: 1428, likes: 487, version: '1.0',
  },
  {
    id: 'ocean-depth',
    name: 'Ocean Depth',
    tagline: 'Calm, fluid, trustworthy',
    description: 'A blue-themed design system inspired by ocean depths. Calm primary blues, teal accents, and generous rounded shapes create a trustworthy feel for finance and wellness applications.',
    author: 'EdgeGDE',
    category: ['blue', 'calm', 'finance'],
    colors: {
      palette: [
        { name: 'Primary', value: '#0891B2', description: 'CTAs, active states, links' },
        { name: 'Primary Hover', value: '#0E7490', description: 'Darker cyan for hover' },
        { name: 'Background', value: '#F0F9FF', description: 'Page background, sky tint' },
        { name: 'Surface', value: '#FFFFFF', description: 'Cards, panels, modals' },
        { name: 'Text Primary', value: '#164E63', description: 'Headings, deep teal' },
        { name: 'Text Secondary', value: '#5D8A9C', description: 'Descriptions and labels' },
        { name: 'Border', value: '#CFFAFE', description: 'Light cyan borders' },
        { name: 'Input Background', value: '#ECFEFF', description: 'Input field surface' },
        { name: 'Success', value: '#14B8A6', description: 'Teal success indicators' },
        { name: 'Error', value: '#F43F5E', description: 'Errors and destructive actions' },
        { name: 'Warning', value: '#F59E0B', description: 'Warning states' },
      ],
      semantic: [
        { label: 'Primary', value: '#0891B2' },
        { label: 'Secondary', value: '#5D8A9C' },
        { label: 'Neutral', value: '#CFFAFE' },
        { label: 'Background', value: '#F0F9FF' },
        { label: 'Surface', value: '#FFFFFF' },
      ],
    },
    typography: [
      {
        font: 'Inter', category: 'heading', weights: [500, 600, 700],
        sizes: [{ name: 'Large', value: '38px' }, { name: 'Medium', value: '24px' }, { name: 'Small', value: '18px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '16px' }, { name: 'Small', value: '14px' }, { name: 'Caption', value: '12px' }],
      },
    ],
    spacing: { base: '8px', scale: ['4px', '8px', '16px', '24px', '32px', '48px', '64px'] },
    components: [
      { name: 'Primary Button', preview: 'Cyan filled, rounded 12px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Sky tint, rounded 12px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'White with cyan border', variants: ['Default', 'Elevated', 'Highlighted'] },
      { name: 'Select', preview: 'Sky surface with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 2px 10px rgba(8,145,178,0.08)' },
      { name: 'Hover', shadow: '0 6px 20px rgba(8,145,178,0.12)' },
      { name: 'Modal', shadow: '0 16px 48px rgba(8,145,178,0.15)' },
    ],
    dos: [
      'Use cyan/teal as the single accent color palette',
      'Use rounded corners (12px) generously for a calm feel',
      'Use sky-tinted backgrounds for a light, airy feel',
      'Keep card borders in the cyan family — never gray',
      'Use generous spacing for readability and calm',
    ],
    donts: [
      'Use pure black text — deep teal carries the theme',
      'Use gray borders — stay in the cyan/teal range',
      'Use sharp corners — rounded shapes support the calm feel',
      'Use saturated backgrounds — keep them light and airy',
      'Mix accent colors — only cyan and teal are approved',
    ],
    downloads: 1287, likes: 410, version: '1.0',
  },
  {
    id: 'aurora-light',
    name: 'Aurora Light',
    tagline: 'Gradient, ethereal, creative',
    description: 'An ethereal design system with soft gradient backgrounds, pastel accents, and generous rounded elements. Built for creative portfolios, lifestyle apps, and wellness platforms.',
    author: 'EdgeGDE',
    category: ['gradient', 'light', 'creative'],
    colors: {
      palette: [
        { name: 'Primary', value: '#C084FC', description: 'CTAs, active states, highlights' },
        { name: 'Primary Hover', value: '#A855F7', description: 'Darker purple for hover' },
        { name: 'Gradient Start', value: '#FDF2F8', description: 'Page background start (pink)' },
        { name: 'Gradient End', value: '#EDE9FE', description: 'Page background end (purple)' },
        { name: 'Surface', value: 'rgba(255,255,255,0.85)', description: 'Cards with backdrop blur' },
        { name: 'Text Primary', value: '#2E1065', description: 'Headings, deep purple' },
        { name: 'Text Secondary', value: '#7C6B9A', description: 'Descriptions and labels' },
        { name: 'Border', value: 'rgba(192,132,252,0.2)', description: 'Soft purple borders' },
        { name: 'Input Background', value: 'rgba(255,255,255,0.6)', description: 'Input with blur' },
        { name: 'Success', value: '#6EE7B7', description: 'Positive indicators' },
        { name: 'Error', value: '#FB7185', description: 'Errors and destructive' },
        { name: 'Warning', value: '#FCD34D', description: 'Warning states' },
      ],
      semantic: [
        { label: 'Primary', value: '#C084FC' },
        { label: 'Secondary', value: '#A855F7' },
        { label: 'Neutral', value: 'rgba(192,132,252,0.2)' },
        { label: 'Background', value: 'radial-gradient(ellipse, #FDF2F8, #EDE9FE)' },
        { label: 'Surface', value: 'rgba(255,255,255,0.85)' },
      ],
    },
    typography: [
      {
        font: 'DM Sans', category: 'heading', weights: [400, 500, 700],
        sizes: [{ name: 'Large', value: '36px' }, { name: 'Medium', value: '24px' }, { name: 'Small', value: '18px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '15px' }, { name: 'Small', value: '13px' }, { name: 'Caption', value: '11px' }],
      },
    ],
    spacing: { base: '8px', scale: ['4px', '8px', '16px', '24px', '40px', '56px', '80px'] },
    components: [
      { name: 'Primary Button', preview: 'Purple filled, rounded 16px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Frosted glass, rounded 16px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'Frosted with purple border', variants: ['Default', 'Elevated', 'Interactive'] },
      { name: 'Select', preview: 'Frosted glass with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 4px 20px rgba(192,132,252,0.12)' },
      { name: 'Hover', shadow: '0 8px 32px rgba(192,132,252,0.18)' },
      { name: 'Modal', shadow: '0 20px 60px rgba(192,132,252,0.2)' },
    ],
    dos: [
      'Use frosted glass surfaces for a light, ethereal feel',
      'Use generous rounded corners — 16px minimum',
      'Use the pink-to-purple gradient as the page background',
      'Use DM Sans for headings for a clean geometric look',
      'Keep frosted surfaces semi-transparent to show the gradient beneath',
    ],
    donts: [
      'Use solid white backgrounds — the gradient is the canvas',
      'Use dark saturated colors on frosted surfaces',
      'Use sharp corners — ethereal requires soft edges',
      'Use pure black text — deep purple maintains the palette',
      'Stack frosted cards without spacing — they need visual separation',
    ],
    downloads: 1085, likes: 367, version: '1.0',
  },
  {
    id: 'ember-glow',
    name: 'Ember Glow',
    tagline: 'Warm, passionate, energetic',
    description: 'A warm-toned design system with amber and rose accents. Built for hospitality, food, and lifestyle brands that need to convey warmth, passion, and energy.',
    author: 'EdgeGDE',
    category: ['warm', 'bold', 'hospitality'],
    colors: {
      palette: [
        { name: 'Primary', value: '#F97316', description: 'CTAs, active states, highlights' },
        { name: 'Primary Hover', value: '#EA580C', description: 'Darker amber for hover' },
        { name: 'Background', value: '#FFFBEB', description: 'Page background, warm cream' },
        { name: 'Surface', value: '#FFFFFF', description: 'Cards, panels, modals' },
        { name: 'Text Primary', value: '#292524', description: 'Headings, warm brown' },
        { name: 'Text Secondary', value: '#78716C', description: 'Descriptions and labels' },
        { name: 'Border', value: '#FED7AA', description: 'Light amber borders' },
        { name: 'Input Background', value: '#FFF7ED', description: 'Input surface' },
        { name: 'Success', value: '#84CC16', description: 'Lime green for positive' },
        { name: 'Error', value: '#E11D48', description: 'Rose for errors' },
        { name: 'Warning', value: '#F59E0B', description: 'Amber warning' },
      ],
      semantic: [
        { label: 'Primary', value: '#F97316' },
        { label: 'Secondary', value: '#78716C' },
        { label: 'Neutral', value: '#FED7AA' },
        { label: 'Background', value: '#FFFBEB' },
        { label: 'Surface', value: '#FFFFFF' },
      ],
    },
    typography: [
      {
        font: 'DM Serif Display', category: 'heading', weights: [400, 600],
        sizes: [{ name: 'Large', value: '44px' }, { name: 'Medium', value: '30px' }, { name: 'Small', value: '22px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '17px' }, { name: 'Small', value: '14px' }, { name: 'Caption', value: '12px' }],
      },
    ],
    spacing: { base: '8px', scale: ['4px', '8px', '16px', '28px', '40px', '60px', '88px'] },
    components: [
      { name: 'Primary Button', preview: 'Amber filled, rounded 10px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'Warm cream, rounded 10px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'White with amber border', variants: ['Default', 'Elevated', 'Highlighted'] },
      { name: 'Select', preview: 'Warm cream with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 2px 12px rgba(249,115,22,0.08)' },
      { name: 'Hover', shadow: '0 6px 24px rgba(249,115,22,0.14)' },
      { name: 'Modal', shadow: '0 18px 56px rgba(249,115,22,0.18)' },
    ],
    dos: [
      'Use the serif heading font for a warm editorial feel',
      'Use amber as the single warm accent throughout',
      'Use warm cream backgrounds for a cozy feel',
      'Keep all border colors in the amber family',
      'Use generous spacing — warm design needs breathing room',
    ],
    donts: [
      'Use cool blues or grays — the palette is intentionally warm',
      'Use the serif font for body text',
      'Use flat white backgrounds — cream is warmer',
      'Use sharp corners — rounded shapes feel more welcoming',
      'Use dark saturated backgrounds — the cream is the canvas',
    ],
    downloads: 924, likes: 312, version: '1.0',
  },
  {
    id: 'slate-core',
    name: 'Slate Core',
    tagline: 'Corporate, structured, reliable',
    description: 'A corporate-grade design system with a restrained slate palette, precise typography, and clear information hierarchy. Built for enterprise applications, B2B dashboards, and internal tools.',
    author: 'EdgeGDE',
    category: ['corporate', 'clean', 'enterprise'],
    colors: {
      palette: [
        { name: 'Primary', value: '#334155', description: 'CTAs, headers, active states' },
        { name: 'Primary Hover', value: '#1E293B', description: 'Darker slate for hover' },
        { name: 'Background', value: '#F8FAFC', description: 'Page background' },
        { name: 'Surface', value: '#FFFFFF', description: 'Cards, panels, modals' },
        { name: 'Text Primary', value: '#0F172A', description: 'Headings and body' },
        { name: 'Text Secondary', value: '#64748B', description: 'Descriptions, metadata' },
        { name: 'Border', value: '#CBD5E1', description: 'Standard borders' },
        { name: 'Input Background', value: '#FFFFFF', description: 'Input surface' },
        { name: 'Success', value: '#16A34A', description: 'Positive indicators' },
        { name: 'Error', value: '#DC2626', description: 'Errors and destructive' },
        { name: 'Warning', value: '#D97706', description: 'Warning states' },
      ],
      semantic: [
        { label: 'Primary', value: '#334155' },
        { label: 'Secondary', value: '#64748B' },
        { label: 'Neutral', value: '#CBD5E1' },
        { label: 'Background', value: '#F8FAFC' },
        { label: 'Surface', value: '#FFFFFF' },
      ],
    },
    typography: [
      {
        font: 'Inter', category: 'heading', weights: [500, 600, 700],
        sizes: [{ name: 'Large', value: '30px' }, { name: 'Medium', value: '20px' }, { name: 'Small', value: '16px' }],
      },
      {
        font: 'Inter', category: 'body', weights: [400, 500],
        sizes: [{ name: 'Body', value: '14px' }, { name: 'Small', value: '12px' }, { name: 'Caption', value: '11px' }],
      },
    ],
    spacing: { base: '8px', scale: ['2px', '4px', '8px', '12px', '16px', '24px', '32px'] },
    components: [
      { name: 'Primary Button', preview: 'Slate filled, sharp 4px', variants: ['Default', 'Hover', 'Disabled'] },
      { name: 'Input Field', preview: 'White, sharp 4px', variants: ['Default', 'Focused', 'Error'] },
      { name: 'Card', preview: 'White with slate border', variants: ['Default', 'Bordered', 'Elevated'] },
      { name: 'Select', preview: 'White with chevron', variants: ['Default', 'Open', 'Selected'] },
    ],
    elevation: [
      { name: 'Card', shadow: '0 1px 2px rgba(0,0,0,0.05)' },
      { name: 'Hover', shadow: '0 4px 8px rgba(0,0,0,0.08)' },
      { name: 'Modal', shadow: '0 8px 24px rgba(0,0,0,0.12)' },
    ],
    dos: [
      'Use the full slate palette — all grays come from the slate family',
      'Keep corners consistently at 4px across all components',
      'Use tight spacing for information density',
      'Use the single typeface (Inter) with weight-only hierarchy',
      'Use minimal elevation — subtle shadows only',
    ],
    donts: [
      'Use colored accents beyond the slate primary',
      'Use rounded corners larger than 4px on standard components',
      'Use elevated shadows on standard cards',
      'Use more than two font sizes on a single screen',
      'Use different border shades for different components',
    ],
    downloads: 856, likes: 298, version: '1.0',
  },
]

export function getSwatchById(id: string): SwatchDesign | undefined {
  return SWATCH_LIBRARY.find(s => s.id === id)
}
