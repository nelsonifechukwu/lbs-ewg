import { FormEvent, useEffect, useMemo, useState } from 'react'

// ─────────────────────── types ───────────────────────

// EntryType is an open string. TYPE_META lists the well-known values for
// autocomplete and nice pill rendering, but the user can type anything (e.g.
// "podcast", "book", "newsletter") and the backend stores it as-is. Display
// falls back to a generic icon for unknown values.
type EntryType = string

type Entry = {
  id: number
  entry_type: EntryType
  name: string
  blurb: string
  why: string
  primary_url: string
  image_url: string | null
  // tags remains in the DB but is no longer surfaced by the UI — search,
  // form, and display all omit it. Treated as opaque on the frontend.
  tags: string
  links: string[]
  last_visited_at: string | null
  created_at: string
  updated_at: string
}

type EntryDraft = {
  entry_type: EntryType
  name: string
  primary_url: string
  blurb: string
  why: string
  other_links: string  // textarea raw — split on newlines at submit
}

// ─────────────────────── type meta (single source of truth) ───────────────────────
// Well-known types with curated labels + icons. Unknown types still work —
// they just render with the raw string as label and a generic ti-circle icon.
// Adding a future well-known type is one line here.

const TYPE_META: Record<string, { label: string; icon: string }> = {
  person: { label: 'Person', icon: 'ti-user' },
  channel: { label: 'Channel', icon: 'ti-brand-youtube' },
  podcast: { label: 'Podcast', icon: 'ti-microphone' },
  book: { label: 'Book', icon: 'ti-book-2' },
  paper: { label: 'Paper', icon: 'ti-file-text' },
  talk: { label: 'Talk', icon: 'ti-presentation' },
  newsletter: { label: 'Newsletter', icon: 'ti-mail' },
  blog: { label: 'Blog', icon: 'ti-writing' },
}

const UNKNOWN_TYPE_ICON = 'ti-circle-dot'

function typeMeta(t: string): { label: string; icon: string } {
  return TYPE_META[t] ?? { label: t, icon: UNKNOWN_TYPE_ICON }
}

// ─────────────────────── helpers ───────────────────────

type LinkKind = 'twitter' | 'github' | 'youtube' | 'scholar' | 'linkedin' | 'email' | 'website'

function detectLinkKind(url: string): LinkKind {
  if (url.startsWith('mailto:')) return 'email'
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'twitter.com' || host === 'x.com') return 'twitter'
    if (host === 'github.com') return 'github'
    if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube'
    if (host === 'scholar.google.com') return 'scholar'
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin'
  } catch {
    /* not a parseable URL */
  }
  return 'website'
}

function iconForLinkKind(kind: LinkKind): string {
  switch (kind) {
    case 'twitter': return 'ti-brand-x'
    case 'github': return 'ti-brand-github'
    case 'youtube': return 'ti-brand-youtube'
    case 'scholar': return 'ti-school'
    case 'linkedin': return 'ti-brand-linkedin'
    case 'email': return 'ti-mail'
    case 'website': return 'ti-world'
  }
}

const MONOGRAM_PALETTE = [
  { bg: 'bg-sky-100', fg: 'text-sky-700' },
  { bg: 'bg-emerald-100', fg: 'text-emerald-700' },
  { bg: 'bg-rose-100', fg: 'text-rose-700' },
  { bg: 'bg-amber-100', fg: 'text-amber-700' },
  { bg: 'bg-violet-100', fg: 'text-violet-700' },
  { bg: 'bg-teal-100', fg: 'text-teal-700' },
]

function monogram(name: string): { letters: string; bg: string; fg: string } {
  const words = name.trim().split(/\s+/).slice(0, 2)
  const letters = words.map((w) => w[0] || '').join('').toUpperCase() || '?'
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % MONOGRAM_PALETTE.length
  return { letters, ...MONOGRAM_PALETTE[idx] }
}

// ─────────────────────── fetch helpers ───────────────────────

async function fetchEntries(): Promise<Entry[]> {
  const r = await fetch('/api/thinkers/entries')
  if (!r.ok) throw new Error('Failed to fetch entries')
  return r.json()
}

