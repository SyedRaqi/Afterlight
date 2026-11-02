import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Atom, Bookmark,
  Bell, Check, ChevronDown, CircleHelp, Compass, ExternalLink, Feather, Filter,
  Flag, FlaskConical, Globe2, Layers3, Leaf, LockKeyhole, LogIn, Menu, MessageCircle,
  Orbit, Plus, Search, Send, ShieldCheck, Sparkles, Telescope, UserRound, X,
} from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { getArticleImageUrl, removeArticleImage, uploadArticleImage, type ResolvedArticleImageUrl } from './lib/storage'
import { getOwnedProfilePhotoPath, removeProfilePhoto, uploadProfilePhoto, validateProfilePhoto } from './lib/profilePhotos'
import { normalizeReferenceUrls } from './lib/referenceUrls'
import { backendConfigured, supabase } from './lib/supabase'
import type { Article, Category, Classification, Notification } from './lib/types'

export const classifications: Classification[] = ['FACT', 'RESEARCH', 'PREDICTION', 'POSSIBILITY', 'IMAGINATION']
const categoryFallback = ['Technology', 'Environment', 'Space', 'Education', 'Society', 'Health', 'Economy']

const ResearchAssistantPage = lazy(() => import('./pages/ResearchAssistantPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

type ArticleImageState = Omit<ResolvedArticleImageUrl, 'url'> & {
  value: string | null
  url: string | null
  status: 'loading' | 'ready' | 'unavailable'
}

function useArticleImageUrl(value: string | null) {
  const [image, setImage] = useState<ArticleImageState>({ value, url: null, expiresAt: null, status: value ? 'loading' : 'unavailable' })
  const imageRef = useRef(image)
  const refreshRef = useRef<(expectedUrl?: string, afterError?: boolean) => void>(() => {})
  const stopRefreshRef = useRef<() => void>(() => {})
  const errorRefreshCount = useRef(0)

  useEffect(() => {
    let active = true
    let timer: number | undefined
    let refreshFailures = 0
    errorRefreshCount.current = 0

    const updateImage = (next: ArticleImageState) => {
      imageRef.current = next
      setImage(next)
    }

    const schedule = (delayMs: number, expectedUrl?: string, afterError = false) => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => { void refresh(expectedUrl, afterError) }, Math.max(1000, delayMs))
    }

    const refresh = async (expectedUrl?: string, afterError = false) => {
      if (!value) return
      try {
        const resolved = await getArticleImageUrl(value, expectedUrl)
        if (!active) return
        if (!resolved) {
          updateImage({ value, url: null, expiresAt: null, status: 'unavailable' })
          return
        }
        if (resolved.retryAfterAt === undefined) refreshFailures = 0
        updateImage({ value, ...resolved, status: 'ready' })
        if (resolved.retryAfterAt !== undefined) {
          schedule(resolved.retryAfterAt - Date.now(), resolved.url)
        } else if (resolved.expiresAt !== null) {
          schedule(resolved.expiresAt - Date.now() - 5 * 60 * 1000, resolved.url)
        }
      } catch {
        if (!active) return
        refreshFailures += 1
        const current = imageRef.current
        if (afterError || !current.url) {
          updateImage({ value, url: null, expiresAt: current.expiresAt, status: 'unavailable' })
        }
        if (refreshFailures >= 5) {
          stopRefreshRef.current()
          return
        }
        const backoffMs = Math.min(30_000 * 2 ** (refreshFailures - 1), 2 * 60 * 1000)
        schedule(backoffMs, expectedUrl ?? current.url ?? undefined)
      }
    }

    stopRefreshRef.current = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = undefined
    }
    refreshRef.current = (expectedUrl, afterError) => { void refresh(expectedUrl, afterError) }
    updateImage({ value, url: null, expiresAt: null, status: value ? 'loading' : 'unavailable' })
    void refresh()

    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      refreshRef.current = () => {}
      stopRefreshRef.current = () => {}
    }
  }, [value])

  const handleImageLoad = (loadedUrl: string) => {
    if (imageRef.current.value === value && imageRef.current.url === loadedUrl) errorRefreshCount.current = 0
  }

  const handleImageError = (failedUrl: string) => {
    const current = imageRef.current
    if (current.value !== value || current.url !== failedUrl) return
    if (current.expiresAt === null || errorRefreshCount.current >= 1) {
      stopRefreshRef.current()
      imageRef.current = { ...current, url: null, status: 'unavailable' }
      setImage(imageRef.current)
      return
    }
    errorRefreshCount.current += 1
    refreshRef.current(failedUrl, true)
  }

  if (image.value !== value) return { value, url: null, expiresAt: null, status: value ? 'loading' as const : 'unavailable' as const, handleImageLoad, handleImageError }
  return { ...image, handleImageLoad, handleImageError }
}

export function SubmissionReviewImage({ value, title }: { value: string | null; title: string }) {
  const image = useArticleImageUrl(value)
  if (!value) return null
  if (image.status === 'loading') return <div className="review-image-state" role="status">Loading private submission image…</div>
  if (!image.url) return <div className="review-image-state" role="status">Submission image unavailable.</div>
  return <img
    className="review-submission-image"
    src={image.url}
    alt={`Image submitted with “${title}”`}
    onLoad={() => image.handleImageLoad(image.url!)}
    onError={() => image.handleImageError(image.url!)}
  />
}

const classificationDescriptions: Record<Classification, string> = {
  FACT: 'Established information, supported by verifiable evidence.',
  RESEARCH: 'Work in progress. Findings may change as evidence develops.',
  PREDICTION: 'An evidence-based expectation about what may happen.',
  POSSIBILITY: 'A plausible future scenario, not a certainty.',
  IMAGINATION: 'A creative concept, shared openly as speculation.',
}

function useArticles() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(backendConfigured)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase
      .from('articles')
      .select('id,author_id,title,slug,summary,classification,published_at,reading_minutes,hero_image_url,author:profiles!articles_author_id_fkey(display_name,avatar_url),category:categories(name,slug)')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(60)
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else setArticles((data ?? []) as unknown as Article[])
        setLoading(false)
      })
    return () => { active = false }
  }, [])

  return { articles, loading, error }
}

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark${small ? ' brand-mark-small' : ''}`} aria-hidden="true">
      <span /><span /><span />
    </span>
  )
}

export function UserAvatar({ url, name, className = 'avatar', fallbackClassName = className }: {
  url: string | null | undefined
  name: string
  className?: string
  fallbackClassName?: string
}) {
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => setImageFailed(false), [url])

  if (url && !imageFailed) {
    return <img className={`${className} user-avatar-image`} src={url} alt="" onError={() => setImageFailed(true)} />
  }

  return <span className={`${fallbackClassName} user-avatar-fallback`} role="img" aria-label={`${name}'s AFTERLIGHT profile photo placeholder`}><Orbit size={15} strokeWidth={1.7} /></span>
}

function ProfilePhotoEditor({ profileId, displayName, photoUrl, refreshProfile }: {
  profileId: string
  displayName: string
  photoUrl: string | null
  refreshProfile: () => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState(photoUrl)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => setCurrentPhotoUrl(photoUrl), [photoUrl])
  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(selectedFile)
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [selectedFile])

  function discardSelection() {
    setSelectedFile(null)
    setMessage(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function selectPhoto(file: File | undefined) {
    if (!file) return
    const validationError = validateProfilePhoto(file)
    if (validationError) {
      setSelectedFile(null)
      setMessage({ kind: 'error', text: validationError })
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setMessage(null)
    setSelectedFile(file)
  }

  async function savePhoto() {
    if (!selectedFile || !supabase) return
    setBusy(true)
    setMessage(null)
    const previousPath = getOwnedProfilePhotoPath(currentPhotoUrl, profileId)
    let uploadedPath: string | null = null
    try {
      const uploaded = await uploadProfilePhoto(selectedFile, profileId)
      uploadedPath = uploaded.path
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: uploaded.url })
        .eq('id', profileId)
        .select('id')
        .single()
      if (updateError) throw updateError

      setCurrentPhotoUrl(uploaded.url)
      setSelectedFile(null)
      if (inputRef.current) inputRef.current.value = ''
      try {
        await refreshProfile()
      } catch {
        // The saved public URL remains available in this view; auth refresh can retry later.
      }

      if (previousPath && previousPath !== uploaded.path) {
        try {
          await removeProfilePhoto(previousPath)
        } catch {
          setMessage({ kind: 'success', text: 'Photo saved. The previous image could not be removed; you can retry after refreshing.' })
          setBusy(false)
          return
        }
      }
      setMessage({ kind: 'success', text: 'Profile photo updated.' })
    } catch (error) {
      if (uploadedPath && uploadedPath !== previousPath) {
        try { await removeProfilePhoto(uploadedPath) } catch { /* Keep the original profile photo intact. */ }
      }
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The profile photo could not be saved.' })
    } finally {
      setBusy(false)
    }
  }

  async function deletePhoto() {
    if (!supabase || !currentPhotoUrl) return
    setBusy(true)
    setMessage(null)
    const path = getOwnedProfilePhotoPath(currentPhotoUrl, profileId)
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', profileId)
        .select('id')
        .single()
      if (updateError) throw updateError

      setCurrentPhotoUrl(null)
      await refreshProfile().catch(() => {})
      if (path) {
        try {
          await removeProfilePhoto(path)
          setMessage({ kind: 'success', text: 'Profile photo removed.' })
        } catch {
          setMessage({ kind: 'error', text: 'The photo was removed from your profile, but its Storage file could not be deleted.' })
        }
      } else {
        setMessage({ kind: 'success', text: 'Profile photo removed.' })
      }
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The profile photo could not be removed.' })
    } finally {
      setBusy(false)
    }
  }

  return <section className="profile-photo-editor" aria-label="Profile photo">
    <div className="profile-photo-preview">
      <UserAvatar url={previewUrl ?? currentPhotoUrl} name={displayName} className="avatar profile-photo-avatar" fallbackClassName="avatar profile-photo-avatar" />
      <div><strong>{selectedFile ? 'Preview your photo' : 'Your profile photo'}</strong><span>JPG, PNG, or WebP · up to 5 MB</span></div>
    </div>
    <input
      ref={inputRef}
      className="profile-photo-input"
      type="file"
      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
      aria-label="Choose a profile photo"
      onChange={(event) => selectPhoto(event.currentTarget.files?.[0])}
    />
    <div className="profile-photo-actions">
      {!selectedFile ? <button type="button" className="button-secondary" disabled={busy} onClick={() => inputRef.current?.click()}>{currentPhotoUrl ? 'Change photo' : 'Upload photo'}</button> : <>
        <button type="button" className="button-primary" disabled={busy} onClick={() => void savePhoto()}>{busy ? <><span className="spinner" /> Uploading…</> : 'Save photo'}<Check size={14} /></button>
        <button type="button" className="button-text" disabled={busy} onClick={discardSelection}>Cancel</button>
      </>}
      {!selectedFile && currentPhotoUrl && <button type="button" className="button-text profile-photo-remove" disabled={busy} onClick={() => void deletePhoto()}>{busy ? 'Removing…' : 'Remove photo'}</button>}
    </div>
    {message && <div className={message.kind === 'error' ? 'inline-error' : 'success-message'} role="status">{message.text}</div>}
  </section>
}

