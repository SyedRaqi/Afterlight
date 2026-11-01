import { supabase } from './supabase'

const imageTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
])

const maxImageBytes = 5 * 1024 * 1024

function validateImage(file: File) {
  if (!imageTypes.has(file.type)) {
    throw new Error('Choose a JPG, PNG, WebP, or AVIF image.')
  }
  if (file.size > maxImageBytes) {
    throw new Error('Images must be 5 MB or smaller.')
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

  return {
    path,
    publicUrl: supabase.storage.from('article-images').getPublicUrl(path).data.publicUrl,
  }
}

export async function removeArticleImage(path: string) {
  if (!supabase) throw new Error('Connect Supabase before removing an image.')
  const { error } = await supabase.storage.from('article-images').remove([path])
  if (error) throw new Error(`Could not remove the unused image: ${error.message}`)
}
