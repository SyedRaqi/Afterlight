import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, BarChart3, Check, ExternalLink, Feather, FileText, Flag, MessageSquare, Plus, ShieldCheck, Tags, Users } from 'lucide-react'
import { AppFooter, ClassificationTag, ConnectionNotice, EmptyState, PageIntro, SubmissionReviewImage, UserAvatar, classifications } from '../App'
import { useAuth } from '../lib/auth'
import { backendConfigured, supabase } from '../lib/supabase'
import type { Article, Category, Classification, Role } from '../lib/types'
type AdminTab = 'review' | 'references' | 'articles' | 'comments' | 'reports' | 'people' | 'categories' | 'statistics'
type CommentReportReason = 'spam' | 'harassment' | 'misinformation' | 'personal_information' | 'off_topic' | 'other'
interface ReviewSubmission {
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
  author: { display_name: string; avatar_url: string | null } | null
  category: { name: string } | null
}
interface ReferenceReview {
  id: string
  url: string
  verification_status: 'pending' | 'verified' | 'needs_attention'
  kind: 'submission' | 'article'
  submission: { title: string; status: string } | null
  article: { title: string; slug: string } | null
}
interface EditorialArticle extends Article {
  body: string
  status: string
  category_id: string
}
interface EditorialComment {
  id: string
  body: string
  created_at: string
  status: 'visible' | 'hidden' | 'removed'
  author: { display_name: string; avatar_url: string | null } | null
  article: { title: string; slug: string } | null
}
interface CommentReport {
  id: string
  comment_id: string
  reason: CommentReportReason
  details: string | null
  created_at: string
  reporter: { display_name: string } | null
  comment: {
    body: string
    status: 'visible' | 'hidden' | 'removed'
    author: { display_name: string; avatar_url: string | null } | null
    article: { title: string; slug: string } | null
  } | null
}
interface AdminProfile {
  id: string
  display_name: string
  avatar_url: string | null
  role: Role
  created_at: string
}
interface AdminCategory extends Category {
  is_active: boolean
}

