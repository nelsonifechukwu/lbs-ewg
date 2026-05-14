import { FormEvent, useEffect, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const TAB_ID = 'jobs'

type Application = {
  id: number
  title: string
  notes: string
  url: string
  done: boolean
  position: number
  created_at: string
  updated_at: string
}

type SearchResult = {
  title: string
  done: boolean
  tab: string
  tab_label: string
}

async function fetchApplications(): Promise<Application[]> {
  const r = await fetch('/api/jobs/applications')
  if (!r.ok) throw new Error('Failed to fetch applications')
  return r.json()
}

async function createApplication(title: string, done = false): Promise<Application> {
  const r = await fetch('/api/jobs/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, done }),
  })
  if (!r.ok) throw new Error('Failed to create application')
  return r.json()
}

async function searchTasks(q: string): Promise<SearchResult[]> {
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
  if (!r.ok) throw new Error('Failed to search')
  return r.json()
}

async function patchApplication(
  id: number,
  patch: Partial<Pick<Application, 'title' | 'notes' | 'url' | 'done'>>,
): Promise<Application> {
  const r = await fetch(`/api/jobs/applications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!r.ok) throw new Error('Failed to update application')
  return r.json()
}

async function deleteApplication(id: number): Promise<void> {
  const r = await fetch(`/api/jobs/applications/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error('Failed to delete application')
}

async function reorderApplications(
  items: { id: number; position: number }[],
): Promise<void> {
  const r = await fetch('/api/jobs/applications/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!r.ok) throw new Error('Failed to reorder')
}

export default function JobsTab() {
  const [apps, setApps] = useState<Application[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingUrl, setEditingUrl] = useState('')
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [pendingConfirm, setPendingConfirm] = useState<SearchResult | null>(null)
  const [sameTabError, setSameTabError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  async function refresh() {
    setApps(await fetchApplications())
  }

  useEffect(() => {
    refresh().catch(console.error)
  }, [])

  // Debounced cross-tab title search. Same-tab hits are filtered out — they'd
  // just suggest adding a duplicate to the tab the user is already on.
  useEffect(() => {
    const q = newTitle.trim()
    if (!q || pendingConfirm) {
      setSuggestions([])
      return
    }
    const t = setTimeout(() => {
      searchTasks(q)
        .then((results) => setSuggestions(results.filter((r) => r.tab !== TAB_ID)))
        .catch(console.error)
    }, 150)
    return () => clearTimeout(t)
  }, [newTitle, pendingConfirm])

  // Clear the same-tab error as soon as the user edits the title and tries
  // again — no need to dismiss it manually.
  useEffect(() => {
    if (sameTabError) setSameTabError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTitle])

  const done = apps.filter((a) => a.done).length
  const total = apps.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    // Authoritative check at submit time so a fast typist can't outrun the
    // debounced suggestions.
    const results = await searchTasks(title)
    const lower = title.toLowerCase()
    // Hard block: case-insensitive title duplicate inside this tab.
    const sameTab = results.find(
      (r) => r.tab === TAB_ID && r.title.trim().toLowerCase() === lower,
    )
    if (sameTab) {
      setSameTabError(`"${sameTab.title}" is already in this tab.`)
      return
    }
    // Soft prompt: same title exists in another tab — offer to add here too.
    const otherTab = results.find(
      (r) => r.tab !== TAB_ID && r.title.trim().toLowerCase() === lower,
    )
    if (otherTab) {
      setPendingConfirm(otherTab)
      return
    }
    setNewTitle('')
    setSuggestions([])
    await createApplication(title)
    await refresh()
  }

  function handlePickSuggestion(s: SearchResult) {
    setNewTitle(s.title)
    setSuggestions([])
    setPendingConfirm(s)
  }

  async function handleConfirmAdd() {
    if (!pendingConfirm) return
    const { title, done } = pendingConfirm
    setPendingConfirm(null)
    setNewTitle('')
    setSuggestions([])
    await createApplication(title, done)
    await refresh()
  }

  function handleCancelConfirm() {
    setPendingConfirm(null)
  }

  async function handleToggle(app: Application) {
    await patchApplication(app.id, { done: !app.done })
    await refresh()
  }

  async function handleDelete(id: number) {
    await deleteApplication(id)
    await refresh()
  }

  async function handleSaveEdit(app: Application) {
    const title = editingTitle.trim()
    const url = editingUrl.trim()
    if (!title) {
      setEditingId(null)  // empty title cancels the edit
      return
    }
    // Same-tab title-rename uniqueness check. Stay in edit mode on conflict
    // so the user can correct it without losing their typing.
    if (title.toLowerCase() !== app.title.toLowerCase()) {
      const conflict = apps.find(
        (a) =>
          a.id !== app.id &&
          a.title.trim().toLowerCase() === title.toLowerCase(),
      )
      if (conflict) {
        setSameTabError(`"${conflict.title}" is already in this tab.`)
        return
      }
    }
    setEditingId(null)
    const patch: Partial<Pick<Application, 'title' | 'url'>> = {}
    if (title !== app.title) patch.title = title
    if (url !== app.url) patch.url = url
    if (Object.keys(patch).length === 0) return
    await patchApplication(app.id, patch)
    await refresh()
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = apps.findIndex((a) => a.id === active.id)
    const newIndex = apps.findIndex((a) => a.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(apps, oldIndex, newIndex)
    const repositioned = reordered.map((a, i) => ({ ...a, position: i + 1 }))
    setApps(repositioned)
    await reorderApplications(
      repositioned.map((a) => ({ id: a.id, position: a.position })),
    )
    await refresh()
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-700 mb-3">Jobs</h1>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-sm text-slate-500 tabular-nums">
            {done}/{total}
          </span>
        </div>
      </header>

      <form onSubmit={handleAdd} className="mb-4 relative">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add application..."
          className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-sky-500 shadow-sm"
        />
        {suggestions.length > 0 && !pendingConfirm && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden z-10">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handlePickSuggestion(s)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
              >
                {s.done && <span className="text-emerald-600 text-xs">✓</span>}
                <span className={s.done ? 'line-through text-slate-400' : 'text-slate-700'}>
                  {s.title}
                </span>
                <span className="ml-auto text-xs text-slate-400">in {s.tab_label}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      {sameTabError && (
        <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
          {sameTabError}
        </div>
      )}

      {pendingConfirm && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm flex items-center gap-3">
          <span className="text-slate-700 flex-1">
            “<strong>{pendingConfirm.title}</strong>” already exists in{' '}
            {pendingConfirm.tab_label}
            {pendingConfirm.done && ' (done)'}. Add here too?
          </span>
          <button
            type="button"
            onClick={handleConfirmAdd}
            className="bg-sky-600 hover:bg-sky-700 text-white text-xs px-3 py-1 rounded"
          >
            Add{pendingConfirm.done ? ' as done' : ''}
          </button>
          <button
            type="button"
            onClick={handleCancelConfirm}
            className="text-slate-500 hover:text-slate-700 text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={apps.map((a) => a.id)}
            strategy={verticalListSortingStrategy}
          >
            {apps.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400 text-sm">
                No applications yet.
              </div>
            ) : (
              apps.map((app) => (
                <SortableRow
                  key={app.id}
                  app={app}
                  editing={editingId === app.id}
                  editingTitle={editingTitle}
                  setEditingTitle={setEditingTitle}
                  editingUrl={editingUrl}
                  setEditingUrl={setEditingUrl}
                  onToggle={() => handleToggle(app)}
                  onStartEdit={() => {
                    setEditingId(app.id)
                    setEditingTitle(app.title)
                    setEditingUrl(app.url)
                  }}
                  onSaveEdit={() => handleSaveEdit(app)}
                  onCancelEdit={() => setEditingId(null)}
                  onDelete={() => handleDelete(app.id)}
                />
              ))
            )}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

type RowProps = {
  app: Application
  editing: boolean
  editingTitle: string
  setEditingTitle: (v: string) => void
  editingUrl: string
  setEditingUrl: (v: string) => void
  onToggle: () => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
}

function SortableRow({
  app,
  editing,
  editingTitle,
  setEditingTitle,
  editingUrl,
  setEditingUrl,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: app.id })

  // Two-step delete: first click arms, second click within 3s confirms.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => {
    if (!confirmingDelete) return
    const t = setTimeout(() => setConfirmingDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmingDelete])
  const handleDeleteClick = () => {
    if (confirmingDelete) {
      onDelete()
    } else {
      setConfirmingDelete(true)
    }
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing select-none"
        aria-label="Drag"
        type="button"
      >
        ⋮⋮
      </button>
      <input
        type="checkbox"
        checked={app.done}
        onChange={onToggle}
        className="w-4 h-4 accent-sky-600 cursor-pointer"
      />
      {editing ? (
        <div
          className="flex-1 flex flex-col gap-1"
          onBlur={(e) => {
            // Save only when focus leaves the edit container entirely —
            // moving focus between the title and url inputs shouldn't commit.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              onSaveEdit()
            }
          }}
        >
          <input
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            autoFocus
            placeholder="Title"
            className="bg-white border border-sky-500 rounded px-2 py-0.5 text-sm focus:outline-none"
          />
          <input
            type="text"
            value={editingUrl}
            onChange={(e) => setEditingUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            placeholder="https://… (optional)"
            className="bg-white border border-slate-200 rounded px-2 py-0.5 text-xs text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      ) : (
        <span
          onClick={onStartEdit}
          className={`flex-1 text-sm cursor-text flex items-center gap-2 ${
            app.done ? 'text-slate-400 line-through' : 'text-slate-700'
          }`}
        >
          <span>{app.title}</span>
          {app.url && (
            <a
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sky-600 hover:text-sky-700 text-xs no-underline"
              aria-label="Open link"
            >
              ↗
            </a>
          )}
        </span>
      )}
      <button
        onClick={handleDeleteClick}
        className={
          confirmingDelete
            ? 'bg-rose-500 hover:bg-rose-600 text-white text-xs px-2 py-0.5 rounded transition-colors'
            : 'text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm'
        }
        aria-label={confirmingDelete ? 'Click again to confirm delete' : 'Delete'}
        type="button"
      >
        {confirmingDelete ? 'Delete?' : '✕'}
      </button>
    </div>
  )
}
