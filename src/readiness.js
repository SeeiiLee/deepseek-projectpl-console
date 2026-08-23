const READINESS_PREFIX = 'dsh web: '
const READINESS_PATTERN = /^dsh web: (http:\/\/127\.0\.0\.1:([1-9]\d{0,4}))$/
const DEFAULT_MAX_BUFFER_LENGTH = 65_536

/**
 * Parse one complete Harness readiness line into a trusted loopback URL.
 * @param {string} line One stdout line from the Harness helper.
 * @returns {URL | undefined} The trusted URL, or undefined for unrelated output.
 */
export function parseReadinessLine(line) {
  const match = READINESS_PATTERN.exec(line)
  if (match === null) {
    if (line.startsWith(READINESS_PREFIX)) {
      throw new Error(`Harness emitted an untrusted readiness line: ${line}`)
    }
    return undefined
  }

  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Harness emitted an invalid readiness port: ${match[2]}`)
  }
  return new URL(match[1])
}

/**
 * Incrementally split UTF-8 process output into complete lines.
 * @param {(line: string) => void} onLine Complete-line consumer.
 * @param {number} maxBufferLength Maximum unterminated line length.
 * @returns {{ push(chunk: string): void, flush(): void }} Stream decoder.
 */
export function createLineDecoder(onLine, maxBufferLength = DEFAULT_MAX_BUFFER_LENGTH) {
  let pending = ''
  return {
    push(chunk) {
      pending += chunk
      for (;;) {
        const end = pending.indexOf('\n')
        if (end === -1) {
          if (pending.length > maxBufferLength) {
            throw new Error(`Harness emitted a line longer than ${maxBufferLength} characters.`)
          }
          return
        }
        const line = pending.slice(0, end).replace(/\r$/, '')
        pending = pending.slice(end + 1)
        onLine(line)
      }
    },
    flush() {
      if (pending === '') return
      onLine(pending.replace(/\r$/, ''))
      pending = ''
    },
  }
}
