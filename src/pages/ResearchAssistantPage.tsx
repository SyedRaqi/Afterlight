import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, ExternalLink, LockKeyhole, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { AppFooter, ClassificationTag, ConnectionNotice, PageIntro } from '../App'
import { useAuth } from '../lib/auth'
import { backendConfigured, supabase } from '../lib/supabase'
import type { Classification } from '../lib/types'
interface AssistantCitation {
  id: string
  title: string
  url: string
  publisher: string | null
  articleTitle: string
  articleSlug: string
  classification: Classification
}

interface AssistantResult {
  answer: string
  uncertainty: string
  citations: AssistantCitation[]
  generated: boolean
}

function ResearchAssistantPage() {
  const { session, loading: authLoading } = useAuth()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AssistantResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function askQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !session) return

    setBusy(true)
    setError('')
    setAnswer(null)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<AssistantResult>('research-assistant', {
        body: { question: question.trim() },
      })
      if (invokeError) {
        const context = invokeError.context
        if (context instanceof Response) {
          const payload = await context.json().catch(() => null) as { error?: string } | null
          setError(payload?.error ?? invokeError.message)
        } else {
          setError(invokeError.message)
        }
      } else if (data) {
        setAnswer(data)
      } else {
        setError('The assistant returned no response. Please try again.')
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The assistant could not complete this request.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="assistant-page">
    <PageIntro eyebrow="AI RESEARCH ASSISTANT" title="Follow the evidence." description="Explore questions through published AFTERLIGHT notes. The assistant can help connect ideas and surface uncertainty; it is not a source of verified facts." />
    <div className="assistant-disclosure"><ShieldCheck size={17} /><p><strong>Grounded in the published field notes.</strong> Questions and excerpts from relevant notes are sent to OpenAI to generate a response. AFTERLIGHT does not save this conversation. Please don’t include personal or confidential details.</p></div>
    {!backendConfigured && <ConnectionNotice />}
    {backendConfigured && !authLoading && !session && <div className="login-prompt"><LockKeyhole size={20} /><div><strong>Sign in to ask a research question.</strong><p>Your question is sent to OpenAI only after you submit it.</p></div><Link to="/login" className="button-text">Sign in <ArrowRight size={14} /></Link></div>}
    {authLoading && <div className="loading-row"><span className="spinner" />Checking your session…</div>}
    {session && <div className="assistant-layout">
      <aside className="assistant-guide">
        <div className="eyebrow"><span className="eyebrow-line" />A CAREFUL COMPANION</div>
        <h2>Curiosity, with context.</h2>
        <p>Ask what evidence suggests, what remains uncertain, or how different published notes compare.</p>
        <ul><li>Answers use published AFTERLIGHT notes only.</li><li>Source links are matched against verified references.</li><li>AI responses are not editorially reviewed or marked as facts.</li></ul>
        <Link to="/explore" className="button-text">Browse field notes <ArrowRight size={14} /></Link>
      </aside>
      <section className="assistant-workspace" aria-label="Ask the research assistant">
        <div className="assistant-workspace-head"><span className="assistant-icon"><Sparkles size={17} /></span><div><strong>Ask a question</strong><span>Answers draw only from the published AFTERLIGHT library</span></div></div>
        <form className="assistant-form" onSubmit={(event) => void askQuestion(event)}>
          <label className="form-field"><span>Your research question <small>{question.length}/1000</small></span><textarea required minLength={12} maxLength={1000} rows={5} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What evidence in the published notes suggests how urban heat may change over time?" /></label>
          <div className="assistant-form-foot"><span><LockKeyhole size={13} /> Sent to OpenAI; not saved by AFTERLIGHT</span><button className="button-primary" disabled={busy || question.trim().length < 12}>{busy ? <><span className="spinner spinner-small" />Thinking…</> : <><Send size={14} />Ask the assistant</>}</button></div>
        </form>
        {error && <div className="inline-error" role="alert">{error}</div>}
        {busy && <div className="assistant-loading" role="status"><span className="spinner" /><span>Comparing published notes and their verified references…</span></div>}
        {answer && <article className="assistant-answer" aria-live="polite">
          <div className="assistant-answer-label"><Sparkles size={13} />{answer.generated ? 'AI-GENERATED · NOT VERIFIED' : 'FIELD NOTES · NO CLEAR MATCH'}</div>
          <p className="assistant-answer-copy">{answer.answer}</p>
          {answer.uncertainty && <div className="assistant-uncertainty"><strong>Uncertainty & limits</strong><p>{answer.uncertainty}</p></div>}
          {answer.citations.length > 0 && <div className="assistant-citations"><strong>References from published notes</strong>{answer.citations.map((citation) => <div className="assistant-citation" key={citation.id}><a href={citation.url} target="_blank" rel="noreferrer"><span>{citation.title}{citation.publisher && <small>{citation.publisher}</small>}</span><ExternalLink size={13} /></a><div><ClassificationTag value={citation.classification} /><Link to={`/article/${citation.articleSlug}`}>{citation.articleTitle} <ArrowUpRight size={12} /></Link></div></div>)}</div>}
          <p className="assistant-disclaimer">AI-generated and not independently verified. Check the linked notes and sources before relying on any claim.</p>
        </article>}
      </section>
    </div>}
    <AppFooter />
  </div>
}


export default ResearchAssistantPage
