# AFTERLIGHT

Explore. Imagine. Create Tomorrow.

AFTERLIGHT is a future-exploration platform designed to keep verified facts, active research, predictions, plausible scenarios, and creative speculation visibly distinct. The application does not ship fabricated research or example articles; published content is read from Supabase and must pass the editorial workflow.

## Local development

1. Install Node.js 20.19+ or 22.12+.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and add a Supabase project URL and public anon/publishable key.
4. Apply all migrations in order: `supabase/migrations/202611010001_initial_schema.sql`, `supabase/migrations/202611010002_editorial_media_notifications.sql`, `supabase/migrations/202611010003_separated_editorial_workflow.sql`, `supabase/migrations/202611010004_research_assistant.sql`, `supabase/migrations/202611010005_community_activity.sql`, `supabase/migrations/202611010006_contributor_profiles.sql`, `supabase/migrations/202611010007_explore_search.sql`, `supabase/migrations/202611010008_article_revision_history.sql`, `supabase/migrations/202611010009_comment_reports.sql`, and `supabase/migrations/202611010010_moderation_notifications.sql`. In Supabase SQL Editor, run each file once in order. With the CLI, run `supabase link --project-ref <project-ref>` once, then `supabase db push`.
5. Start Vite with `npm run dev`.

Without Supabase credentials the public interface remains navigable, but it explains that the research desk is offline. Authentication, submissions, and article data are not simulated.

## Supabase setup

- Enable email/password authentication and configure email confirmation in Supabase Auth.
- Apply all ten SQL migrations in order. They create profiles, categories, submissions, structured articles, sources, comments, comment reports, reactions, bookmarks, editorial reviews, notifications, indexes, role checks, image storage policies, Row Level Security policies, a private assistant rate-limit store, safe community activity aggregates, public contributor bios, indexed database-backed Explore search, immutable article revision history, and moderation outcome notifications.
- The Supabase CLI config is in `supabase/config.toml`; local authentication redirects are configured for Vite on port 5173. The local database intentionally has seed data disabled.
- To provision the first administrator, identify their profile UUID in the Supabase dashboard and run `update public.profiles set role = 'administrator' where id = '<auth-user-uuid>';` in the SQL editor. Do not expose a service-role key in the browser.
- User registration always creates a `member`. Profile-role changes are guarded in PostgreSQL; only an existing administrator may change roles.
- Editorial review and publication are separate steps. An editor verifies references and approves a submission into a private draft; the editor then completes the article sections and explicitly publishes it. Database functions and triggers enforce the approval, completeness, and source-verification requirements.
- Changes to a published article's content, classification, category, or image require an editor's 20–500 character change note. PostgreSQL records the prior published version and note in an append-only history; readers can inspect earlier versions on the article page. Draft edits do not create public revision entries.
- If an editor requests changes, the author receives required actionable feedback and can revise and resubmit. The revision is handled by a restricted database function rather than granting members direct update access to submissions.
- Fact, research, and prediction submissions require at least one verified reference. Editors can also review sources attached to published notes; unverified sources are hidden from public readers.
- The community page uses public published notes, visible discussions, and aggregate reactions from the last 30 days. Database functions expose only aggregate counts for trending notes and community totals; member bookmarks and private submissions are not included.
- Contributor profiles show only the member's chosen public bio, avatar, display name, and published notes. Profile update privileges are restricted to display name, avatar URL, and bio; account roles remain managed by the administrator-only role function.
- Community images use the `article-images` Supabase Storage bucket, with a 5 MB limit and JPG, PNG, WebP, or AVIF file types. Images are public by URL; object names are randomized and members can upload only to their own folder.
- The AI research assistant requires an OpenAI API key configured as a Supabase Edge Function secret. It only uses published AFTERLIGHT notes and references visible under the signed-in user's RLS policies; it does not search the web or save conversations. Each account is limited to 10 requests per hour. Responses are clearly labeled AI-generated and are never marked as verified.

### Research assistant secrets and function

1. In Supabase project settings, add `OPENAI_API_KEY` as an Edge Function secret. Optionally add `OPENAI_MODEL` (defaults to `gpt-4o-mini`). Never add these values to `VITE_` variables or commit them.
2. Deploy the function with `supabase functions deploy research-assistant`.
3. For local Supabase development, copy `supabase/.env.example` to the ignored `supabase/.env.local`, set your key, and run `supabase functions serve research-assistant --env-file supabase/.env.local`.
4. In the app, sign in and open **Research assistant**. Questions and relevant excerpts from published notes are sent to OpenAI when submitted; avoid personal or confidential details. AFTERLIGHT does not persist the conversation.

## Deploy

### Vercel

1. Import the project into Vercel and select the Vite framework preset.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as project environment variables for the required deployment environments.
3. Deploy. `vercel.json` routes client-side navigation to the Vite app.
4. Add the deployed domain to Supabase Auth's allowed redirect URLs. Configure `afterlight.world` only after confirming domain availability and completing DNS setup.

### Supabase

Keep database access behind the included Row Level Security policies. The browser only receives the Supabase URL and public anon/publishable key; never put the service-role key in a `VITE_` variable or frontend source.

## Product foundation

- Responsive React + TypeScript + Vite experience with animated route transitions, an accessible navigation shell, and a shared visual system.
- Explore, discover, community, submission, article, authentication, profile, editorial review, and about surfaces.
- Authenticated AI research assistant grounded in published notes, with verified-reference links, uncertainty disclosure, per-account rate limiting, and server-side OpenAI credentials.
- Community activity hub with published-note trends, visible discussion excerpts, recent contributors, and live aggregate statistics.
- Public contributor profiles with editable bios, linked author pages, and published-note histories.
- Explore uses indexed PostgreSQL full-text search across article titles, summaries, and editorial sections, with live category/classification filters, relevance/title/date sorting, and bounded load-more pagination over published articles only.
- Published article pages show immutable prior versions and editor-provided explanations when substantive content is updated.
- Signed-in readers can privately report another member's visible comment. Reports are visible only to the reporter and editors, cannot be edited or deleted by members, and are resolved by an editor with a recorded note; hiding or removing a comment and resolving its report happen atomically.
- Reporters receive a private inbox notification when a report is resolved. Comment authors receive an update only when an editor hides or removes their comment; reporter identity and report details are not disclosed.
- Email/password authentication, protected role management, database-backed public articles, source verification, comments, reactions, bookmarks, pending editorial submissions, category management, and live editorial statistics.
- Structured article sections for introduction, background, current scientific understanding, future possibilities, and limitations; members can manage their profiles, saved notes, submission status, editorial feedback, and notifications.
- Five explicit content classifications and editorial guardrails in both the interface and database.
- AI output is explicitly labeled as generated and unverified, never added to articles automatically, and is not a substitute for editorial review.

## Quality checks

- `npm run lint` — TypeScript check.
- `npm run build` — TypeScript check and production Vite build.
