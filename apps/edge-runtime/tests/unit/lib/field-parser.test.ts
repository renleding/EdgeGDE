import { describe, it, expect } from 'vitest'
import { parseField } from '../../../src/lib/field-parser'

describe('parseField — shared behavior', () => {
  it('returns error for empty input', () => {
    const r = parseField('any', '   ')
    expect(r.status).toBe('error')
    expect(r.completed).toBe(false)
    expect(r.error).toBe('Please provide a value')
    expect(r.raw).toBe('')
  })

  it('recognizes unknown patterns', () => {
    for (const raw of ["don't know", "dont know", 'not sure', 'unsure', 'idk', 'n/a', 'na', 'skip', 'pass', 'unknown', '?', "i don't know", "i'm not sure", "i haven't decided", "can't say", 'rather not say']) {
      const r = parseField('fullName', raw)
      expect(r.status).toBe('unknown')
      expect(r.value).toBeNull()
      expect(r.completed).toBe(true)
      expect(r.confidence).toBe(1)
    }
  })
})

describe('parseField — fullName', () => {
  it('rejects greetings with error', () => {
    for (const g of ['hi', 'hello', 'hey', 'yo', 'sup', 'good morning', 'good day', 'howdy', 'greetings', 'how are you', "what's up", 'nice to meet you']) {
      const r = parseField('fullName', g)
      expect(r.status).toBe('error')
      expect(r.error).toBe('Please provide your full name')
    }
  })

  it('rejects names shorter than 2 chars', () => {
    const r = parseField('fullName', 'A')
    expect(r.status).toBe('error')
    expect(r.error).toBe('Name must be at least 2 characters')
  })

  it('accepts valid names with 0.95 confidence', () => {
    const r = parseField('fullName', 'Sam Smith')
    expect(r.status).toBe('ok')
    expect(r.value).toBe('Sam Smith')
    expect(r.completed).toBe(true)
    expect(r.confidence).toBe(0.95)
  })
})

describe('parseField — email', () => {
  it('rejects missing @', () => {
    expect(parseField('email', 'nope').status).toBe('error')
    expect(parseField('email', 'nope').error).toBe('Please provide a valid email address')
  })

  it('rejects multiple @ or missing domain dot', () => {
    expect(parseField('email', 'a@b@c.com').status).toBe('error')
    expect(parseField('email', 'a@b').status).toBe('error')
    expect(parseField('email', '@b.com').status).toBe('error')
  })

  it('accepts valid email lowercased', () => {
    const r = parseField('emailAddress', 'Warren@Example.com')
    expect(r.status).toBe('ok')
    expect(r.value).toBe('warren@example.com')
  })
})

describe('parseField — phone', () => {
  it('rejects non-10-digit or non-04 numbers', () => {
    expect(parseField('phone', '123').status).toBe('error')
    expect(parseField('phone', '041234567').status).toBe('error') // 9 digits
    expect(parseField('phone', '0512345678').status).toBe('error') // not 04
    expect(parseField('phone', '04123456789').status).toBe('error') // 11 digits
  })

  it('accepts 04-prefixed 10-digit numbers, stripping formatting', () => {
    const r = parseField('phone', '0412 345 678')
    expect(r.status).toBe('ok')
    expect(r.value).toBe('0412345678')
  })
})

describe('parseField — employmentType / loanPurpose (select)', () => {
  const EMPLOYMENT = ['Full-Time', 'Part-Time', 'Self-Employed', 'Casual']
  const PURPOSES = ['Purchase', 'Refinance', 'Construction', 'Investment']

  it('matches exact option case-insensitively', () => {
    const r = parseField('employmentType', 'self-employed', EMPLOYMENT)
    expect(r.status).toBe('ok')
    expect(r.value).toBe('Self-Employed')
  })

  it('matches prefix (e.g. "self" → "Self-Employed")', () => {
    const r = parseField('employmentType', 'self', EMPLOYMENT)
    expect(r.status).toBe('ok')
    expect(r.value).toBe('Self-Employed')
  })

  it('rejects options not in the list with error listing options', () => {
    const r = parseField('employmentType', 'Unicorn', EMPLOYMENT)
    expect(r.status).toBe('error')
    expect(r.error).toContain('Full-Time')
    expect(r.error).toContain('Self-Employed')
  })

  it('handles loanPurpose identically', () => {
    expect(parseField('loanPurpose', 'refinance', PURPOSES).value).toBe('Refinance')
    expect(parseField('loanPurpose', 'nope', PURPOSES).status).toBe('error')
  })
})

describe('parseField — numeric fields', () => {
  it('parses plain numbers', () => {
    const r = parseField('annualIncome', '85000')
    expect(r.status).toBe('ok')
    expect(r.value).toBe(85000)
  })

  it('parses formatted numbers (commas, $, %)', () => {
    expect(parseField('annualIncome', '$85,000').value).toBe(85000)
    expect(parseField('loanAmount', '1,200,000').value).toBe(1200000)
  })

  it('parses k and m suffixes', () => {
    expect(parseField('annualIncome', '120k').value).toBe(120000)
    expect(parseField('propertyValue', '1.5m').value).toBe(1500000)
  })

  it('parses approx prefixes', () => {
    expect(parseField('annualIncome', 'about 80k').value).toBe(80000)
    expect(parseField('annualIncome', 'around 90,000').value).toBe(90000)
    expect(parseField('annualIncome', 'roughly 75k').value).toBe(75000)
    expect(parseField('annualIncome', 'approximately 100k').value).toBe(100000)
  })

  it('rejects non-numeric and non-positive values', () => {
    expect(parseField('loanAmount', 'abc').status).toBe('error')
    expect(parseField('loanAmount', 'abc').error).toBe('Please enter a valid number')
    expect(parseField('loanAmount', '0').error).toBe('Please enter a positive number')
    expect(parseField('loanAmount', '-5').status).toBe('error')
  })
})

describe('parseField — boolean fields', () => {
  it('normalizes yes-like responses', () => {
    for (const v of ['yes', 'yep', 'yeah', 'y', 'correct', 'true', 'sure', 'definitely', 'absolutely']) {
      expect(parseField('isFirstHomeBuyer', v).value).toBe('Yes')
    }
  })

  it('normalizes no-like responses', () => {
    for (const v of ['no', 'nope', 'nah', 'n', 'false', 'not really', 'never']) {
      expect(parseField('hasExistingLoan', v).value).toBe('No')
    }
  })

  it('rejects non-boolean answers', () => {
    const r = parseField('isFirstHomeBuyerBool', 'maybe')
    expect(r.status).toBe('error')
    expect(r.error).toBe('Please answer Yes or No')
  })
})

describe('parseField — unknown fields', () => {
  it('accepts any value as-is for unrecognized field names', () => {
    const r = parseField('someRandomField', 'free text value')
    expect(r.status).toBe('ok')
    expect(r.value).toBe('free text value')
    expect(r.completed).toBe(true)
    expect(r.confidence).toBe(1)
  })
})
