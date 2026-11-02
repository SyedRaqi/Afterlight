import { supabase, supabaseUrl } from './supabase'

const profilePhotoBucket = 'profile-photos'
const profilePhotoTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const maxProfilePhotoBytes = 5 * 1024 * 1024
const profilePhotoPathPattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/avatar\.(jpg|png|webp)$/i

export function validateProfilePhoto(file: File) {
  if (!profilePhotoTypes.has(file.type)) {
    return 'Choose a JPG, PNG, or WebP image.'
  }
  if (file.size > maxProfilePhotoBytes) {
    return 'Profile photos must be 5 MB or smaller.'
  }
  return null
}

export function getOwnedProfilePhotoPath(value: string | null, userId: string) {
  if (!value || !supabaseUrl) return null

  try {
    const url = new URL(value)
    const configuredOrigin = new URL(supabaseUrl).origin
    const prefix = `/storage/v1/object/public/${profilePhotoBucket}/`
    if (url.origin !== configuredOrigin || !url.pathname.startsWith(prefix)) return null

    const path = decodeURIComponent(url.pathname.slice(prefix.length))
    const match = path.match(profilePhotoPathPattern)
    return match?.[1].toLowerCase() === userId.toLowerCase() ? path : null
  } catch {
    return null
  }
}

export async function uploadProfilePhoto(file: File, userId: string) {
  if (!supabase) throw new Error('Connect Supabase before uploading a profile photo.')
  const validationError = validateProfilePhoto(file)
  if (validationError) throw new Error(validationError)

  const extension = profilePhotoTypes.get(file.type)
  if (!extension) throw new Error('This image format is not supported.')

  const path = `${userId}/avatar.${extension}`
  const { error } = await supabase.storage
    .from(profilePhotoBucket)
    .upload(path, file, {
      cacheControl: '0',
      contentType: file.type,
      upsert: true,
    })
  if (error) throw new Error(`Profile photo upload failed: ${error.message}`)

  const { data } = supabase.storage.from(profilePhotoBucket).getPublicUrl(path)
  return { path, url: `${data.publicUrl}?v=${Date.now()}` }
}

export async function removeProfilePhoto(path: string) {
  if (!supabase) throw new Error('Connect Supabase before removing a profile photo.')
  const { error } = await supabase.storage.from(profilePhotoBucket).remove([path])
  if (error) throw new Error(`Could not remove the profile photo: ${error.message}`)
}