function AppShell({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        navigate('/explore')
        window.setTimeout(() => document.getElementById('global-search')?.focus(), 0)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [navigate])

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setSignOutError(error.message)
    else setSignOutError('')
  }
  const links = [
    { to: '/', label: 'Home', icon: Orbit, end: true },
    { to: '/explore', label: 'Explore', icon: Compass },
    { to: '/discover', label: 'Discover', icon: Telescope },
    { to: '/assistant', label: 'Research assistant', icon: Sparkles },
    { to: '/community', label: 'Community', icon: Globe2 },
  ]

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? ' sidebar-open' : ''}`}>
        <Link to="/" className="brand-lockup" aria-label="Afterlight home" onClick={() => setMenuOpen(false)}>
          <Mark />
          <span className="brand-word">AFTERLIGHT</span>
        </Link>
        <div className="sidebar-label">THE FIELD GUIDE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon size={17} strokeWidth={1.7} /><span>{label}</span>
              {label === 'Explore' && <ArrowUpRight className="nav-trailing" size={14} />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-label sidebar-label-second">YOUR CORNER</div>
        <nav className="side-nav" aria-label="Your account">
          <NavLink to="/submit" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Plus size={17} strokeWidth={1.7} /><span>Submit an idea</span>
          </NavLink>
          <NavLink to="/profile" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <UserRound size={17} strokeWidth={1.7} /><span>Your profile</span>
          </NavLink>
          {profile && ['editor', 'administrator'].includes(profile.role) && (
            <NavLink to="/admin" onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <ShieldCheck size={17} strokeWidth={1.7} /><span>Editorial desk</span>
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="status-dot" />
            <span>{backendConfigured ? 'Connected to the field' : 'Field notes are offline'}</span>
          </div>
          <div className="sidebar-account">
            <UserAvatar url={profile?.avatar_url} name={profile?.display_name ?? 'Afterlight'} />
            <div className="account-copy">
              <strong>{profile?.display_name ?? (session ? 'Member' : 'Explorer')}</strong>
              <span>{profile?.role ?? (session ? 'Member' : 'Guest access')}</span>
            </div>
            {session ? (
              <button className="icon-button account-action" aria-label="Sign out" onClick={() => void signOut()}>
                <LogIn size={15} />
              </button>
            ) : <Link to="/login" className="account-signin">Sign in</Link>}
          </div>
          {signOutError && <span className="account-error">Sign out failed: {signOutError}</span>}
        </div>
      </aside>
      {menuOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="breadcrumb"><span>FIELD NOTES</span><span className="breadcrumb-slash">/</span><span className="breadcrumb-current">A living map of tomorrow</span></div>
          <div className="topbar-actions">
            <Link to="/explore" className="top-search"><Search size={15} /><span>Search the horizon</span><kbd>⌘ K</kbd></Link>
            {session && <NotificationBell userId={session.user.id} />}
            {session ? <Link to="/submit" className="top-submit"><Plus size={15} /> Share an idea</Link> : <Link to="/login" className="top-submit"><LogIn size={15} /> Join us</Link>}
          </div>
        </header>
        <AnimatePresence mode="wait">
          <motion.main key={window.location.pathname} className="page-content" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}>
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  )
}

function NotificationBell({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  async function loadNotifications() {
    if (!supabase) return
    const activeRequest = ++requestId.current
    setLoading(true)
    setError('')
    const [listResult, countResult] = await Promise.all([
      supabase.from('notifications')
        .select('id,kind,title,message,read_at,created_at,article:articles(slug)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(25),
      supabase.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null),
    ])
    if (activeRequest !== requestId.current) return
    if (listResult.error) setError(listResult.error.message)
    else setItems((listResult.data ?? []) as unknown as Notification[])
    if (countResult.error) setError((current) => current ? `${current}; ${countResult.error.message}` : countResult.error.message)
    else setUnreadCount(countResult.count ?? 0)
    setLoading(false)
  }

  useEffect(() => {
    requestId.current += 1
    setItems([])
    setUnreadCount(0)
    setOpen(false)
    void loadNotifications()
    return () => { requestId.current += 1 }
  }, [userId])

  async function openNotification(item: Notification) {
    if (!supabase) return
    if (!item.read_at) {
      const readAt = new Date().toISOString()
      const { error: updateError } = await supabase.from('notifications')
        .update({ read_at: readAt })
        .eq('id', item.id)
        .eq('user_id', userId)
      if (updateError) {
        setError(updateError.message)
        return
      }
      setItems((current) => current.map((notification) => notification.id === item.id ? { ...notification, read_at: readAt } : notification))
      setUnreadCount((current) => Math.max(0, current - 1))
    }
    setOpen(false)
    navigate(item.article?.slug ? `/article/${item.article.slug}` : '/profile')
  }

  async function markAllRead() {
    if (!supabase || unreadCount === 0) return
    const readAt = new Date().toISOString()
    const { error: updateError } = await supabase.from('notifications')
      .update({ read_at: readAt })
      .eq('user_id', userId)
      .is('read_at', null)
    if (updateError) setError(updateError.message)
    else {
      setItems((current) => current.map((item) => item.read_at ? item : { ...item, read_at: readAt }))
      setUnreadCount(0)
    }
  }

  return <div className="notification-wrap">
    <button className={`notification-trigger${open ? ' notification-open' : ''}`} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void loadNotifications() }}>
      <Bell size={16} />{unreadCount > 0 && <span className="notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>
    {open && <div className="notification-popover" role="dialog" aria-label="Notifications">
      <div className="notification-heading"><div><strong>Your signals</strong><span>{unreadCount ? `${unreadCount} unread` : 'All caught up'}</span></div><div><button onClick={() => void loadNotifications()} aria-label="Refresh notifications"><Orbit size={14} /></button><button onClick={() => void markAllRead()} disabled={unreadCount === 0}>Mark all read</button></div></div>
      {error && <div className="inline-error">{error}</div>}
      {loading ? <div className="notification-empty"><span className="spinner" />Loading signals…</div> : items.length ? <div className="notification-list">{items.map((item) => <button key={item.id} className={`notification-item${item.read_at ? '' : ' notification-unread'}`} onClick={() => void openNotification(item)}><span className="notification-item-dot" /><span><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.created_at).toLocaleString()}</small></span></button>)}</div> : <div className="notification-empty">Editorial updates and submission news will appear here.</div>}
    </div>}
  </div>
}

export function PageIntro({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return (
    <div className="page-intro">
      <div>
        <div className="eyebrow"><span className="eyebrow-line" />{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  )
}

export function ConnectionNotice() {
  if (backendConfigured) return null
  return (
    <div className="connection-notice">
      <CircleHelp size={17} />
      <span><strong>Research desk not connected.</strong> Add your Supabase URL and public anon key to <code>.env</code> to load published work and enable accounts.</span>
    </div>
  )
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-orbit"><Orbit size={23} strokeWidth={1.4} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function ClassificationTag({ value }: { value: Classification }) {
  return <span className={`classification-tag tag-${value.toLowerCase()}`}><span className="tag-dot" />{value}</span>
}

function ArticleCard({ article, featured = false }: { article: Article; featured?: boolean }) {
  const heroImage = useArticleImageUrl(article.hero_image_url)
  return (
    <Link to={`/article/${article.slug}`} className={`article-card${featured ? ' article-card-featured' : ''}`}>
      {heroImage.url ? (
        <div className="article-image"><img className="article-image-file" src={heroImage.url} alt="" onLoad={() => heroImage.handleImageLoad(heroImage.url!)} onError={() => heroImage.handleImageError(heroImage.url!)} /></div>
      ) : (
        <div className="article-image article-image-abstract">
          <span className="image-orbit image-orbit-one" /><span className="image-orbit image-orbit-two" /><span className="image-core" />
          <span className="image-category">{article.category?.name ?? 'FIELD NOTE'}</span>
        </div>
      )}
      <div className="article-card-body">
        <div className="article-card-meta"><ClassificationTag value={article.classification} /><span>{article.category?.name ?? 'Uncategorized'}</span></div>
        <h3>{article.title}</h3>
        <p>{article.summary}</p>
        <div className="article-card-footer">
          <span>{article.author?.display_name ?? 'Afterlight editor'}</span>
          <span>{article.published_at ? new Date(article.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recently published'}</span>
        </div>
      </div>
    </Link>
  )
}

function HomePage() {
  const { articles, loading, error } = useArticles()
  const recent = articles.slice(0, 3)
  return (
    <div className="home-page">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-marker" />A SHARED HORIZON <span className="eyebrow-divider">·</span> EST. FOR THE FUTURE</div>
          <h1>Tomorrow isn't<br />written <em>yet.</em></h1>
          <p>A place to make sense of what is, explore what could be, and imagine what comes next — with the difference always in view.</p>
          <div className="hero-actions">
            <Link to="/explore" className="button-primary">Explore the field <ArrowRight size={16} /></Link>
            <Link to="/about" className="button-text">Our point of view <ArrowUpRight size={15} /></Link>
          </div>
          <div className="hero-footnote"><span className="footnote-line" />Evidence for today. Room to wonder about tomorrow.</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-star star-a" /><div className="hero-star star-b" /><div className="hero-star star-c" />
          <div className="hero-planet"><div className="planet-glow" /><div className="planet-land" /><div className="planet-cloud cloud-a" /><div className="planet-cloud cloud-b" /></div>
          <div className="hero-ring hero-ring-one" /><div className="hero-ring hero-ring-two" />
          <div className="hero-orbit-label"><span>01</span> THE KNOWN / THE POSSIBLE</div>
          <div className="hero-coordinate">41° 24' 12.2" N<br />02° 10' 26.5" E</div>
        </div>
        <div className="hero-index"><span>01</span> — 05 <ArrowDownRight size={14} /></div>
      </section>

      <div className="principle-strip">
        <span className="principle-lead">ONE IMPORTANT DISTINCTION</span>
        <span className="principle-copy">We label what we know, what we're learning, and what we're only imagining.</span>
        <Link to="/discover" className="principle-link">How we classify <ArrowRight size={14} /></Link>
      </div>

      <section className="content-section">
        <div className="section-heading">
          <div><div className="eyebrow"><span className="eyebrow-line" />THE LATEST</div><h2>Notes from the horizon<span className="lime-period">.</span></h2></div>
          <Link to="/explore" className="section-link">All field notes <ArrowUpRight size={15} /></Link>
        </div>
        {error && <div className="inline-error">Unable to load articles: {error}</div>}
        {!backendConfigured && <ConnectionNotice />}
        {loading ? <div className="loading-row"><span className="spinner" />Finding the latest field notes…</div> : recent.length ? (
          <div className="article-grid">{recent.map((article) => <ArticleCard key={article.id} article={article} />)}</div>
        ) : (
          <EmptyState title="The next chapter starts here." description="Published field notes will appear here once the Afterlight research desk is connected and editorial review is underway." action={<Link to="/discover" className="button-text">Explore our classifications <ArrowRight size={15} /></Link>} />
        )}
      </section>

      <section className="worlds-section">
        <div className="worlds-heading">
          <div className="eyebrow"><span className="eyebrow-line" />SEVEN LENSES, ONE FUTURE</div>
          <h2>Where will you<br /><em>look first?</em></h2>
          <p>The future doesn't happen in one place. Follow a thread, find its connections, and see the bigger picture.</p>
          <Link to="/explore" className="button-primary">Browse every field <ArrowRight size={16} /></Link>
        </div>
        <div className="category-list">
          {categoryFallback.map((category, index) => {
            const icons = [Atom, Leaf, Orbit, Layers3, Globe2, Sparkles, FlaskConical]
            const Icon = icons[index]
            return <Link key={category} to={`/explore?category=${encodeURIComponent(category)}`} className="category-row"><span className="category-number">0{index + 1}</span><Icon size={18} strokeWidth={1.5} /><span className="category-name">{category}</span><ArrowUpRight size={16} className="category-arrow" /></Link>
          })}
        </div>
      </section>

      <section className="classification-section">
        <div className="classification-copy"><div className="eyebrow"><span className="eyebrow-line" />A CLEARER WAY TO WONDER</div><h2>Not everything about tomorrow is a <em>fact.</em></h2><p>We give every idea a label, so curiosity never gets confused with certainty.</p><Link to="/discover" className="button-text">Meet the five labels <ArrowRight size={15} /></Link></div>
        <div className="classification-list">{classifications.map((label, index) => <Link to="/discover" className="classification-row" key={label}><span className="classification-index">0{index + 1}</span><ClassificationTag value={label} /><span className="classification-desc">{classificationDescriptions[label]}</span><ArrowUpRight size={14} /></Link>)}</div>
      </section>

      <section className="closing-cta">
        <div className="cta-star"><Sparkles size={20} /></div>
        <div><div className="eyebrow">YOUR IDEA HAS A PLACE HERE</div><h2>Bring a question.<br /><em>Leave a little wiser.</em></h2></div>
        <Link to="/submit" className="button-primary">Share an idea <ArrowRight size={16} /></Link>
        <span className="cta-orbit" aria-hidden="true" />
      </section>
      <AppFooter />
    </div>
  )
}

function ExplorePage() {
  const [searchParams] = useSearchParams()
  const [searchText, setSearchText] = useState('')
  const [category, setCategory] = useState(searchParams.get('category') ?? 'All fields')
  const [classification, setClassification] = useState('All labels')
  const [sort, setSort] = useState('newest')
  const [categories, setCategories] = useState<Category[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(backendConfigured)
  const [categoriesLoading, setCategoriesLoading] = useState(backendConfigured)
  const [error, setError] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const requestId = useRef(0)
  const pageSize = 12
  const maxResults = 10000

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase
      .from('categories')
      .select('id,name,slug,description')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setCategoryError(queryError.message)
        else {
          setCategories(data ?? [])
          const selectedCategory = searchParams.get('category')
          const match = data?.find((item) => item.slug === selectedCategory || item.name === selectedCategory)
          setCategory(match?.slug ?? 'All fields')
        }
        setCategoriesLoading(false)
      })
    return () => { active = false }
  }, [searchParams])

  useEffect(() => {
    const currentRequest = ++requestId.current
    let active = true
    const timer = window.setTimeout(() => {
      if (!supabase) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      void supabase.rpc('search_published_articles', {
        p_query: searchText.trim(),
        p_category: category === 'All fields' ? null : category,
        p_classification: classification === 'All labels' ? null : classification,
        p_sort: searchText.trim() && sort === 'newest' ? 'relevance' : sort,
        p_offset: page * pageSize,
        p_page_size: pageSize,
      }).then(({ data, error: queryError }) => {
        if (!active || currentRequest !== requestId.current) return
        if (queryError) {
          setError(queryError.message)
          if (page === 0) setArticles([])
        } else {
          const rows = (data ?? []) as ExploreArticleResult[]
          const resultArticles = rows.map((row): Article => ({
            id: row.article_id,
            author_id: row.author_id,
            title: row.title,
            slug: row.slug,
            summary: row.summary,
            classification: row.classification,
            published_at: row.published_at,
            reading_minutes: row.reading_minutes,
            hero_image_url: row.hero_image_url,
            author: { display_name: row.author_name, avatar_url: row.author_avatar_url },
            category: { name: row.category_name, slug: row.category_slug },
          }))
          setArticles((current) => page === 0 ? resultArticles : [...current, ...resultArticles])
          setTotalCount(Number(rows[0]?.total_count ?? 0))
        }
        setLoading(false)
      })
    }, searchText.trim() ? 250 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [searchText, category, classification, sort, page])

  const clearFilters = () => {
    setSearchText('')
    setCategory('All fields')
    setClassification('All labels')
    setSort('newest')
    setPage(0)
  }

  return (
    <div>
      <PageIntro eyebrow="THE OPEN ATLAS" title="Explore the horizon." description="Follow a question across disciplines. Every published note is labeled, sourced, and reviewed before it reaches you." />
      <ConnectionNotice />
      <div className="explore-toolbar">
        <label className="search-field"><Search size={17} /><input id="global-search" value={searchText} onChange={(event) => { setSearchText(event.target.value); setPage(0); if (!event.target.value.trim() && sort === 'relevance') setSort('newest') }} placeholder="Search notes, topics, questions…" aria-label="Search articles" /><kbd>↵</kbd></label>
        <label className="select-field"><Filter size={15} /><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(0) }} aria-label="Filter by category"><option value="All fields">All fields</option>{categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select><ChevronDown size={14} /></label>
        <label className="select-field select-label"><select value={classification} onChange={(event) => { setClassification(event.target.value); setPage(0) }} aria-label="Filter by classification"><option value="All labels">All labels</option>{classifications.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
        <label className="sort-field"><span>Sort</span><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(0) }} aria-label="Sort articles"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A–Z</option><option value="relevance" disabled={!searchText.trim()}>Relevance</option></select></label>
      </div>
      {categoryError && <div className="inline-error">Unable to load categories: {categoryError}</div>}
      {error && <div className="inline-error">Unable to load articles: {error}</div>}
      {categoriesLoading || (loading && page === 0) ? <div className="loading-row"><span className="spinner" />Mapping the latest notes…</div> : articles.length ? (
        <>
          <div className="results-caption">{totalCount} {totalCount === 1 ? 'FIELD NOTE' : 'FIELD NOTES'} <span>·</span> {category === 'All fields' ? 'ALL FIELDS' : categories.find((item) => item.slug === category)?.name.toUpperCase() ?? category.toUpperCase()}</div>
          <div className="article-grid explore-grid">{articles.map((article) => <ArticleCard key={article.id} article={article} />)}</div>
          {loading && <div className="loading-row"><span className="spinner" />Loading more notes…</div>}
          {articles.length < Math.min(totalCount, maxResults) && !loading && <div className="explore-pagination"><button className="button-text" onClick={() => setPage((current) => current + 1)}>Load more field notes <ArrowDownRight size={15} /></button><span>{articles.length} OF {totalCount}</span></div>}
          {totalCount > maxResults && articles.length >= maxResults && <p className="explore-limit-note">Showing the first {maxResults.toLocaleString()} results. Refine your search to see more specific notes.</p>}
        </>
      ) : <EmptyState title={backendConfigured ? 'No notes match that trail.' : 'The atlas is waiting to be connected.'} description={backendConfigured ? 'Try another search or clear one of the filters.' : 'No articles are shown until the Supabase research desk is configured and editors publish their first reviewed notes.'} action={backendConfigured ? <button className="button-text" onClick={clearFilters}>Clear filters <X size={14} /></button> : <Link to="/discover" className="button-text">How publishing works <ArrowRight size={15} /></Link>} />}
    </div>
  )
}

interface ExploreArticleResult {
  article_id: string
  author_id: string
  title: string
  slug: string
  summary: string
  classification: Classification
  published_at: string | null
  reading_minutes: number
  hero_image_url: string | null
  author_name: string
  author_avatar_url: string | null
  category_name: string
  category_slug: string
  total_count: number
}

function DiscoverPage() {
  const items = [
    { value: 'FACT' as const, heading: 'What we know', detail: 'Established information backed by verifiable evidence. Sources are linked, and claims can be checked.', icon: ShieldCheck, number: '01' },
    { value: 'RESEARCH' as const, heading: 'What we are learning', detail: 'Scientific work in progress. Methods, early results, and open questions are presented in context.', icon: FlaskConical, number: '02' },
    { value: 'PREDICTION' as const, heading: 'What evidence suggests', detail: 'A reasoned expectation, not a guarantee. Predictions include the assumptions and uncertainty behind them.', icon: Telescope, number: '03' },
    { value: 'POSSIBILITY' as const, heading: 'What could happen', detail: 'A plausible scenario drawn from current trajectories. It is one possible path among many.', icon: Orbit, number: '04' },
    { value: 'IMAGINATION' as const, heading: 'What we can dream up', detail: 'Creative speculation made explicit. These ideas are invitations to think, never claims about reality.', icon: Sparkles, number: '05' },
  ]
  return (
    <div>
      <PageIntro eyebrow="OUR EDITORIAL COMPASS" title="Know what you're reading." description="The future is full of possibilities. Clear labels make it easier to tell evidence from expectation — and both from imagination." />
      <div className="discover-lead"><div className="discover-lead-symbol"><Feather size={22} strokeWidth={1.4} /></div><p>Curiosity needs room to roam. Trust needs a map. Every Afterlight story carries one of five labels, chosen by an editor and visible from the first line.</p></div>
      <div className="discover-list">{items.map(({ value, heading, detail, icon: Icon, number }) => <article className="discover-card" key={value}><span className="discover-number">{number}</span><span className="discover-icon"><Icon size={20} strokeWidth={1.5} /></span><div className="discover-detail"><ClassificationTag value={value} /><h2>{heading}</h2><p>{detail}</p></div><p className="discover-description">{classificationDescriptions[value]}</p></article>)}</div>
      <section className="editorial-promise"><div className="eyebrow"><span className="eyebrow-line" />OUR PROMISE</div><h2>Never mistake a question<br />for an <em>answer.</em></h2><p>Labels can change as knowledge grows. We keep the original context, update our sources, and explain what changed.</p><Link to="/about" className="button-text">Read our editorial principles <ArrowRight size={15} /></Link></section>
      <AppFooter />
    </div>
  )
}

interface CommunityHighlight {
  article_id: string
  title: string
  slug: string
  summary: string
  classification: Classification
  published_at: string | null
  reading_minutes: number
  hero_image_url: string | null
  author_name: string
  author_avatar_url: string | null
  category_name: string
  recent_reactions: number
  recent_comments: number
}

interface CommunityComment {
  id: string
  body: string
  created_at: string
  author: { display_name: string; avatar_url: string | null } | null
  article: { title: string; slug: string } | null
}

interface CommunityContributor {
  id: string
  name: string
  avatarUrl: string | null
  articleCount: number
  latestArticle: { title: string; slug: string }
}

function CommunityPage() {
  const { articles, loading: articlesLoading, error: articlesError } = useArticles()
  const [highlights, setHighlights] = useState<CommunityHighlight[]>([])
  const [comments, setComments] = useState<CommunityComment[]>([])
  const [stats, setStats] = useState<{ notes: number | null; conversations: number | null; contributors: number | null }>({ notes: null, conversations: null, contributors: null })
  const [loading, setLoading] = useState(backendConfigured)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    void (async () => {
      const [highlightsResult, commentsResult, statsResult] = await Promise.all([
        supabase.rpc('get_community_highlights'),
        supabase.from('comments')
          .select('id,body,created_at,author:profiles!comments_author_id_fkey(display_name,avatar_url),article:articles!comments_article_id_fkey!inner(title,slug)')
          .eq('status', 'visible')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase.rpc('get_community_stats'),
      ])
      if (!active) return

      const failures = [
        highlightsResult.error && `Trending notes: ${highlightsResult.error.message}`,
        commentsResult.error && `Recent discussions: ${commentsResult.error.message}`,
        statsResult.error && `Community statistics: ${statsResult.error.message}`,
      ].filter(Boolean)

      if (highlightsResult.error) console.error('Unable to load community highlights:', highlightsResult.error.message)
      else setHighlights((highlightsResult.data ?? []) as CommunityHighlight[])
      if (commentsResult.error) console.error('Unable to load community discussions:', commentsResult.error.message)
      else setComments((commentsResult.data ?? []) as unknown as CommunityComment[])
      if (statsResult.error) console.error('Unable to load community statistics:', statsResult.error.message)
      else {
        const row = statsResult.data?.[0]
        setStats({
          notes: Number(row?.published_notes ?? 0),
          conversations: Number(row?.visible_conversations ?? 0),
          contributors: Number(row?.published_contributors ?? 0),
        })
      }
      setError(failures.join(' '))
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  const contributors = useMemo(() => {
    const byAuthor = new Map<string, CommunityContributor>()
    for (const article of articles) {
      if (!article.author_id) continue
      const current = byAuthor.get(article.author_id)
      if (current) current.articleCount += 1
      else byAuthor.set(article.author_id, {
        id: article.author_id,
        name: article.author?.display_name ?? 'Afterlight editor',
        avatarUrl: article.author?.avatar_url ?? null,
        articleCount: 1,
        latestArticle: { title: article.title, slug: article.slug },
      })
    }
    return [...byAuthor.values()].slice(0, 5)
  }, [articles])

  return (
    <div>
      <PageIntro eyebrow="THE OPEN OBSERVATORY" title="A future we make together." description="A thoughtful community for big questions, careful evidence, and ideas that are better when shared." >
        <Link to="/submit" className="button-primary"><Plus size={16} /> Share an idea</Link>
      </PageIntro>
      {!backendConfigured && <ConnectionNotice />}
      <div className="community-callout"><div className="community-callout-icon"><Globe2 size={20} /></div><div><strong>Built for thoughtful exchange.</strong><p>Published contributions, visible discussions, and community responses are shown here. Every note passes editorial review before publication.</p></div><span className="community-status">HUMAN EDITORIAL REVIEW</span></div>
      {articlesError && <div className="inline-error">Unable to load the latest field notes: {articlesError}</div>}
      {error && <div className="inline-error">Some community activity could not be loaded: {error}</div>}
      {backendConfigured && <section className="community-pulse" aria-label="Community activity">
        <div><span>PUBLISHED FIELD NOTES</span><strong>{stats.notes?.toLocaleString() ?? '—'}</strong></div>
        <div><span>VISIBLE CONVERSATIONS</span><strong>{stats.conversations?.toLocaleString() ?? '—'}</strong></div>
        <div><span>PUBLISHED CONTRIBUTORS</span><strong>{stats.contributors?.toLocaleString() ?? '—'}</strong></div>
      </section>}
      <div className="community-layout">
        <section>
          <div className="section-heading section-heading-compact"><div><div className="eyebrow"><span className="eyebrow-line" />MOST ACTIVE · LAST 30 DAYS</div><h2>Ideas in orbit<span className="lime-period">.</span></h2></div></div>
          {loading && <div className="loading-row"><span className="spinner" />Listening to the latest conversations…</div>}
          {!loading && highlights.length > 0 && <div className="community-trending">{highlights.map((item, index) => <Link className="community-trending-item" key={item.article_id} to={`/article/${item.slug}`}>
            <span className="community-trending-rank">{String(index + 1).padStart(2, '0')}</span>
            <div className="community-trending-copy"><div className="article-card-meta"><ClassificationTag value={item.classification} /><span>{item.category_name}</span></div><strong>{item.title}</strong><span>By {item.author_name} · {item.published_at ? new Date(item.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Date unavailable'}</span></div>
            <div className="community-trending-counts"><span><Sparkles size={12} />{item.recent_reactions}</span><span><MessageCircle size={12} />{item.recent_comments}</span></div>
          </Link>)}</div>}
          {!loading && !error && highlights.length === 0 && backendConfigured && <EmptyState title="The next conversation starts here." description="Notes with recent community reactions or discussions will appear in this space." action={<Link to="/explore" className="button-text">Explore published notes <ArrowRight size={14} /></Link>} />}
          {!backendConfigured && <EmptyState title="Connect the research desk to meet the community." description="Live activity and published contributions will appear here when Supabase is configured." />}
        </section>
        <aside className="community-aside">
          <div className="community-activity-block"><div className="eyebrow"><span className="eyebrow-line" />RECENT DISCUSSIONS</div>
            {loading && <div className="community-side-loading"><span className="spinner" />Loading conversations…</div>}
            {!loading && comments.length > 0 && <div className="community-discussions">{comments.map((comment) => <article className="community-discussion" key={comment.id}><div className="community-discussion-author"><UserAvatar url={comment.author?.avatar_url} name={comment.author?.display_name ?? 'Community member'} /><span>{comment.author?.display_name ?? 'Community member'}<small>{new Date(comment.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span></div><p>{comment.body}</p>{comment.article && <Link to={`/article/${comment.article.slug}#conversation`}>{comment.article.title}<ArrowUpRight size={12} /></Link>}</article>)}</div>}
            {!loading && !error && comments.length === 0 && <p className="community-no-discussions">{backendConfigured ? 'No public discussions yet. Each thoughtful question can start one.' : 'Recent member discussions will appear once the research desk is connected.'}</p>}
            {!loading && Boolean(error) && <p className="community-no-discussions">Recent discussions are temporarily unavailable.</p>}
          </div>
          <div className="community-activity-block"><div className="eyebrow"><span className="eyebrow-line" />RECENT CONTRIBUTORS</div>
            {articlesLoading && <div className="community-side-loading"><span className="spinner" />Finding contributors…</div>}
            {!articlesLoading && contributors.length > 0 && <div className="community-contributors">{contributors.map((contributor) => <Link className="community-contributor" key={contributor.id} to={`/contributors/${contributor.id}`}><UserAvatar url={contributor.avatarUrl} name={contributor.name} /><span><strong>{contributor.name}</strong><small>{contributor.articleCount} recent {contributor.articleCount === 1 ? 'note' : 'notes'} · {contributor.latestArticle.title}</small></span><ArrowUpRight size={13} /></Link>)}</div>}
            {!articlesLoading && contributors.length === 0 && <p className="community-no-discussions">Published authors will be introduced here.</p>}
          </div>
          <div className="community-principles"><div className="eyebrow"><span className="eyebrow-line" />COMMUNITY PRINCIPLES</div><div className="principle-card"><span>01</span><div><strong>Stay curious</strong><p>Ask generously. Challenge ideas, not people.</p></div></div><div className="principle-card"><span>02</span><div><strong>Show your sources</strong><p>Make it easy for others to follow the evidence.</p></div></div><div className="principle-card"><span>03</span><div><strong>Leave room for doubt</strong><p>Uncertainty is part of honest exploration.</p></div></div><Link to="/about" className="aside-more">Our community guidelines <ArrowUpRight size={14} /></Link></div>
        </aside>
      </div>
      <section className="community-latest">
        <div className="section-heading section-heading-compact"><div><div className="eyebrow"><span className="eyebrow-line" />FRESHLY PUBLISHED</div><h2>Latest field notes<span className="lime-period">.</span></h2></div><Link to="/explore" className="section-link">Explore all notes <ArrowRight size={14} /></Link></div>
        {articlesLoading ? <div className="loading-row"><span className="spinner" />Gathering the latest notes…</div> : articles.length > 0 ? <div className="article-grid">{articles.slice(0, 3).map((article) => <ArticleCard key={article.id} article={article} />)}</div> : !backendConfigured ? <EmptyState title="The research desk is offline." description="Connect Supabase to load recently published field notes." /> : articlesError ? <EmptyState title="The latest notes could not be loaded." description="Please try again in a moment." /> : <EmptyState title="There are no published community notes yet." description="Share an idea to begin. Editors will review it before it appears here." action={<Link to="/submit" className="button-primary">Submit an idea <ArrowRight size={15} /></Link>} />}
      </section>
      <AppFooter />
    </div>
  )
}