function ArticleEditor({ article, categories, onSaved }: { article: EditorialArticle; categories: AdminCategory[]; onSaved: () => void }) {
  const [title, setTitle] = useState(article.title)
  const [summary, setSummary] = useState(article.summary)
  const [body, setBody] = useState(article.body)
  const [introduction, setIntroduction] = useState(article.introduction ?? '')
  const [background, setBackground] = useState(article.background ?? '')
  const [currentUnderstanding, setCurrentUnderstanding] = useState(article.current_understanding ?? '')
  const [futurePossibilities, setFuturePossibilities] = useState(article.future_possibilities ?? '')
  const [limitations, setLimitations] = useState(article.limitations ?? '')
  const [classification, setClassification] = useState<Classification>(article.classification)
  const [categoryId, setCategoryId] = useState(article.category_id)
  const [changeNote, setChangeNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const publishedContentChanged = article.status === 'published' && (
    title.trim() !== article.title ||
    summary.trim() !== article.summary ||
    body.trim() !== article.body ||
    (introduction.trim() || null) !== article.introduction ||
    (background.trim() || null) !== article.background ||
    (currentUnderstanding.trim() || null) !== article.current_understanding ||
    (futurePossibilities.trim() || null) !== article.future_possibilities ||
    (limitations.trim() || null) !== article.limitations ||
    classification !== article.classification ||
    categoryId !== article.category_id
  )

  async function saveArticleChanges() {
    if (!supabase) return false
    setError('')
    setSaved(false)
    if (publishedContentChanged && changeNote.trim().length < 20) {
      setError('Add a change note of at least 20 characters to explain this published update.')
      return false
    }
    const { error: updateError } = await supabase.from('articles').update({
      title: title.trim(),
      summary: summary.trim(),
      body: body.trim(),
      introduction: introduction.trim() || null,
      background: background.trim() || null,
      current_understanding: currentUnderstanding.trim() || null,
      future_possibilities: futurePossibilities.trim() || null,
      limitations: limitations.trim() || null,
      classification,
      category_id: categoryId,
      change_note: publishedContentChanged ? changeNote.trim() : null,
    }).eq('id', article.id)
    if (updateError) {
      setError(updateError.message)
      return false
    }
    setSaved(true)
    if (publishedContentChanged) {
      setChangeNote('')
      onSaved()
    }
    return true
  }

  async function saveArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    await saveArticleChanges()
    setBusy(false)
  }

  async function publishArticle() {
    if (!supabase) return
    setBusy(true)
    setError('')
    if (await saveArticleChanges()) {
      const { error: publishError } = await supabase.rpc('publish_article', { article_id: article.id })
      if (publishError) setError(publishError.message)
      else onSaved()
    }
    setBusy(false)
  }

  return <form className="article-edit-form" onSubmit={(event) => void saveArticle(event)}>
    <div className="article-edit-top"><div><div className="eyebrow">{article.status.toUpperCase()} FIELD NOTE</div><Link to={article.status === 'published' ? `/article/${article.slug}` : '#'} target={article.status === 'published' ? '_blank' : undefined} onClick={(event) => { if (article.status !== 'published') event.preventDefault() }} className="article-edit-link">{article.status === 'published' ? 'Preview published note' : 'Draft · visible to editors only'}{article.status === 'published' && <ExternalLink size={13} />}</Link></div><span className="article-edit-author">{article.author?.display_name ?? 'Afterlight editor'}</span></div>
    <label className="form-field"><span>Title</span><input required minLength={8} maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="form-field"><span>Summary</span><textarea required value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} /></label>
    <div className="article-sections-editor"><div className="eyebrow"><span className="eyebrow-line" />ARTICLE SECTIONS</div><p>Keep established understanding, future scenarios, and uncertainty in clearly named sections.</p>
      <label className="form-field"><span>Introduction</span><textarea value={introduction} onChange={(event) => setIntroduction(event.target.value)} rows={3} placeholder="Orient readers to the question, context, and classification." /></label>
      <label className="form-field"><span>Background</span><textarea value={background} onChange={(event) => setBackground(event.target.value)} rows={3} placeholder="Relevant context and how we arrived here." /></label>
      <label className="form-field"><span>Current scientific understanding</span><textarea value={currentUnderstanding} onChange={(event) => setCurrentUnderstanding(event.target.value)} rows={4} placeholder="What current evidence supports, and what remains under investigation." /></label>
      <label className="form-field"><span>Future possibilities</span><textarea value={futurePossibilities} onChange={(event) => setFuturePossibilities(event.target.value)} rows={4} placeholder="Clearly distinguish predictions, scenarios, and imaginative ideas." /></label>
      <label className="form-field"><span>Limitations & uncertainties</span><textarea value={limitations} onChange={(event) => setLimitations(event.target.value)} rows={3} placeholder="Assumptions, open questions, and limits of available evidence." /></label>
    </div>
    <label className="form-field"><span>Additional context <small>OPTIONAL</small></span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} /></label>
    <div className="form-row"><label className="form-field"><span>Classification</span><select value={classification} onChange={(event) => setClassification(event.target.value as Classification)}>{classifications.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="form-field"><span>Category</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label></div>
    {article.status === 'published' && <label className="form-field revision-note-field"><span>Why is this note changing? <small>{publishedContentChanged ? 'REQUIRED' : 'REQUIRED WHEN CONTENT CHANGES'} · 20–500 CHARACTERS</small></span><textarea required={publishedContentChanged} minLength={publishedContentChanged ? 20 : undefined} maxLength={500} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} rows={3} placeholder="Summarize what changed and why, such as new evidence, a correction, or updated uncertainty." /><small>Readers can see this note alongside the prior published version.</small></label>}
    {error && <div className="inline-error">{error}</div>}{saved && <div className="success-message"><Check size={15} />Article changes saved.</div>}
    <div className="article-edit-actions"><span>{article.status === 'draft' ? 'Publication requires complete sections and verified references.' : 'Classification changes remain visible to readers.'}</span><div><button className="button-secondary" type="submit" disabled={busy}>{busy ? 'Saving…' : article.status === 'draft' ? 'Save draft' : 'Save changes'}<Check size={14} /></button>{article.status === 'draft' && <button className="button-primary" type="button" disabled={busy} onClick={() => void publishArticle()}>{busy ? 'Preparing…' : 'Publish note'}<ArrowUpRight size={14} /></button>}</div></div>
  </form>
}

