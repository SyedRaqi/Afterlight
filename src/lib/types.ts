export type Classification = 'FACT' | 'RESEARCH' | 'PREDICTION' | 'POSSIBILITY' | 'IMAGINATION'
export type Role = 'member' | 'contributor' | 'editor' | 'administrator'

export interface Category {
  id: string
  name: string
  slug: string
  description: string | null
}

export interface Article {
  id: string
  author_id?: string
  title: string
  slug: string
  summary: string
  classification: Classification
  body?: string
  introduction?: string | null
  background?: string | null
  current_understanding?: string | null
  future_possibilities?: string | null
  limitations?: string | null
  published_at: string | null
  reading_minutes: number
  hero_image_url: string | null
  author: { display_name: string; avatar_url: string | null } | null
  category: { name: string; slug: string } | null
}

export interface Notification {
  id: string
  kind: 'submission_approved' | 'submission_published' | 'submission_returned' | 'submission_rejected' | 'editorial_update' | 'comment_report_resolved' | 'comment_moderated'
  title: string
  message: string
  read_at: string | null
  created_at: string
  article: { slug: string } | null
}

export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  role: Role
}
