import { describe, expect, it } from 'vitest'
import { parsePartialJson } from '../src/model/partialJson'

describe('parsePartialJson', () => {
  it('drops a key cut off mid-string', () => {
    expect(parsePartialJson('{"candidates":[{"key":"k1","ti')).toEqual({
      candidates: [{ key: 'k1' }],
    })
  })

  it('keeps an open value string', () => {
    expect(parsePartialJson('{"title":"A promising')).toEqual({
      title: 'A promising',
    })
  })

  it('drops a number cut off at the end of the prefix', () => {
    expect(parsePartialJson('{"scores":{"intent":1,"decision":2')).toEqual({
      scores: { intent: 1 },
    })
  })

  it('keeps escaped quotes and drops an incomplete unicode escape', () => {
    expect(parsePartialJson('{"text":"A quote: \\"')).toEqual({
      text: 'A quote: "',
    })
    expect(parsePartialJson('{"text":"snow \\u12')).toEqual({
      text: 'snow ',
    })
  })

  it('closes nested arrays and drops the unfinished number', () => {
    expect(parsePartialJson('{"nested":[[1,2],[3')).toEqual({
      nested: [[1, 2], []],
    })
  })

  it('returns a complete document unchanged', () => {
    const document = { candidates: [{ key: 'k1', title: 'A direction' }] }
    expect(parsePartialJson(JSON.stringify(document))).toEqual(document)
  })

  it('returns undefined before any usable value arrives', () => {
    expect(parsePartialJson('{"candidates":[')).toBeUndefined()
  })
})
