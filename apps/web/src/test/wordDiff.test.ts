import { describe, expect, it } from 'vitest'
import { diffWords, normalizeWord, splitInheritedTitle } from '../lib/wordDiff'

describe('diffWords', () => {
  it('marks shared content words as kept and maps them to the source word', () => {
    const tokens = diffWords(
      'I want to test whether my neighborhood can support a bakery that helps busy families.',
      'Turn a bakery into a weekly gathering for busy families',
    )
    expect(tokens.map(({ text, kind }) => [text, kind])).toEqual([
      ['Turn', 'new'],
      ['a', 'neutral'],
      ['bakery', 'kept'],
      ['into', 'neutral'],
      ['a', 'neutral'],
      ['weekly', 'new'],
      ['gathering', 'new'],
      ['for', 'neutral'],
      ['busy', 'kept'],
      ['families', 'kept'],
    ])
    expect(tokens[2]!.sourceIndex).toBe(10)
    expect(tokens[9]!.sourceIndex).toBe(14)
  })

  it('matches across punctuation, case, plurals and reordering', () => {
    const tokens = diffWords(
      'Families need a Bakery.',
      'bakeries, for families',
    )
    expect(tokens.map(({ kind }) => kind)).toEqual(['kept', 'neutral', 'kept'])
    expect(tokens[0]!.sourceIndex).toBe(3)
    expect(tokens[2]!.sourceIndex).toBe(0)
  })

  it('assigns repeated words to distinct source positions when possible', () => {
    const tokens = diffWords('bread and bread', 'bread bread bread')
    expect(tokens.map(({ sourceIndex }) => sourceIndex)).toEqual([0, 2, 0])
  })

  it('keeps hyphenated words whole', () => {
    expect(normalizeWord('Low-cost,')).toBe('low-cost')
    expect(diffWords('a low-cost test', 'low cost')[0]!.kind).toBe('new')
  })
})

describe('splitInheritedTitle', () => {
  it('separates the inherited parent prefix from the new suffix', () => {
    expect(
      splitInheritedTitle(
        'Turn a bakery into a playbook: one-table tasting',
        'Turn a bakery into a playbook',
      ),
    ).toEqual({
      inherited: 'Turn a bakery into a playbook',
      own: 'one-table tasting',
    })
  })

  it('accepts a truncated inherited prefix and ignores unrelated colons', () => {
    expect(
      splitInheritedTitle(
        'Turn a bakery…: weekend bake',
        'Turn a bakery into x',
      ).own,
    ).toBe('weekend bake')
    expect(splitInheritedTitle('Plan: a fair', 'Something else')).toEqual({
      inherited: null,
      own: 'Plan: a fair',
    })
  })
})
