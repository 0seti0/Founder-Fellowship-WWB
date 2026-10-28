type PartialValue = {
  value: unknown
  exists: boolean
}

export function parsePartialJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {}

  let index = 0
  const skipWhitespace = () => {
    while (/\s/u.test(text[index] ?? '') && index < text.length) index += 1
  }

  function parseString(): { value: string; complete: boolean } {
    index += 1
    let value = ''
    while (index < text.length) {
      const character = text[index++]!
      if (character === '"') return { value, complete: true }
      if (character !== '\\') {
        value += character
        continue
      }
      if (index >= text.length) return { value, complete: false }
      const escape = text[index++]!
      const escaped: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      }
      if (escape === 'u') {
        const code = text.slice(index, index + 4)
        if (code.length < 4 || !/^[0-9a-f]{4}$/iu.test(code))
          return { value, complete: false }
        value += String.fromCharCode(Number.parseInt(code, 16))
        index += 4
      } else if (escape in escaped) {
        value += escaped[escape]
      } else {
        return { value, complete: false }
      }
    }
    return { value, complete: false }
  }

  function parseValue(): PartialValue {
    skipWhitespace()
    const character = text[index]
    if (character === '{') return parseObject()
    if (character === '[') return parseArray()
    if (character === '"') return { value: parseString().value, exists: true }
    if (character === '-' || (character !== undefined && /\d/u.test(character)))
      return parseToken(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u)
    if (character === 't' || character === 'f' || character === 'n')
      return parseToken(/^(?:true|false|null)$/u)
    return { value: undefined, exists: false }
  }

  function parseToken(pattern: RegExp): PartialValue {
    const start = index
    while (index < text.length && !/[\s,}\]]/u.test(text[index]!)) index += 1
    const token = text.slice(start, index)
    if (index === text.length || !pattern.test(token))
      return { value: undefined, exists: false }
    return {
      value:
        token === 'true'
          ? true
          : token === 'false'
            ? false
            : token === 'null'
              ? null
              : Number(token),
      exists: true,
    }
  }

  function parseObject(): PartialValue {
    index += 1
    const value: Record<string, unknown> = {}
    skipWhitespace()
    while (index < text.length && text[index] !== '}') {
      if (text[index] !== '"') break
      const key = parseString()
      if (!key.complete) break
      skipWhitespace()
      if (text[index] !== ':') break
      index += 1
      const parsed = parseValue()
      if (!parsed.exists) break
      value[key.value] = parsed.value
      skipWhitespace()
      if (text[index] === ',') {
        index += 1
        skipWhitespace()
        continue
      }
      if (text[index] !== '}') break
      index += 1
      return { value, exists: true }
    }
    if (text[index] === '}') index += 1
    return { value, exists: true }
  }

  function parseArray(): PartialValue {
    index += 1
    const value: unknown[] = []
    skipWhitespace()
    while (index < text.length && text[index] !== ']') {
      const parsed = parseValue()
      if (!parsed.exists) break
      value.push(parsed.value)
      skipWhitespace()
      if (text[index] === ',') {
        index += 1
        skipWhitespace()
        continue
      }
      if (text[index] !== ']') break
      index += 1
      return { value, exists: true }
    }
    if (text[index] === ']') index += 1
    return { value, exists: true }
  }

  const parsed = parseValue()
  if (!parsed.exists || !hasUsableContent(parsed.value)) return undefined
  return parsed.value
}

function hasUsableContent(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0
  if (Array.isArray(value)) return value.some(hasUsableContent)
  if (value && typeof value === 'object')
    return Object.values(value).some(hasUsableContent)
  return value !== undefined
}