function CategoriesSelect({ value, onChange, categories }: { value: string; onChange: (value: string) => void; categories: Category[] }) {
  return <select required value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose a field</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
}

function SubmitPage() {
  const { session } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [categoryError, setCategoryError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [classification, setClassification] = useState<Classification | ''>('')
  const [categoryId, setCategoryId] = useState('')
  const [evidence, setEvidence] = useState('')
  const [references, setReferences] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!supabase) return
    void supabase.from('categories').select('id,name,slug,description').order('name').then(({ data, error: queryError }) => {
      if (queryError) setCategoryError(queryError.message)
      else setCategories(data ?? [])
    })
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !supabase) return
    setBusy(true)
    setError('')
    const referenceResult = normalizeReferenceUrls(references)
    if (referenceResult.hasInvalidUrl) {
      setError('Please use a valid https:// or http:// URL for each reference.')
      setBusy(false)
      return
    }
    if (referenceResult.hasDuplicates) {
      setReferences(referenceResult.urls.join('\n'))
      setError('Duplicate reference links were removed after URL normalization. Review the links, then submit again.')
      setBusy(false)
      return
    }
    const urls = referenceResult.urls
    let uploadedImage: { path: string } | null = null
    if (imageFile) {
      try {
        uploadedImage = await uploadArticleImage(imageFile, session.user.id)
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'The image could not be uploaded.')
        setBusy(false)
        return
      }
    }
    const { error: insertError } = await supabase.from('submissions').insert({
      author_id: session.user.id,
      title: title.trim(),
      summary: summary.trim(),
      classification,
      category_id: categoryId,
      evidence: evidence.trim() || null,
      reference_urls: urls,
      hero_image_url: uploadedImage?.path ?? null,
      status: 'pending',
    })
    if (insertError) {
      if (uploadedImage) {
        try {
          await removeArticleImage(uploadedImage.path)
          setError(insertError.message)
        } catch (cleanupError) {
          setError(`${insertError.message} The uploaded image also needs cleanup: ${cleanupError instanceof Error ? cleanupError.message : 'image removal failed'}`)
        }
      } else setError(insertError.message)
    }
    else {
      setResult('Your idea is now in the editorial queue. It will not be published until an editor reviews it.')
      setTitle('')
      setSummary('')
      setClassification('')
      setCategoryId('')
      setEvidence('')
      setReferences('')
      setImageFile(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
    setBusy(false)
  }

  if (!session) return <div><PageIntro eyebrow="ADD YOUR PERSPECTIVE" title="Good ideas begin with a question." description="Share a discovery, a well-supported prediction, or a possibility worth exploring." /><div className="login-prompt"><LockKeyhole size={21} /><div><strong>Sign in to submit an idea.</strong><p>Every contribution is attributed to its author and reviewed before publication.</p></div><Link to="/login" className="button-primary">Sign in or join <ArrowRight size={15} /></Link></div><AppFooter /></div>
  if (!backendConfigured) return <div><PageIntro eyebrow="ADD YOUR PERSPECTIVE" title="Good ideas begin with a question." description="Contributions are reviewed by an editor before publication." /><ConnectionNotice /><AppFooter /></div>

  return (
    <div>
      <PageIntro eyebrow="ADD YOUR PERSPECTIVE" title="Bring an idea into the light." description="Be clear about what you know, what you suspect, and what you're imagining. An editor will review your submission before it can be published." />
      <div className="submit-layout">
        <form className="idea-form" onSubmit={(event) => void handleSubmit(event)}>
          {result && <div className="success-message"><Check size={17} />{result}</div>}
          {error && <div className="inline-error">{error}</div>}
          {categoryError && <div className="inline-error">Unable to load categories: {categoryError}</div>}
          <label className="form-field"><span>Give your idea a title <small>REQUIRED</small></span><input required maxLength={140} minLength={8} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A clear, specific headline" /></label>
          <div className="form-row">
            <label className="form-field"><span>Field <small>REQUIRED</small></span><CategoriesSelect value={categoryId} onChange={setCategoryId} categories={categories} /></label>
            <label className="form-field"><span>How should this be read? <small>REQUIRED</small></span><select required value={classification} onChange={(event) => setClassification(event.target.value as Classification)}><option value="">Choose a label</option>{classifications.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          </div>
          {classification && <div className="classification-hint"><ClassificationTag value={classification} />{classificationDescriptions[classification]}</div>}
          <label className="form-field"><span>Tell us what it's about <small>REQUIRED</small></span><textarea required minLength={40} maxLength={3500} rows={6} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is the idea? Why does it matter? Make uncertainty clear." /><small className="field-count">{summary.length}/3500</small></label>
          <label className="form-field"><span>Evidence and context <small>OPTIONAL</small></span><textarea maxLength={5000} rows={4} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Describe the research, context, assumptions, or limitations behind this idea." /></label>
          <label className="form-field"><span>Reference links <small>OPTIONAL · ONE URL PER LINE</small></span><textarea rows={3} value={references} onChange={(event) => setReferences(event.target.value)} placeholder={'https://doi.org/…\nhttps://…'} /></label>
          <label className="form-field"><span>Optional image <small>JPG, PNG, WEBP, AVIF · UP TO 5 MB</small></span><input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /><small className="field-count">{imageFile?.name ?? 'Uploaded to your Afterlight media folder.'}</small></label>
          <div className="form-submit-row"><span><LockKeyhole size={14} />Queued for review; never published automatically</span><button type="submit" className="button-primary" disabled={busy || !categories.length}>{busy ? 'Sending…' : 'Send for review'}{!busy && <Send size={15} />}</button></div>
        </form>
        <aside className="submission-aside"><div className="eyebrow"><span className="eyebrow-line" />BEFORE YOU SEND</div><div className="aside-check"><Check size={15} /><span>Choose the label that matches your evidence.</span></div><div className="aside-check"><Check size={15} /><span>Link directly to sources where you can.</span></div><div className="aside-check"><Check size={15} /><span>Name uncertainties and assumptions.</span></div><div className="submission-note"><ShieldCheck size={18} /><p>Nothing is published automatically. An editor reviews each submission and verifies references before publication.</p></div></aside>
      </div>
      <AppFooter />
    </div>
  )
}

function LoginPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    setNotice('')
    const response = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName.trim() } } })
    if (response.error) setError(response.error.message)
    else if (mode === 'signup' && !response.data.session) setNotice('Check your email to confirm your account, then come back to sign in.')
    else navigate('/')
    setBusy(false)
  }

  if (session) return <div><PageIntro eyebrow="YOUR AFTERLIGHT" title="You're already signed in." description="Head back to the field notes or share something with the community." /><Link to="/explore" className="button-primary">Explore the field <ArrowRight size={15} /></Link><AppFooter /></div>
  return (
    <div>
      <Link to="/" className="back-link"><ArrowLeft size={15} /> Back to Afterlight</Link>
      <div className="auth-layout">
        <div className="auth-copy"><div className="eyebrow"><span className="eyebrow-line" />A PLACE FOR THE CURIOUS</div><h1>There's more than one way to see <em>tomorrow.</em></h1><p>Join a community that keeps evidence, expectation, and imagination in their proper light.</p><div className="auth-stars"><Sparkles size={17} /><span>Explore. Imagine. Create Tomorrow.</span></div></div>
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="auth-form-head"><Mark small /><div><h2>{mode === 'login' ? 'Welcome back.' : 'Find your place here.'}</h2><p>{mode === 'login' ? 'Sign in to continue exploring.' : 'Create an account to contribute.'}</p></div></div>
          {error && <div className="inline-error">{error}</div>}
          {notice && <div className="success-message"><Check size={16} />{notice}</div>}
          {!backendConfigured && <ConnectionNotice />}
          {mode === 'signup' && <label className="form-field"><span>Your name</span><input required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="How should we address you?" /></label>}
          <label className="form-field"><span>Email address</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" /></label>
          <label className="form-field"><span>Password</span><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" /></label>
          <button className="button-primary auth-submit" disabled={busy || !backendConfigured}>{busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={15} /></button>
          <p className="auth-switch">{mode === 'login' ? 'New around here?' : 'Already part of the journey?'} <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice('') }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
          <div className="auth-safety"><LockKeyhole size={13} /> Your account role is assigned securely by the editorial team.</div>
        </form>
      </div>
      <AppFooter />
    </div>
  )
}

function ArticlePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const [article, setArticle] = useState<(Article & {
    body: string
    sources: { id: string; title: string; url: string; publisher: string | null; verification_status: string }[]
  }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [comments, setComments] = useState<ArticleComment[]>([])
  const [reportedCommentIds, setReportedCommentIds] = useState<string[]>([])
  const [reportingCommentId, setReportingCommentId] = useState('')
  const [reportReason, setReportReason] = useState<CommentReportReason>('other')
  const [reportDetails, setReportDetails] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [commentError, setCommentError] = useState('')
  const [revisions, setRevisions] = useState<ArticleRevision[]>([])
  const [revisionError, setRevisionError] = useState('')
  const [saved, setSaved] = useState(false)
  const heroImage = useArticleImageUrl(article?.hero_image_url ?? null)
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({ curious: 0, insightful: 0, inspiring: 0 })
  const [myReactions, setMyReactions] = useState<string[]>([])
  const [reactionBusy, setReactionBusy] = useState('')

  useEffect(() => {
    if (!supabase || !slug) { setLoading(false); return }
    let active = true
    void supabase.from('articles')    .select('id,author_id,title,slug,summary,body,introduction,background,current_understanding,future_possibilities,limitations,classification,published_at,reading_minutes,hero_image_url,author:profiles!articles_author_id_fkey(display_name,avatar_url),category:categories(name,slug),sources(id,title,url,publisher,verification_status)')
      .eq('slug', slug).eq('status', 'published').single()
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else setArticle(data as unknown as Article & { body: string; sources: { id: string; title: string; url: string; publisher: string | null; verification_status: string }[] })
        setLoading(false)
      })
    return () => { active = false }
  }, [slug])

  useEffect(() => {
    if (!supabase || !article) return
    void supabase.from('comments').select('id,author_id,body,created_at,author:profiles!comments_author_id_fkey(display_name,avatar_url)').eq('article_id', article.id).eq('status', 'visible').order('created_at', { ascending: false }).limit(50)
      .then(({ data, error: queryError }) => {
        if (queryError) setCommentError(queryError.message)
        else setComments((data ?? []) as unknown as typeof comments)
      })
    void supabase.rpc('get_article_reaction_counts', { p_article_id: article.id })
      .then(({ data, error: queryError }) => {
        if (queryError) setCommentError(queryError.message)
        else {
          const counts = { curious: 0, insightful: 0, inspiring: 0 }
          for (const item of data ?? []) {
            if (item.reaction in counts) counts[item.reaction as keyof typeof counts] = Number(item.count)
          }
          setReactionCounts(counts)
        }
      })
    if (session) void supabase.from('reactions').select('reaction').eq('article_id', article.id).eq('user_id', session.user.id)
      .then(({ data, error: queryError }) => {
        if (queryError) setCommentError(queryError.message)
        else setMyReactions((data ?? []).map((item) => item.reaction))
      })
    else setMyReactions([])
    if (session) void supabase.from('bookmarks').select('article_id').eq('article_id', article.id).eq('user_id', session.user.id).maybeSingle()
      .then(({ data, error: queryError }) => {
        if (queryError) setCommentError(queryError.message)
        else setSaved(Boolean(data))
      })
  }, [article, session])

  useEffect(() => {
    setReportedCommentIds([])
    if (!supabase || !session || !article) return
    let active = true
    void supabase.from('comment_reports').select('comment_id')
      .eq('reporter_id', session.user.id)
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setCommentError(queryError.message)
        else setReportedCommentIds((data ?? []).map((item) => item.comment_id))
      })
    return () => { active = false }
  }, [article, session])

  useEffect(() => {
    if (!supabase || !article) return
    let active = true
    void supabase.from('article_revisions')
      .select('id,revision_number,change_note,title,summary,body,introduction,background,current_understanding,future_possibilities,limitations,classification,category_name,created_at')
      .eq('article_id', article.id)
      .order('revision_number', { ascending: false })
      .limit(20)
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setRevisionError(queryError.message)
        else setRevisions((data ?? []) as ArticleRevision[])
      })
    return () => { active = false }
  }, [article])

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !supabase || !article) return
    setCommentError('')
    const { data, error: insertError } = await supabase.from('comments').insert({ article_id: article.id, author_id: session.user.id, body: comment.trim() }).select('id,author_id,body,created_at,author:profiles!comments_author_id_fkey(display_name,avatar_url)').single()
    if (insertError) setCommentError(insertError.message)
    else {
      setComments((current) => [data as unknown as typeof comments[number], ...current])
      setComment('')
    }
  }

  async function submitCommentReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !supabase || !reportingCommentId) return
    setReportBusy(true)
    setCommentError('')
    const { error: reportError } = await supabase.from('comment_reports').insert({
      comment_id: reportingCommentId,
      reporter_id: session.user.id,
      reason: reportReason,
      details: reportDetails.trim() || null,
    })
    if (reportError) setCommentError(reportError.message)
    else {
      setReportedCommentIds((current) => [...current, reportingCommentId])
      setReportingCommentId('')
      setReportReason('other')
      setReportDetails('')
    }
    setReportBusy(false)
  }

  async function toggleBookmark() {
    if (!session || !supabase || !article) return
    const previous = saved
    setSaved(!previous)
    const result = previous
      ? await supabase.from('bookmarks').delete().eq('user_id', session.user.id).eq('article_id', article.id)
      : await supabase.from('bookmarks').insert({ user_id: session.user.id, article_id: article.id })
    if (result.error) {
      setSaved(previous)
      setCommentError(result.error.message)
    }
  }

  async function toggleReaction(reaction: 'curious' | 'insightful' | 'inspiring') {
    if (!session || !supabase || !article) {
      navigate('/login')
      return
    }
    const removing = myReactions.includes(reaction)
    setReactionBusy(reaction)
    setMyReactions((current) => removing ? current.filter((item) => item !== reaction) : [...current, reaction])
    setReactionCounts((current) => ({ ...current, [reaction]: current[reaction] + (removing ? -1 : 1) }))
    const result = removing
      ? await supabase.from('reactions').delete().eq('article_id', article.id).eq('user_id', session.user.id).eq('reaction', reaction)
      : await supabase.from('reactions').insert({ article_id: article.id, user_id: session.user.id, reaction })
    if (result.error) {
      setMyReactions((current) => removing ? [...current, reaction] : current.filter((item) => item !== reaction))
      setReactionCounts((current) => ({ ...current, [reaction]: current[reaction] + (removing ? 1 : -1) }))
      setCommentError(result.error.message)
    }
    setReactionBusy('')
  }

  if (!backendConfigured) return <div><Link to="/explore" className="back-link"><ArrowLeft size={15} /> Back to explore</Link><ConnectionNotice /><EmptyState title="Connect the research desk to read this note." description="Article pages show published, editorially reviewed content from your Supabase database." /><AppFooter /></div>
  if (loading) return <div className="loading-row"><span className="spinner" />Opening the field note…</div>
  if (!article) return <div><Link to="/explore" className="back-link"><ArrowLeft size={15} /> Back to explore</Link>{error && <div className="inline-error">{error}</div>}<EmptyState title="This note isn't available." description="It may have moved, or it may not have been published yet." action={<Link to="/explore" className="button-text">Back to the atlas <ArrowRight size={14} /></Link>} /><AppFooter /></div>

  return <article className="article-detail">
    <Link to="/explore" className="back-link"><ArrowLeft size={15} /> Back to explore</Link>
    <div className="article-detail-head"><div className="article-card-meta"><ClassificationTag value={article.classification} /><span>{article.category?.name}</span></div><h1>{article.title}</h1><p className="article-summary">{article.summary}</p>
      <div className="detail-byline"><UserAvatar url={article.author?.avatar_url} name={article.author?.display_name ?? 'Afterlight editor'} /><span>By <strong>{article.author_id ? <Link to={`/contributors/${article.author_id}`} className="author-profile-link">{article.author?.display_name ?? 'Afterlight editor'}</Link> : article.author?.display_name ?? 'Afterlight editor'}</strong></span><span className="byline-separator">·</span><span>{article.published_at ? new Date(article.published_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'Publication date unavailable'}</span><span className="byline-separator">·</span><span>{article.reading_minutes} min read</span><button className={`bookmark-button${saved ? ' bookmark-saved' : ''}`} onClick={() => session ? void toggleBookmark() : navigate('/login')} aria-label={saved ? 'Remove bookmark' : 'Bookmark article'}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}</button></div>
    </div>
    {heroImage.url && <div className="detail-cover"><img className="detail-cover-image" src={heroImage.url} alt="" onLoad={() => heroImage.handleImageLoad(heroImage.url!)} onError={() => heroImage.handleImageError(heroImage.url!)} /></div>}
    <div className="detail-layout"><div className="article-body">
      <div className="detail-label-note"><ClassificationTag value={article.classification} /><span>{classificationDescriptions[article.classification]}</span></div>
      {([
        ['Introduction', article.introduction],
        ['Background', article.background],
        ['Current scientific understanding', article.current_understanding],
        ['Future possibilities', article.future_possibilities],
        ['Limitations & uncertainties', article.limitations],
      ] as const).some(([, section]) => Boolean(section))
        ? <>
          {([
          ['Introduction', article.introduction],
          ['Background', article.background],
          ['Current scientific understanding', article.current_understanding],
          ['Future possibilities', article.future_possibilities],
          ['Limitations & uncertainties', article.limitations],
          ] as const).map(([heading, section]) => section && <section className="article-content-section" key={heading}><h2>{heading}</h2>{section.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>)}
          {article.body.trim() && <section className="article-content-section"><h2>Additional context</h2>{article.body.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>}
        </>
        : article.body.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      {article.sources?.length > 0 && <section className="references"><div className="eyebrow"><span className="eyebrow-line" />REFERENCES & SOURCES</div>{article.sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>{source.title}{source.publisher && <small>{source.publisher}</small>}</span><ExternalLink size={14} /></a>)}</section>}
    </div><aside className="article-aside"><div className="eyebrow"><span className="eyebrow-line" />IN THIS NOTE</div><div className="detail-aside-note"><ShieldCheck size={16} /><p>Classification is selected during editorial review and may be updated as evidence changes.</p></div><div className="detail-aside-note"><MessageCircle size={16} /><p>Comments are visible to signed-in community members and may be moderated.</p></div></aside></div>
    {(revisions.length > 0 || revisionError) && <section className="revision-history"><div className="section-heading section-heading-compact"><div><div className="eyebrow"><span className="eyebrow-line" />EDITORIAL TRANSPARENCY</div><h2>What changed<span className="lime-period">.</span></h2></div></div><p className="revision-history-intro">Published notes can evolve as evidence and understanding develop. The most recent 20 earlier versions and the editor's reason for each update stay visible.</p>{revisionError && <div className="inline-error">Unable to load article history: {revisionError}</div>}{revisions.map((revision) => <details className="revision-entry" key={revision.id}><summary><span>EARLIER VERSION {revision.revision_number}</span><span>SUPERSEDED {new Date(revision.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span><ChevronDown size={15} /></summary><div className="revision-entry-content"><div className="revision-note"><strong>Why it changed</strong><p>{revision.change_note}</p></div><div className="revision-snapshot-meta"><ClassificationTag value={revision.classification} /><span>{revision.category_name}</span></div><h3>{revision.title}</h3><p className="revision-snapshot-summary">{revision.summary}</p>{([
          ['Introduction', revision.introduction],
          ['Background', revision.background],
          ['Current scientific understanding', revision.current_understanding],
          ['Future possibilities', revision.future_possibilities],
          ['Limitations & uncertainties', revision.limitations],
          ['Additional context', revision.body],
        ] as const).map(([heading, content]) => content && <section className="revision-snapshot-section" key={heading}><h4>{heading}</h4>{content.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>)}</div></details>)}</section>}
    <section className="reaction-section"><div className="eyebrow"><span className="eyebrow-line" />WHAT DID THIS SPARK?</div><div className="reaction-buttons">{([{ id: 'curious', label: 'Curious', icon: Telescope }, { id: 'insightful', label: 'Insightful', icon: Sparkles }, { id: 'inspiring', label: 'Inspiring', icon: Orbit }] as const).map(({ id, label, icon: Icon }) => <button key={id} disabled={reactionBusy === id} className={`reaction-button${myReactions.includes(id) ? ' reaction-selected' : ''}`} onClick={() => void toggleReaction(id)}><Icon size={15} />{label}<span>{reactionCounts[id]}</span></button>)}</div></section>
    <section className="comments-section" id="conversation"><div className="section-heading section-heading-compact"><div><div className="eyebrow"><span className="eyebrow-line" />THE CONVERSATION</div><h2>Questions & perspectives<span className="lime-period">.</span></h2></div></div>
      {commentError && <div className="inline-error">{commentError}</div>}
      {session ? <form className="comment-form" onSubmit={(event) => void addComment(event)}><textarea required minLength={3} maxLength={2000} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a thoughtful question or perspective…" /><button className="button-primary"><Send size={15} /> Post comment</button></form> : <div className="comment-signin">Sign in to join the conversation. <Link to="/login">Sign in <ArrowRight size={13} /></Link></div>}
      {comments.length ? <div className="comment-list">{comments.map((item) => <div className="comment-item" key={item.id}><UserAvatar url={item.author?.avatar_url} name={item.author?.display_name ?? 'Community member'} /><div className="comment-content"><div className="comment-heading"><div className="comment-author">{item.author?.display_name ?? 'Community member'} <span>{new Date(item.created_at).toLocaleDateString()}</span></div>{session && item.author_id !== session.user.id && (reportedCommentIds.includes(item.id) ? <span className="comment-reported"><Check size={12} /> Report received</span> : <button className="comment-report-button" onClick={() => { setReportingCommentId(item.id); setReportReason('other'); setReportDetails('') }}><Flag size={12} /> Report</button>)}</div><p>{item.body}</p>{reportingCommentId === item.id && <form className="comment-report-form" onSubmit={(event) => void submitCommentReport(event)}><label className="form-field"><span>Why are you reporting this comment?</span><select value={reportReason} onChange={(event) => setReportReason(event.target.value as CommentReportReason)}><option value="spam">Spam or misleading promotion</option><option value="harassment">Harassment or abuse</option><option value="misinformation">Potentially harmful misinformation</option><option value="personal_information">Personal or private information</option><option value="off_topic">Unrelated or disruptive</option><option value="other">Other concern</option></select></label><label className="form-field"><span>Additional context <small>OPTIONAL · 1000 CHARACTERS</small></span><textarea maxLength={1000} rows={2} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Share context that can help an editor review this report." /></label><div className="comment-report-actions"><span>Reports are private and reviewed by the editorial team.</span><button type="button" className="button-text" onClick={() => setReportingCommentId('')}>Cancel</button><button className="button-primary" disabled={reportBusy}>{reportBusy ? 'Sending…' : 'Send report'}<Flag size={13} /></button></div></form>}</div></div>)}</div> : <p className="comments-empty">No comments yet. Start with a question.</p>}
    </section>
    <AppFooter />
  </article>
}

type CommentReportReason = 'spam' | 'harassment' | 'misinformation' | 'personal_information' | 'off_topic' | 'other'

interface ArticleComment {
  id: string
  author_id: string
  body: string
  created_at: string
  author: { display_name: string; avatar_url: string | null } | null
}

interface ArticleRevision {
  id: string
  revision_number: number
  change_note: string
  title: string
  summary: string
  body: string
  introduction: string | null
  background: string | null
  current_understanding: string | null
  future_possibilities: string | null
  limitations: string | null
  classification: Classification
  category_name: string
  created_at: string
}

interface MemberSubmission {
  id: string
  title: string
  summary: string
  classification: Classification
  created_at: string
  reference_urls: string[]
  evidence: string | null
  status: string
  category_id: string
  hero_image_url: string | null
  editorial_reviews: { id: string; decision: string; notes: string | null; created_at: string }[]
}

function SubmissionRevisionForm({ submission, categories, onResubmitted }: {
  submission: MemberSubmission
  categories: Category[]
  onResubmitted: (revision: Pick<MemberSubmission, 'id' | 'title' | 'summary' | 'category_id' | 'classification' | 'evidence' | 'reference_urls'>) => void
}) {
  const [title, setTitle] = useState(submission.title)
  const [summary, setSummary] = useState(submission.summary)
  const [categoryId, setCategoryId] = useState(submission.category_id)
  const [classification, setClassification] = useState<Classification>(submission.classification)
  const [evidence, setEvidence] = useState(submission.evidence ?? '')
  const [referenceText, setReferenceText] = useState(submission.reference_urls.join('\n'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function resubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const referenceResult = normalizeReferenceUrls(referenceText)
    if (referenceResult.hasInvalidUrl) {
      setError('Use a valid http:// or https:// URL for each reference.')
      return
    }
    if (referenceResult.hasDuplicates) {
      setReferenceText(referenceResult.urls.join('\n'))
      setError('Duplicate reference links were removed after URL normalization. Review the links, then resubmit.')
      return
    }
    const urls = referenceResult.urls

    setBusy(true)
    setError('')
    const { error: updateError } = await supabase.rpc('update_submission_review', {
      submission_id: submission.id,
      new_title: title.trim(),
      new_summary: summary.trim(),
      new_category_id: categoryId,
      new_classification: classification,
      new_evidence: evidence.trim() || null,
      new_reference_urls: urls,
      new_hero_image_url: submission.hero_image_url,
    })
    if (updateError) setError(updateError.message)
    else onResubmitted({
      id: submission.id,
      title: title.trim(),
      summary: summary.trim(),
      category_id: categoryId,
      classification,
      evidence: evidence.trim() || null,
      reference_urls: urls,
    })
    setBusy(false)
  }

  return <form className="revision-form" onSubmit={(event) => void resubmit(event)}>
    <label className="form-field"><span>Title</span><input required minLength={8} maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="form-field"><span>Description</span><textarea required minLength={40} maxLength={3500} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
    <div className="form-row"><label className="form-field"><span>Field</span><select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label className="form-field"><span>Classification</span><select required value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>{classifications.map((item) => <option value={item} key={item}>{item}</option>)}</select></label></div>
    <label className="form-field"><span>Evidence & context</span><textarea maxLength={5000} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
    <label className="form-field"><span>References <small>ONE URL PER LINE</small></span><textarea rows={3} value={referenceText} onChange={(event) => setReferenceText(event.target.value)} placeholder="https://…" /></label>
    {error && <div className="inline-error">{error}</div>}
    <div className="revision-actions"><span>Resubmitting sends this version back to the editorial queue.</span><button className="button-primary" disabled={busy || categories.length === 0}>{busy ? 'Sending…' : 'Resubmit for review'}<Send size={14} /></button></div>
  </form>
}

interface PublicContributor {
  id: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  created_at: string
}

function ContributorProfilePage() {
  const { profileId } = useParams()
  const [contributor, setContributor] = useState<PublicContributor | null>(null)
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(backendConfigured)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase || !profileId) return
    let active = true
    setLoading(true)
    setError('')
    void Promise.all([
      supabase.from('profiles').select('id,display_name,avatar_url,bio,created_at').eq('id', profileId).maybeSingle(),
      supabase.from('articles')
        .select('id,author_id,title,slug,summary,classification,published_at,reading_minutes,hero_image_url,author:profiles!articles_author_id_fkey(display_name,avatar_url),category:categories(name,slug)')
        .eq('author_id', profileId)
        .eq('status', 'published')
        .order('published_at', { ascending: false }),
    ]).then(([profileResult, articleResult]) => {
      if (!active) return
      const failures = [
        profileResult.error && `Contributor profile: ${profileResult.error.message}`,
        articleResult.error && `Published field notes: ${articleResult.error.message}`,
      ].filter(Boolean)
      if (profileResult.error) console.error('Unable to load public contributor profile:', profileResult.error.message)
      else setContributor(profileResult.data as PublicContributor | null)
      if (articleResult.error) console.error('Unable to load contributor field notes:', articleResult.error.message)
      else setArticles((articleResult.data ?? []) as unknown as Article[])
      setError(failures.join(' '))
      setLoading(false)
    })
    return () => { active = false }
  }, [profileId])

  if (!backendConfigured) return <div><Link to="/community" className="back-link"><ArrowLeft size={15} /> Back to community</Link><ConnectionNotice /><EmptyState title="Connect the research desk to meet this contributor." description="Public contributor profiles and their published notes are loaded from Supabase." /><AppFooter /></div>
  if (loading) return <div className="loading-row"><span className="spinner" />Opening the contributor profile…</div>
  if (error && !contributor) return <div><Link to="/community" className="back-link"><ArrowLeft size={15} /> Back to community</Link><div className="inline-error">{error}</div><EmptyState title="This contributor profile could not be loaded." description="Please try again in a moment." /><AppFooter /></div>
  if (!contributor) return <div><Link to="/community" className="back-link"><ArrowLeft size={15} /> Back to community</Link><EmptyState title="This contributor isn't available." description="The profile may have moved, or it may not exist." /><AppFooter /></div>

  return <div className="contributor-page">
    <Link to="/community" className="back-link"><ArrowLeft size={15} /> Back to community</Link>
    {error && <div className="inline-error">{error}</div>}
    <header className="contributor-hero">
      <UserAvatar url={contributor.avatar_url} name={contributor.display_name} className="avatar contributor-avatar-image" fallbackClassName="avatar contributor-avatar" />
      <div className="contributor-identity"><div className="eyebrow"><span className="eyebrow-line" />AFTERLIGHT CONTRIBUTOR</div><h1>{contributor.display_name}</h1><p>{contributor.bio || 'This contributor hasn’t added a public bio yet.'}</p><span className="contributor-since">CONTRIBUTING SINCE {new Date(contributor.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span></div>
      <div className="contributor-note-count"><strong>{articles.length}</strong><span>PUBLISHED<br />{articles.length === 1 ? 'FIELD NOTE' : 'FIELD NOTES'}</span></div>
    </header>
    <section className="contributor-work">
      <div className="section-heading section-heading-compact"><div><div className="eyebrow"><span className="eyebrow-line" />EDITORIALLY REVIEWED</div><h2>Field notes by {contributor.display_name}<span className="lime-period">.</span></h2></div></div>
      {articles.length > 0 ? <div className="article-grid">{articles.map((article) => <ArticleCard article={article} key={article.id} />)}</div> : error ? <EmptyState title="Published notes could not be loaded." description="Please try again in a moment." /> : <EmptyState title="No published notes yet." description="When this contributor's work passes editorial review, it will appear here." />}
    </section>
    <AppFooter />
  </div>
}

function ProfilePage() {
  const { session, profile, refreshProfile } = useAuth()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [bookmarks, setBookmarks] = useState<Article[]>([])
  const [submissions, setSubmissions] = useState<MemberSubmission[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(Boolean(session && backendConfigured))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '')
    setBio(profile?.bio ?? '')
  }, [profile])

  useEffect(() => {
    if (!session || !supabase) {
      setLoading(false)
      return
    }
    setLoading(true)
    let active = true
    void Promise.all([
      supabase.from('bookmarks').select('created_at,article:articles!bookmarks_article_id_fkey(id,title,slug,summary,classification,published_at,reading_minutes,hero_image_url,author:profiles!articles_author_id_fkey(display_name,avatar_url),category:categories(name,slug))').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('submissions').select('id,title,summary,status,category_id,classification,evidence,reference_urls,hero_image_url,created_at,author:profiles!submissions_author_id_fkey(display_name),category:categories(name),editorial_reviews(id,decision,notes,created_at)').eq('author_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('categories').select('id,name,slug,description').eq('is_active', true).order('name'),
    ]).then(([bookmarkResult, submissionResult, categoryResult]) => {
      if (!active) return
      if (bookmarkResult.error) setError(bookmarkResult.error.message)
      else setBookmarks((bookmarkResult.data ?? []).map((item) => item.article as unknown as Article))
      if (submissionResult.error) setError(submissionResult.error.message)
      else setSubmissions((submissionResult.data ?? []) as unknown as MemberSubmission[])
      if (categoryResult.error) setError((current) => current ? `${current}; ${categoryResult.error.message}` : categoryResult.error.message)
      else setCategories(categoryResult.data ?? [])
      setLoading(false)
    })
    return () => { active = false }
  }, [session])

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !supabase) return
    setBusy(true)
    setError('')
    setSaved(false)
    const { error: updateError } = await supabase.from('profiles').update({
      display_name: displayName.trim(),
      bio: bio.trim() || null,
    }).eq('id', session.user.id)
    if (updateError) setError(updateError.message)
    else {
      try {
        await refreshProfile()
        setSaved(true)
      } catch (profileError) {
        setError(profileError instanceof Error ? `Profile saved, but could not reload it: ${profileError.message}` : 'Profile saved, but could not reload it.')
      }
    }
    setBusy(false)
  }

  if (!session) return <div><PageIntro eyebrow="YOUR AFTERLIGHT" title="Make this space yours." description="Sign in to update your profile, revisit saved field notes, and follow your submissions." /><div className="login-prompt"><UserRound size={20} /><div><strong>Your profile is waiting.</strong><p>Sign in or create a member account to manage your details and saved notes.</p></div><Link to="/login" className="button-primary">Sign in or join <ArrowRight size={15} /></Link></div><AppFooter /></div>

  return <div><PageIntro eyebrow="YOUR AFTERLIGHT" title="Your place in the field." description="Manage your profile, return to saved notes, and follow your ideas through editorial review." >
      <Link to={`/contributors/${session.user.id}`} className="button-text">View public profile <ArrowUpRight size={14} /></Link>
    </PageIntro>
    {error && <div className="inline-error">{error}</div>}
    {saved && <div className="success-message"><Check size={16} />Profile updated.</div>}
    <div className="profile-layout"><form className="profile-form" onSubmit={(event) => void saveProfile(event)}><div className="profile-form-heading"><UserAvatar url={profile?.avatar_url} name={displayName || 'Afterlight'} className="avatar profile-avatar-image" fallbackClassName="avatar profile-avatar" /><div><div className="eyebrow">{profile?.role ?? 'MEMBER'}</div><strong>{session.user.email}</strong></div></div><ProfilePhotoEditor profileId={session.user.id} displayName={displayName} photoUrl={profile?.avatar_url ?? null} refreshProfile={refreshProfile} /><label className="form-field"><span>Display name</span><input required minLength={1} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label className="form-field"><span>Short public bio <small>OPTIONAL · 280 CHARACTERS</small></span><textarea maxLength={280} rows={3} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="What are you curious about?" /></label><div className="profile-bio-count">{bio.length}/280 · Shown on your public contributor profile</div><div className="profile-role-note"><LockKeyhole size={14} />Account roles are assigned by an administrator. You cannot promote your own account.</div><button className="button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}<Check size={15} /></button></form>
      <section className="profile-submissions"><div className="eyebrow"><span className="eyebrow-line" />YOUR SUBMISSIONS</div>{loading ? <div className="loading-row"><span className="spinner" />Loading your notes…</div> : submissions.length ? submissions.map((submission) => {
        const latestReview = [...submission.editorial_reviews].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
        const statusTone = submission.status === 'published' ? 'verified' : submission.status === 'pending' ? 'pending' : submission.status === 'approved' ? 'verified' : 'hidden'
        return <article className="profile-submission-card" key={submission.id}><div className="profile-submission"><div><strong>{submission.title}</strong><span>Submitted {new Date(submission.created_at).toLocaleDateString()}</span></div><span className={`reference-status reference-${statusTone}`}>{submission.status.replace('_', ' ')}</span></div>{latestReview?.notes && <div className="member-review-note"><strong>Editorial feedback</strong><p>{latestReview.notes}</p></div>}{submission.status === 'changes_requested' && <SubmissionRevisionForm submission={submission} categories={categories} onResubmitted={(revision) => { setSubmissions((current) => current.map((item) => item.id === revision.id ? { ...item, ...revision, status: 'pending' } : item)); setError(''); setSaved(false) }} />}</article>
      }) : <p className="profile-empty">Your submissions and their review status will appear here.</p>}</section>
    </div>
    <section className="profile-bookmarks"><div className="section-heading section-heading-compact"><div><div className="eyebrow"><span className="eyebrow-line" />YOUR READING LIST</div><h2>Saved for later<span className="lime-period">.</span></h2></div></div>{loading ? <div className="loading-row"><span className="spinner" />Loading saved notes…</div> : bookmarks.length ? <div className="article-grid">{bookmarks.map((article) => <ArticleCard article={article} key={article.id} />)}</div> : <EmptyState title="Keep a note for later." description="Bookmark a published field note and it will be waiting for you here." action={<Link to="/explore" className="button-text">Explore the field <ArrowRight size={14} /></Link>} />}</section>
    <AppFooter />
  </div>
}

function AboutPage() {
  return <div><PageIntro eyebrow="WHY AFTERLIGHT EXISTS" title="The future belongs to no single voice." description="Afterlight is a shared observatory for what we know, what we're learning, and what we still have the courage to imagine." />
    <section className="about-hero"><div className="about-mark"><Mark /></div><div className="eyebrow">EXPLORE. IMAGINE. CREATE TOMORROW.</div><h2>More curious.<br /><em>Less certain.</em></h2><p>Tomorrow is shaped by the questions we ask today. We built Afterlight to make those questions easier to explore — across disciplines, in public, and with honesty about what we don't yet know.</p></section>
    <section className="about-pillars">{[{ number: '01', title: 'Evidence deserves daylight.', text: 'Facts should be checkable. Sources should be visible. Research should keep its context.' }, { number: '02', title: 'Uncertainty is not a flaw.', text: 'A prediction is not a promise. Possibility is not probability. We make the difference visible.' }, { number: '03', title: 'Imagination is a tool.', text: 'Speculation can open doors, as long as we call it what it is and leave room for reality.' }].map((item) => <article key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</section>
    <div className="about-footer-cta"><p>A future-facing platform, built one careful question at a time.</p><Link to="/submit" className="button-primary">Add your voice <ArrowRight size={15} /></Link></div><AppFooter />
  </div>
}

export function AppFooter() {
  return <footer className="site-footer"><Link to="/" className="footer-brand"><Mark small /> AFTERLIGHT</Link><span>Explore. Imagine. Create Tomorrow.</span><div><Link to="/about">About</Link><Link to="/discover">Editorial labels</Link><Link to="/submit">Contribute</Link></div><span className="footer-copyright">© {new Date().getFullYear()} AFTERLIGHT</span></footer>
}

function NotFound() {
  return <div><PageIntro eyebrow="OFF THE MAP" title="This path hasn't been charted." description="The page you're looking for may have moved, or it may not exist yet." /><Link to="/" className="button-primary"><ArrowLeft size={15} /> Return to the beginning</Link><AppFooter /></div>
}

export default function App() {
  return <AuthProvider><AppShell><Suspense fallback={<div className="loading-row" role="status"><span className="spinner" />Loading pageâ€¦</div>}><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/explore" element={<ExplorePage />} />
    <Route path="/discover" element={<DiscoverPage />} />
    <Route path="/assistant" element={<ResearchAssistantPage />} />
    <Route path="/community" element={<CommunityPage />} />
    <Route path="/submit" element={<SubmitPage />} />
    <Route path="/article/:slug" element={<ArticlePage />} />
    <Route path="/contributors/:profileId" element={<ContributorProfilePage />} />
    <Route path="/about" element={<AboutPage />} />
    <Route path="/admin" element={<AdminPage />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes></Suspense></AppShell></AuthProvider>
}