function AdminPage() {
  const { profile, loading: authLoading } = useAuth()
  const canEdit = profile && ['editor', 'administrator'].includes(profile.role)
  const isAdministrator = profile?.role === 'administrator'
  const [tab, setTab] = useState<AdminTab>('review')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [workingId, setWorkingId] = useState('')
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([])
  const [references, setReferences] = useState<ReferenceReview[]>([])
  const [articles, setArticles] = useState<EditorialArticle[]>([])
  const [comments, setComments] = useState<EditorialComment[]>([])
  const [commentReports, setCommentReports] = useState<CommentReport[]>([])
  const [people, setPeople] = useState<AdminProfile[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [stats, setStats] = useState<{ label: string; count: number }[]>([])
  const [categoryName, setCategoryName] = useState('')
  const [categoryDescription, setCategoryDescription] = useState('')
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [rejectionNotes, setRejectionNotes] = useState<Record<string, string>>({})
  const [reportResolutionNotes, setReportResolutionNotes] = useState<Record<string, string>>({})
  const tabs: { id: AdminTab; label: string; icon: typeof FileText; adminOnly?: boolean }[] = [
    { id: 'review', label: 'Review queue', icon: FileText },
    { id: 'references', label: 'References', icon: ExternalLink },
    { id: 'articles', label: 'Articles', icon: Feather },
    { id: 'comments', label: 'Comments', icon: MessageSquare },
    { id: 'reports', label: 'Reports', icon: Flag },
    { id: 'people', label: 'People & roles', icon: Users, adminOnly: true },
    { id: 'categories', label: 'Categories', icon: Tags },
    { id: 'statistics', label: 'Statistics', icon: BarChart3 },
  ]
  const visibleTabs = tabs.filter((item) => !item.adminOnly || isAdministrator)

  async function loadCurrentTab() {
    if (!supabase || !canEdit) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    if (tab === 'review') {
      const { data, error: queryError } = await supabase.from('submissions')
        .select('id,title,summary,classification,category_id,status,created_at,reference_urls,evidence,hero_image_url,author:profiles!submissions_author_id_fkey(display_name),category:categories(name)')
        .eq('status', 'pending').order('created_at', { ascending: true })
      if (queryError) setError(queryError.message)
      else setSubmissions((data ?? []) as unknown as ReviewSubmission[])
    } else if (tab === 'references') {
      const [submissionResult, sourceResult] = await Promise.all([
        supabase.from('submission_references')
          .select('id,url,verification_status,submission:submissions!submission_references_submission_id_fkey(title,status)')
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('sources')
          .select('id,url,verification_status,article:articles!sources_article_id_fkey(title,slug)')
          .order('created_at', { ascending: false }).limit(100),
      ])
      if (submissionResult.error) setError(submissionResult.error.message)
      if (sourceResult.error) setError((current) => current ? `${current}; ${sourceResult.error.message}` : sourceResult.error.message)
      if (!submissionResult.error && !sourceResult.error) {
        const submissionReferences = (submissionResult.data ?? []).map((reference) => ({
          ...reference,
          kind: 'submission' as const,
          article: null,
        }))
        const articleSources = (sourceResult.data ?? []).map((source) => ({
          ...source,
          kind: 'article' as const,
          submission: null,
        }))
        setReferences([...submissionReferences, ...articleSources] as unknown as ReferenceReview[])
      }
    } else if (tab === 'articles') {
      const [articleResult, categoryResult] = await Promise.all([
        supabase.from('articles')
        .select('id,title,slug,summary,body,introduction,background,current_understanding,future_possibilities,limitations,classification,status,category_id,published_at,reading_minutes,hero_image_url,author:profiles!articles_author_id_fkey(display_name),category:categories(name,slug)')
        .order('updated_at', { ascending: false }).limit(100),
        supabase.from('categories').select('id,name,slug,description,is_active').order('name'),
      ])
      if (articleResult.error) setError(articleResult.error.message)
      else setArticles((articleResult.data ?? []) as unknown as EditorialArticle[])
      if (categoryResult.error) setError(categoryResult.error.message)
      else setCategories((categoryResult.data ?? []) as AdminCategory[])
    } else if (tab === 'comments') {
      const { data, error: queryError } = await supabase.from('comments')
        .select('id,body,created_at,status,author:profiles!comments_author_id_fkey(display_name),article:articles(title,slug)')
        .order('created_at', { ascending: false }).limit(100)
      if (queryError) setError(queryError.message)
      else setComments((data ?? []) as unknown as EditorialComment[])
    } else if (tab === 'reports') {
      const { data, error: queryError } = await supabase.from('comment_reports')
        .select('id,comment_id,reason,details,created_at,reporter:profiles!comment_reports_reporter_id_fkey(display_name),comment:comments!comment_reports_comment_id_fkey(body,status,author:profiles!comments_author_id_fkey(display_name),article:articles(title,slug))')
        .eq('status', 'open')
        .order('created_at', { ascending: true })
        .limit(100)
      if (queryError) setError(queryError.message)
      else setCommentReports((data ?? []) as unknown as CommentReport[])
    } else if (tab === 'people' && isAdministrator) {
      const { data, error: queryError } = await supabase.from('profiles').select('id,display_name,avatar_url,role,created_at').order('created_at', { ascending: false }).limit(200)
      if (queryError) setError(queryError.message)
      else setPeople((data ?? []) as AdminProfile[])
    } else if (tab === 'categories') {
      const { data, error: queryError } = await supabase.from('categories').select('id,name,slug,description,is_active').order('name')
      if (queryError) setError(queryError.message)
      else setCategories((data ?? []) as AdminCategory[])
    } else if (tab === 'statistics') {
      const results = await Promise.all([
        supabase.from('articles').select('id', { count: 'exact', head: true }).eq('status', 'published'),
        supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('comments').select('id', { count: 'exact', head: true }).eq('status', 'visible'),
        supabase.from('submission_references').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending'),
      ])
      const failed = results.find((result) => result.error)
      if (failed?.error) setError(failed.error.message)
      else setStats([
        { label: 'Published notes', count: results[0].count ?? 0 },
        { label: 'Awaiting review', count: results[1].count ?? 0 },
        { label: 'Registered members', count: results[2].count ?? 0 },
        { label: 'Visible comments', count: results[3].count ?? 0 },
        { label: 'References to verify', count: results[4].count ?? 0 },
      ])
    }
    setLoading(false)
  }

  useEffect(() => { void loadCurrentTab() }, [tab, canEdit, isAdministrator])

  async function reviewSubmission(id: string, action: 'approve' | 'return' | 'reject') {
    if (!supabase) return
    setWorkingId(id)
    setError('')
    setMessage('')
    const { error: reviewError } = action === 'approve'
      ? await supabase.rpc('approve_submission', { submission_id: id })
      : action === 'return'
        ? await supabase.rpc('reject_submission', { submission_id: id, review_notes: reviewNotes[id]?.trim() ?? '' })
        : await supabase.rpc('reject_submission_final', { submission_id: id, rejection_notes: rejectionNotes[id]?.trim() ?? '' })
    if (reviewError) setError(reviewError.message)
    else {
      setMessage(action === 'approve'
        ? 'The submission is approved. A private editorial draft is ready to edit.'
        : action === 'return' ? 'Revision feedback was sent to the author.' : 'The submission was rejected and the author was notified.')
      if (action === 'return') setReviewNotes((current) => { const remaining = { ...current }; delete remaining[id]; return remaining })
      if (action === 'reject') setRejectionNotes((current) => { const remaining = { ...current }; delete remaining[id]; return remaining })
      await loadCurrentTab()
    }
    setWorkingId('')
  }

  async function updateReference(reference: ReferenceReview, status: ReferenceReview['verification_status']) {
    if (!supabase || !profile) return
    setWorkingId(reference.id)
    setError('')
    const table = reference.kind === 'submission' ? 'submission_references' : 'sources'
    const { error: updateError } = await supabase.from(table).update({
      verification_status: status,
      verified_by: status === 'verified' ? profile.id : null,
      verified_at: status === 'verified' ? new Date().toISOString() : null,
    }).eq('id', reference.id)
    if (updateError) setError(updateError.message)
    else {
      setReferences((current) => current.map((item) => item.id === reference.id ? { ...item, verification_status: status } : item))
      setMessage(`Reference marked ${status.replace('_', ' ')}.`)
    }
    setWorkingId('')
  }

  async function moderateComment(comment: EditorialComment, status: EditorialComment['status']) {
    if (!supabase) return
    setWorkingId(comment.id)
    setError('')
    const { error: updateError } = await supabase.rpc('moderate_comment', {
      p_comment_id: comment.id,
      p_status: status,
    })
    if (updateError) setError(updateError.message)
    else {
      setComments((current) => current.map((item) => item.id === comment.id ? { ...item, status } : item))
      setMessage(`Comment marked ${status}.`)
    }
    setWorkingId('')
  }

  async function resolveCommentReport(report: CommentReport, decision: 'dismiss' | 'hide' | 'remove') {
    if (!supabase) return
    setWorkingId(report.id)
    setError('')
    const { error: resolveError } = await supabase.rpc('resolve_comment_report', {
      p_report_id: report.id,
      p_decision: decision,
      p_resolution_note: reportResolutionNotes[report.id]?.trim() ?? '',
    })
    if (resolveError) setError(resolveError.message)
    else {
      setCommentReports((current) => current.filter((item) => item.id !== report.id))
      setReportResolutionNotes((current) => {
        const remaining = { ...current }
        delete remaining[report.id]
        return remaining
      })
      setMessage(decision === 'dismiss' ? 'Report dismissed with an editorial note.' : `Report resolved; comment ${decision === 'hide' ? 'hidden' : 'removed'}.`)
    }
    setWorkingId('')
  }

  async function updateRole(person: AdminProfile, role: Role) {
    if (!supabase) return
    setWorkingId(person.id)
    setError('')
    const { error: updateError } = await supabase.rpc('set_profile_role', { target_profile_id: person.id, new_role: role })
    if (updateError) setError(updateError.message)
    else {
      setPeople((current) => current.map((item) => item.id === person.id ? { ...item, role } : item))
      setMessage(`${person.display_name}'s role is now ${role}.`)
    }
    setWorkingId('')
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setWorkingId('new-category')
    setError('')
    const slug = categoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { data, error: insertError } = await supabase.from('categories').insert({
      name: categoryName.trim(),
      slug,
      description: categoryDescription.trim() || null,
    }).select('id,name,slug,description,is_active').single()
    if (insertError) setError(insertError.message)
    else {
      setCategories((current) => [...current, data as AdminCategory].sort((a, b) => a.name.localeCompare(b.name)))
      setCategoryName('')
      setCategoryDescription('')
      setMessage('Category created.')
    }
    setWorkingId('')
  }

  async function toggleCategory(category: AdminCategory) {
    if (!supabase) return
    setWorkingId(category.id)
    setError('')
    const { error: updateError } = await supabase.from('categories').update({ is_active: !category.is_active }).eq('id', category.id)
    if (updateError) setError(updateError.message)
    else setCategories((current) => current.map((item) => item.id === category.id ? { ...item, is_active: !item.is_active } : item))
    setWorkingId('')
  }

  if (authLoading) return <div className="loading-row"><span className="spinner" />Checking editorial access…</div>
  if (!canEdit) return <div><PageIntro eyebrow="EDITORIAL DESK" title="This room is for editors." description="Review submissions and publish notes only with an authorized editorial role." /><div className="login-prompt"><ShieldCheck size={20} /><div><strong>Editorial access required.</strong><p>Roles are assigned by an administrator and cannot be changed from your account.</p></div><Link to="/" className="button-text">Return home <ArrowRight size={14} /></Link></div><AppFooter /></div>

  return <div>
    <PageIntro eyebrow="EDITORIAL DESK" title="Carefully, before we publish." description="A human-reviewed workspace for submissions, references, articles, and community care." />
    {!backendConfigured && <ConnectionNotice />}
    <nav className="admin-tabs" aria-label="Editorial dashboard">
      {visibleTabs.map(({ id, label, icon: Icon }) => <button key={id} className={`admin-tab${tab === id ? ' admin-tab-active' : ''}`} onClick={() => { setTab(id); setMessage(''); setError('') }}><Icon size={15} />{label}</button>)}
    </nav>
    {message && <div className="success-message"><Check size={16} />{message}</div>}
    {error && <div className="inline-error">{error}</div>}
    {loading ? <div className="loading-row"><span className="spinner" />Loading the editorial desk…</div> : <>
      {tab === 'review' && (submissions.length ? <div className="review-list">{submissions.map((submission) => <article className="review-card" key={submission.id}><div className="article-card-meta"><ClassificationTag value={submission.classification} /><span>{submission.category?.name ?? 'Uncategorized'}</span><span>Submitted {new Date(submission.created_at).toLocaleDateString()}</span></div><h2>{submission.title}</h2><p>{submission.summary}</p><SubmissionReviewImage value={submission.hero_image_url} title={submission.title} />{submission.evidence && <div className="review-evidence"><strong>Evidence & context</strong><p>{submission.evidence}</p></div>}{submission.reference_urls.length > 0 && <div className="review-references"><strong>References — verify in the References tab before approval</strong>{submission.reference_urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url}<ExternalLink size={13} /></a>)}</div>}<label className="form-field review-feedback"><span>Actionable feedback for the author <small>REQUIRED TO REQUEST CHANGES</small></span><textarea required minLength={20} maxLength={2000} rows={3} value={reviewNotes[submission.id] ?? ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Explain what needs revision and why. Include source or uncertainty guidance where relevant." /></label><label className="form-field review-feedback"><span>Rejection explanation <small>REQUIRED · 20–2000 CHARACTERS</small></span><textarea required minLength={20} maxLength={2000} rows={3} value={rejectionNotes[submission.id] ?? ''} onChange={(event) => setRejectionNotes((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Explain why this submission is being declined." /></label><div className="review-actions"><span>By {submission.author?.display_name ?? 'Community member'}</span><div><button className="button-secondary" disabled={workingId === submission.id || (reviewNotes[submission.id]?.trim().length ?? 0) < 20} onClick={() => void reviewSubmission(submission.id, 'return')}>Request changes</button><button className="button-secondary review-reject-button" disabled={workingId === submission.id || (rejectionNotes[submission.id]?.trim().length ?? 0) < 20} onClick={() => void reviewSubmission(submission.id, 'reject')}>Reject Submission</button><button className="button-primary" disabled={workingId === submission.id} onClick={() => void reviewSubmission(submission.id, 'approve')}>{workingId === submission.id ? 'Reviewing…' : 'Approve & create draft'}<ArrowRight size={14} /></button></div></div></article>)}</div> : <EmptyState title="The review queue is clear." description="New member ideas will appear here when they're ready for editorial review." />)}
      {tab === 'references' && (references.length ? <div className="reference-review-list">{references.map((reference) => <article className="reference-review-card" key={`${reference.kind}-${reference.id}`}><div><div className="eyebrow">{reference.submission ? `SUBMISSION · ${reference.submission.title}` : `PUBLISHED NOTE · ${reference.article?.title ?? 'Untitled article'}`}</div><a href={reference.url} target="_blank" rel="noreferrer">{reference.url}<ExternalLink size={13} /></a></div><span className={`reference-status reference-${reference.verification_status}`}>{reference.verification_status.replace('_', ' ')}</span><div className="reference-actions"><button className="button-secondary" disabled={workingId === reference.id} onClick={() => void updateReference(reference, 'needs_attention')}>Needs attention</button><button className="button-primary" disabled={workingId === reference.id} onClick={() => void updateReference(reference, 'verified')}><Check size={14} />Verify source</button></div></article>)}</div> : <EmptyState title="No references need review." description="References attached to pending submissions will appear here. All references must be verified before an idea can be published." />)}
      {tab === 'articles' && (articles.length ? <div className="article-management-list">{articles.map((article) => <ArticleEditor article={article} categories={categories.length ? categories : []} key={article.id} onSaved={() => { setMessage(article.status === 'draft' ? 'The note is published.' : 'Article changes saved.'); void loadCurrentTab() }} />)}</div> : <EmptyState title="No articles to edit yet." description="Approved submissions appear here as editorial drafts. Published notes remain available for updates." />)}
      {tab === 'comments' && (comments.length ? <div className="moderation-list">{comments.map((comment) => <article className="moderation-card" key={comment.id}><div className="article-card-meta"><span className={`reference-status reference-${comment.status}`}>{comment.status}</span><span>{comment.author?.display_name ?? 'Community member'}</span><span>{new Date(comment.created_at).toLocaleDateString()}</span></div><p>{comment.body}</p><Link to={`/article/${comment.article?.slug ?? ''}`} className="moderation-article">{comment.article?.title ?? 'Article unavailable'} <ArrowUpRight size={13} /></Link><div className="moderation-actions"><button className="button-secondary" disabled={workingId === comment.id} onClick={() => void moderateComment(comment, comment.status === 'visible' ? 'hidden' : 'visible')}>{comment.status === 'visible' ? 'Hide comment' : 'Restore comment'}</button><button className="button-secondary" disabled={workingId === comment.id || comment.status === 'removed'} onClick={() => void moderateComment(comment, 'removed')}>Remove comment</button></div></article>)}</div> : <EmptyState title="No comments to moderate." description="Community comments will appear here as readers join the conversation." />)}
      {tab === 'reports' && (commentReports.length ? <div className="moderation-list">{commentReports.map((report) => <article className="moderation-card report-card" key={report.id}><div className="article-card-meta"><span className="reference-status reference-pending">OPEN REPORT</span><span>{report.reason.replace(/_/g, ' ')}</span><span>Reported {new Date(report.created_at).toLocaleDateString()}</span></div><div className="report-context"><div><strong>Comment by {report.comment?.author?.display_name ?? 'Community member'}</strong><p>{report.comment?.body ?? 'The reported comment is unavailable.'}</p></div><div><span>Reported by {report.reporter?.display_name ?? 'Community member'}</span>{report.details && <p>{report.details}</p>}</div></div><Link to={`/article/${report.comment?.article?.slug ?? ''}`} className="moderation-article">{report.comment?.article?.title ?? 'Article unavailable'} <ArrowUpRight size={13} /></Link><label className="form-field report-resolution"><span>Editorial resolution note <small>REQUIRED · 10–1000 CHARACTERS</small></span><textarea required minLength={10} maxLength={1000} rows={2} value={reportResolutionNotes[report.id] ?? ''} onChange={(event) => setReportResolutionNotes((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="Record the reason for dismissing this report or taking action." /></label><div className="moderation-actions"><button className="button-secondary" disabled={workingId === report.id || (reportResolutionNotes[report.id]?.trim().length ?? 0) < 10} onClick={() => void resolveCommentReport(report, 'dismiss')}>Dismiss</button><button className="button-secondary" disabled={workingId === report.id || (reportResolutionNotes[report.id]?.trim().length ?? 0) < 10} onClick={() => void resolveCommentReport(report, 'hide')}>Hide comment</button><button className="button-primary" disabled={workingId === report.id || (reportResolutionNotes[report.id]?.trim().length ?? 0) < 10} onClick={() => void resolveCommentReport(report, 'remove')}>{workingId === report.id ? 'Resolving…' : 'Remove comment'}</button></div></article>)}</div> : <EmptyState title="No open reports." description="Reader reports about visible comments appear here for private editorial review." />)}
      {tab === 'people' && isAdministrator && <div className="people-list">{people.map((person) => <div className="people-row" key={person.id}><UserAvatar url={person.avatar_url} name={person.display_name} /><div className="people-info"><strong>{person.display_name}</strong><span>Joined {new Date(person.created_at).toLocaleDateString()}</span></div><select aria-label={`Role for ${person.display_name}`} value={person.role} disabled={person.id === profile?.id || workingId === person.id} onChange={(event) => void updateRole(person, event.target.value as Role)}>{(['member', 'contributor', 'editor', 'administrator'] as Role[]).map((role) => <option key={role} value={role}>{role}</option>)}</select>{person.id === profile?.id && <span className="self-role-note">Your role</span>}</div>)}{people.length === 0 && <EmptyState title="No member profiles found." description="New members will appear here after their first registration." />}</div>}
      {tab === 'categories' && <div className="category-management"><form className="category-create-form" onSubmit={(event) => void createCategory(event)}><div className="eyebrow"><span className="eyebrow-line" />ADD A FIELD</div><label className="form-field"><span>Category name</span><input required minLength={2} maxLength={60} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Agriculture" /></label><label className="form-field"><span>Description</span><input value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} maxLength={300} placeholder="What belongs in this field?" /></label><button className="button-primary" disabled={workingId === 'new-category'}><Plus size={14} />Create category</button></form><div className="category-manage-list">{categories.map((category) => <div className="category-manage-row" key={category.id}><div><strong>{category.name}</strong><span>/{category.slug}</span>{category.description && <p>{category.description}</p>}</div><span className={`reference-status ${category.is_active ? 'reference-verified' : 'reference-hidden'}`}>{category.is_active ? 'active' : 'archived'}</span><button className="button-secondary" disabled={workingId === category.id} onClick={() => void toggleCategory(category)}>{category.is_active ? 'Archive' : 'Reactivate'}</button></div>)}</div></div>}
      {tab === 'statistics' && <div className="stats-grid">{stats.map(({ label, count }) => <div className="stat-card" key={label}><div className="eyebrow">{label}</div><strong>{count.toLocaleString()}</strong><span>Live database count</span></div>)}</div>}
    </>}
    <AppFooter />
  </div>
}


export default AdminPage