type CreatePayload = {
  entry_type: EntryType
  name: string
  primary_url: string
  blurb: string
  why: string
  links: string[]
}

async function createEntry(payload: CreatePayload): Promise<Entry> {
  const r = await fetch('/api/thinkers/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error('Failed to create entry')
  return r.json()
}

async function updateEntry(
  id: number,
  patch: Partial<Pick<Entry, 'entry_type' | 'name' | 'blurb' | 'why' | 'primary_url' | 'links'>>,
): Promise<Entry> {
  const r = await fetch(`/api/thinkers/entries/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!r.ok) throw new Error('Failed to update entry')
  return r.json()
}

async function deleteEntry(id: number): Promise<void> {
  const r = await fetch(`/api/thinkers/entries/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error('Failed to delete entry')
}

async function visitEntry(id: number): Promise<void> {
  await fetch(`/api/thinkers/entries/${id}/visit`, { method: 'POST' })
}

// The backend exposes POST /api/thinkers/entries/{id}/refetch-image but no UI
// currently triggers it. When a "refresh image" affordance is added, the
// corresponding fetch helper goes here.

// ─────────────────────── EntryCard ───────────────────────

type EntryCardProps = {
  entry: Entry
  onEdit: () => void
  onDelete: () => void
  onVisit: () => void
}

function EntryCard({ entry, onEdit, onDelete, onVisit }: EntryCardProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => {
    if (!confirmingDelete) return
    const t = setTimeout(() => setConfirmingDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmingDelete])

  const mono = monogram(entry.name)
  const useMonogram = !entry.image_url || imgFailed
  const meta = typeMeta(entry.entry_type)

  function openPrimary() {
    onVisit()  // parent updates local state optimistically and fires the API call
    window.open(entry.primary_url, '_blank', 'noopener')
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (confirmingDelete) {
      onDelete()
    } else {
      setConfirmingDelete(true)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openPrimary}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openPrimary()
        }
      }}
      className="group bg-white border border-slate-200 hover:border-slate-300 transition-colors rounded-lg p-4 cursor-pointer"
    >
      <div className="flex items-start gap-3">
        {useMonogram ? (
          <div
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${mono.bg} ${mono.fg}`}
          >
            {mono.letters}
          </div>
        ) : (
          <img
            src={entry.image_url!}
            alt=""
            onError={() => setImgFailed(true)}
            className="shrink-0 w-10 h-10 rounded-full object-cover bg-slate-100"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-700 truncate">{entry.name}</div>
              {entry.blurb && (
                <div className="text-sm text-slate-500 line-clamp-2">
                  {entry.blurb}
                </div>
              )}
            </div>
            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 text-xs whitespace-nowrap">
              <i className={`ti ${meta.icon}`} aria-hidden /> {meta.label}
            </span>
          </div>
        </div>
      </div>

      {entry.why && (
        <div className="mt-2 text-sm text-slate-500 italic">{entry.why}</div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          {entry.links.map((url) => {
            const kind = detectLinkKind(url)
            return (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-slate-400 hover:text-slate-600"
                aria-label={kind}
              >
                <i className={`ti ${iconForLinkKind(kind)} text-base`} aria-hidden />
              </a>
            )
          })}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="text-slate-400 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Edit"
        >
          <i className="ti ti-pencil text-base" aria-hidden />
        </button>
        <button
          type="button"
          onClick={handleDeleteClick}
          className={
            confirmingDelete
              ? 'bg-rose-500 hover:bg-rose-600 text-white text-xs px-2 py-0.5 rounded'
              : 'text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity'
          }
          aria-label={confirmingDelete ? 'Click again to confirm delete' : 'Delete'}
        >
          {confirmingDelete ? 'Delete?' : <i className="ti ti-trash text-base" aria-hidden />}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────── EntryForm ───────────────────────

type EntryFormProps = {
  initial?: Entry
  submitting: boolean
  onSubmit: (draft: EntryDraft) => void
  onCancel: () => void
}

function EntryForm({ initial, submitting, onSubmit, onCancel }: EntryFormProps) {
  const [draft, setDraft] = useState<EntryDraft>({
    entry_type: initial?.entry_type ?? 'person',
    name: initial?.name ?? '',
    primary_url: initial?.primary_url ?? '',
    blurb: initial?.blurb ?? '',
    why: initial?.why ?? '',
    other_links: (initial?.links ?? []).join('\n'),
  })
  const [error, setError] = useState<string | null>(null)

  const isEdit = !!initial

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!draft.name.trim()) {
      setError('Name is required')
      return
    }
    if (!draft.primary_url.trim()) {
      setError('Primary URL is required')
      return
    }
    try {
      new URL(draft.primary_url)
    } catch {
      setError('Primary URL is not a valid URL')
      return
    }
    setError(null)
    onSubmit(draft)
  }

  const inputCls =
    'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-sky-500'

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-700">
        {isEdit ? 'Edit thinker' : 'Add thinker'}
      </h2>

      <div>
        <input
          type="text"
          list="entry-types"
          value={draft.entry_type}
          onChange={(e) => setDraft({ ...draft, entry_type: e.target.value })}
          placeholder="Type (person, channel, podcast, book, ...)"
          className={inputCls}
        />
        <datalist id="entry-types">
          {Object.keys(TYPE_META).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      <input
        type="text"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Name (required)"
        className={inputCls}
        autoFocus
      />
      <input
        type="text"
        value={draft.primary_url}
        onChange={(e) => setDraft({ ...draft, primary_url: e.target.value })}
        placeholder="Primary URL (required)"
        className={inputCls}
      />
      <input
        type="text"
        value={draft.blurb}
        onChange={(e) => setDraft({ ...draft, blurb: e.target.value })}
        placeholder="Blurb"
        className={inputCls}
      />
      <input
        type="text"
        value={draft.why}
        onChange={(e) => setDraft({ ...draft, why: e.target.value })}
        placeholder="Why does this matter to you?"
        className={inputCls}
      />
      <textarea
        value={draft.other_links}
        onChange={(e) => setDraft({ ...draft, other_links: e.target.value })}
        placeholder="Other links (one URL per line)"
        rows={3}
        className={inputCls}
      />

      {error && <div className="text-xs text-rose-600">{error}</div>}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm px-4 py-1.5 rounded inline-flex items-center gap-2"
        >
          {submitting && !isEdit && (
            <i className="ti ti-loader-2 animate-spin" aria-hidden />
          )}
          {submitting && !isEdit
            ? 'Fetching image...'
            : isEdit
            ? 'Save'
            : 'Add'}
        </button>
      </div>
    </form>
  )
}

// ─────────────────────── ThinkersTab ───────────────────────

type Modal =
  | { kind: 'closed' }
  | { kind: 'add'; submitting: boolean }
  | { kind: 'edit'; entry: Entry; submitting: boolean }

export default function ThinkersTab() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | EntryType>('all')
  const [sort, setSort] = useState<'recently_added' | 'recently_visited'>('recently_added')
  const [modal, setModal] = useState<Modal>({ kind: 'closed' })

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const list = await fetchEntries()
      setEntries(list)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(console.error)
  }, [])

  // ESC closes the modal.
  useEffect(() => {
    if (modal.kind === 'closed') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setModal({ kind: 'closed' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modal.kind])

  // Distinct entry_types that exist in the current list, so the filter row
  // grows naturally as new types appear. Ordered: well-known types first
  // (in TYPE_META declaration order), then any custom types alphabetically.
  const distinctTypes = useMemo(() => {
    const present = new Set(entries.map((e) => e.entry_type))
    const known = Object.keys(TYPE_META).filter((t) => present.has(t))
    const custom = Array.from(present)
      .filter((t) => !(t in TYPE_META))
      .sort()
    return [...known, ...custom]
  }, [entries])

  const filtered = useMemo(() => {
    let result = entries
    if (typeFilter !== 'all') {
      result = result.filter((e) => e.entry_type === typeFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.blurb.toLowerCase().includes(q) ||
          e.why.toLowerCase().includes(q),
      )
    }
    const sorted = [...result]
    if (sort === 'recently_visited') {
      // Nulls last; most recent first within the visited group.
      sorted.sort((a, b) => {
        if (a.last_visited_at && b.last_visited_at) {
          return b.last_visited_at.localeCompare(a.last_visited_at)
        }
        if (a.last_visited_at) return -1
        if (b.last_visited_at) return 1
        return 0
      })
    } else {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    return sorted
  }, [entries, typeFilter, search, sort])

  function draftToPayload(draft: EntryDraft): CreatePayload {
    const links = draft.other_links
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return {
      entry_type: draft.entry_type,
      name: draft.name.trim(),
      primary_url: draft.primary_url.trim(),
      blurb: draft.blurb.trim(),
      why: draft.why.trim(),
      links,
    }
  }

  async function handleAddSubmit(draft: EntryDraft) {
    setModal({ kind: 'add', submitting: true })
    try {
      const created = await createEntry(draftToPayload(draft))
      setEntries((prev) => [created, ...prev])
      setModal({ kind: 'closed' })
    } catch (err) {
      console.error(err)
      setModal({ kind: 'add', submitting: false })
    }
  }

  async function handleEditSubmit(draft: EntryDraft) {
    if (modal.kind !== 'edit') return
    const target = modal.entry
    setModal({ kind: 'edit', entry: target, submitting: true })
    try {
      const updated = await updateEntry(target.id, draftToPayload(draft))
      setEntries((prev) => prev.map((e) => (e.id === target.id ? updated : e)))
      setModal({ kind: 'closed' })
    } catch (err) {
      console.error(err)
      setModal({ kind: 'edit', entry: target, submitting: false })
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteEntry(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  // Optimistic visit: bump last_visited_at locally so the card sorts and
  // displays correctly right away, then fire-and-forget the API call.
  function handleVisit(id: number) {
    const now = new Date().toISOString()
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, last_visited_at: now } : e)),
    )
    visitEntry(id).catch(console.error)
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-700">Thinkers</h1>
        <p className="text-sm text-slate-500 mt-1">people and channels that fuel me</p>
      </header>

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <i
            className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, blurb, why..."
            className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-sky-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-sky-500"
        >
          <option value="all">All types</option>
          {distinctTypes.map((t) => (
            <option key={t} value={t}>
              {typeMeta(t).label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) =>
            setSort(e.target.value as 'recently_added' | 'recently_visited')
          }
          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-sky-500"
        >
          <option value="recently_added">Recently added</option>
          <option value="recently_visited">Recently visited</option>
        </select>
        <button
          type="button"
          onClick={() => setModal({ kind: 'add', submitting: false })}
          className="bg-sky-600 hover:bg-sky-700 text-white text-sm px-3 py-2 rounded inline-flex items-center gap-1"
        >
          <i className="ti ti-plus" aria-hidden /> Add
        </button>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading...</div>
      ) : loadError ? (
        <div className="text-slate-400 text-sm">
          Couldn't load entries.{' '}
          <button
            type="button"
            onClick={() => load().catch(console.error)}
            className="text-sky-600 hover:text-sky-700 underline"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-slate-400 text-sm text-center py-12">
          {entries.length === 0
            ? 'No one here yet. Add the first.'
            : 'No matches.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onEdit={() =>
                setModal({ kind: 'edit', entry, submitting: false })
              }
              onDelete={() => handleDelete(entry.id)}
              onVisit={() => handleVisit(entry.id)}
            />
          ))}
        </div>
      )}

      {modal.kind !== 'closed' && (
        <div
          className="fixed inset-0 bg-black/20 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal({ kind: 'closed' })
          }}
        >
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <EntryForm
              initial={modal.kind === 'edit' ? modal.entry : undefined}
              submitting={modal.submitting}
              onSubmit={modal.kind === 'add' ? handleAddSubmit : handleEditSubmit}
              onCancel={() => setModal({ kind: 'closed' })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
