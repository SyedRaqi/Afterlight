import { supabase, supabaseUrl } from './supabase'

const imageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
])

const maxImageBytes = 5 * 1024 * 1024
const signedUrlLifetimeSeconds = 60 * 60
const signedUrlRefreshLeadMs = 5 * 60 * 1000
const signedUrlRetryCooldownMs = 10 * 1000

export interface ResolvedArticleImageUrl {
  url: string
  expiresAt: number | null
  retryAfterAt?: number
}

interface CachedArticleImageUrl extends ResolvedArticleImageUrl {
  expiresAt: number
}

const signedUrlCache = new Map<string, CachedArticleImageUrl>()
const pendingSignedUrls = new Map<string, Promise<CachedArticleImageUrl>>()
const refreshCooldowns = new Map<string, number>()

const articleImagePathPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$/i
const legacyObjectPrefixes = [
  '/storage/v1/object/public/article-images/',
  '/storage/v1/object/sign/article-images/',
]

function validateImage(file: File) {
  if (!imageTypes.has(file.type)) {
    throw new Error('Choose a JPG, PNG, WebP, or AVIF image.')
  }
  if (file.size > maxImageBytes) {
    throw new Error('Images must be 5 MB or smaller.')
  }
}

function toStorageObjectPath(value: string) {
  if (articleImagePathPattern.test(value)) return value
  if (!supabase) return null

  try {
    const url = new URL(value)
    const configuredOrigin = supabaseUrl ? new URL(supabaseUrl).origin : null
    const prefix = legacyObjectPrefixes.find((candidate) => configuredOrigin !== null && url.origin === configuredOrigin && url.pathname.toLowerCase().startsWith(candidate))
    if (!prefix) return null

    const path = decodeURIComponent(url.pathname.slice(prefix.length))
    return articleImagePathPattern.test(path) ? path : null
  } catch {
    return null
  }
}

function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export async function uploadArticleImage(file: File, userId: string) {
  if (!supabase) throw new Error('Connect Supabase before uploading an image.')
  validateImage(file)

  const extension = imageTypes.get(file.type)
  if (!extension) throw new Error('The image format is not supported.')

  const path = `${userId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage
    .from('article-images')
    .upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false })
  if (error) throw new Error(`Image upload failed: ${error.message}`)

  return { path }
}

export async function getArticleImageUrl(value: string | null, refreshIfUrl?: string): Promise<ResolvedArticleImageUrl | null> {
  if (!value) return null

  const objectPath = toStorageObjectPath(value)
  if (!objectPath) {
    if (isHttpUrl(value)) return { url: value, expiresAt: null }
    return null
  }
  if (!supabase) return null

  const { data: sessionData } = await supabase.auth.getSession()
  const cacheKey = `${sessionData.session?.user.id ?? 'anon'}:${objectPath}`
  const now = Date.now()
  const cached = signedUrlCache.get(cacheKey)
  if (cached && cached.expiresAt - signedUrlRefreshLeadMs > now && (!refreshIfUrl || cached.url !== refreshIfUrl)) return cached

  const pending = pendingSignedUrls.get(cacheKey)
  if (pending) return pending

  if (refreshIfUrl && cached?.url === refreshIfUrl) {
    const cooldownEndsAt = refreshCooldowns.get(cacheKey) ?? 0
    if (cooldownEndsAt > now) return { ...cached, retryAfterAt: cooldownEndsAt + 250 }
    refreshCooldowns.set(cacheKey, now + signedUrlRetryCooldownMs)
  }

  const request = supabase.storage
    .from('article-images')
    .createSignedUrl(objectPath, signedUrlLifetimeSeconds)
    .then(({ data, error }) => {
      if (error) throw new Error(`Could not load the article image: ${error.message}`)
      const result: CachedArticleImageUrl = {
        url: data.signedUrl,
        expiresAt: Date.now() + signedUrlLifetimeSeconds * 1000,
      }
      signedUrlCache.set(cacheKey, result)
      refreshCooldowns.delete(cacheKey)
      return result
    })
    .finally(() => pendingSignedUrls.delete(cacheKey))

  pendingSignedUrls.set(cacheKey, request)
  return request
}

export async function removeArticleImage(path: string) {
  if (!supabase) throw new Error('Connect Supabase before removing an image.')
  const { error } = await supabase.storage.from('article-images').remove([path])
  if (error) throw new Error(`Could not remove the unused image: ${error.message}`)
}
