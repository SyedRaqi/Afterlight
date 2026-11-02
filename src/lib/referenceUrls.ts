export function normalizeReferenceUrls(input: string) {
  const urls: string[] = []
  const seen = new Set<string>()
  let hasInvalidUrl = false
  let hasDuplicates = false

  for (const line of input.split(/\r?\n/)) {
    const candidate = line.trim()
    if (!candidate) continue

    try {
      const url = new URL(candidate)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        hasInvalidUrl = true
        continue
      }

      // URL serialization normalizes scheme/host and equivalent URL syntax,
      // while preserving path, query, and fragment meaning.
      const normalized = url.href
      if (seen.has(normalized)) {
        hasDuplicates = true
        continue
      }
      seen.add(normalized)
      urls.push(normalized)
    } catch {
      hasInvalidUrl = true
    }
  }

  return { urls, hasInvalidUrl, hasDuplicates }
}
