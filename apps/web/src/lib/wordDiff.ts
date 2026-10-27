export type WordKind = 'kept' | 'new' | 'neutral'

export type WordToken = {
  text: string
  key: string
  kind: WordKind
  sourceIndex: number | null
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'before',
  'by',
  'can',
  'could',
  'do',
  'for',
  'from',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'over',
  'so',
  'than',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'want',
  'was',
  'what',
  'whether',
  'which',
  'while',
  'who',
  'will',
  'with',
  'would',
  'you',
  'your',
])

export function normalizeWord(word: string) {
  const bare = word
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']s$/u, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (bare.length > 3 && bare.endsWith('ies')) return `${bare.slice(0, -3)}y`
  if (bare.length > 3 && bare.endsWith('s') && !bare.endsWith('ss'))
    return bare.slice(0, -1)
  return bare
}

export function tokenizeSentence(text: string) {
  return text.split(/\s+/u).filter(Boolean)
}

export function diffWords(source: string, target: string): WordToken[] {
  const sourceIndices = new Map<string, number[]>()
  tokenizeSentence(source).forEach((word, index) => {
    const key = normalizeWord(word)
    if (!key || STOP_WORDS.has(key)) return
    sourceIndices.set(key, [...(sourceIndices.get(key) ?? []), index])
  })
  const used = new Set<number>()
  return tokenizeSentence(target).map((text) => {
    const key = normalizeWord(text)
    if (!key || STOP_WORDS.has(key))
      return { text, key, kind: 'neutral', sourceIndex: null }
    const candidates = sourceIndices.get(key)
    if (!candidates) return { text, key, kind: 'new', sourceIndex: null }
    const sourceIndex =
      candidates.find((index) => !used.has(index)) ?? candidates[0]!
    used.add(sourceIndex)
    return { text, key, kind: 'kept', sourceIndex }
  })
}

export function splitInheritedTitle(title: string, parentTitle: string) {
  const separator = title.lastIndexOf(': ')
  if (separator <= 0) return { inherited: null, own: title }
  const inherited = title.slice(0, separator)
  const parentPrefix = parentTitle.split(': ', 1)[0] ?? parentTitle
  const comparable = inherited.replace(/…$/u, '')
  if (!parentPrefix.startsWith(comparable))
    return { inherited: null, own: title }
  return { inherited, own: title.slice(separator + 2) }
}
