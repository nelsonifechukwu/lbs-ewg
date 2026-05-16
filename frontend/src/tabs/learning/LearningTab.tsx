import { FormEvent, useEffect, useMemo, useState } from 'react'
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

const TAB_ID = 'learning'

// ─────────────────────── types ───────────────────────

type LearningItem = {
  id: number
  title: string
  url: string
  category: string
  notes: string
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

// ─────────────────────── category meta (single source of truth) ───────────────────────
// Curated label + icon + Tailwind colour per well-known category. Categories
// are stored lowercase server-side; this map keys on the same. Unknown
// categories still work — they fall back to a neutral slate pill.
//
// Adding a future well-known category is one line here.

const CATEGORY_META: Record<
  string,
  { label: string; icon: string; pill: string }
> = {
  software:  { label: 'Software',  icon: 'ti-code',           pill: 'bg-sky-100 text-sky-700' },
  ai:        { label: 'AI',        icon: 'ti-brain',          pill: 'bg-violet-100 text-violet-700' },
  hardware:  { label: 'Hardware',  icon: 'ti-cpu',            pill: 'bg-amber-100 text-amber-700' },
  reads:     { label: 'Reads',     icon: 'ti-book-2',         pill: 'bg-teal-100 text-teal-700' },
  weekly:    { label: 'Weekly',    icon: 'ti-calendar-week',  pill: 'bg-indigo-100 text-indigo-700' },
  spiritual: { label: 'Spiritual', icon: 'ti-flame',          pill: 'bg-rose-100 text-rose-700' },
  economics: { label: 'Economics', icon: 'ti-chart-line',     pill: 'bg-emerald-100 text-emerald-700' },
  maths:     { label: 'Maths',     icon: 'ti-math-symbols',   pill: 'bg-fuchsia-100 text-fuchsia-700' },
  nigeria:   { label: 'Nigeria',   icon: 'ti-flag-3',         pill: 'bg-green-100 text-green-700' },
  finance:   { label: 'Finance',   icon: 'ti-coin',           pill: 'bg-yellow-100 text-yellow-700' },
  speak:     { label: 'Speak',     icon: 'ti-microphone-2',   pill: 'bg-pink-100 text-pink-700' },
  chill:     { label: 'Chill',     icon: 'ti-coffee',         pill: 'bg-orange-100 text-orange-700' },
}

const UNKNOWN_CATEGORY_PILL = 'bg-slate-100 text-slate-600'
const UNKNOWN_CATEGORY_ICON = 'ti-tag'

function categoryMeta(c: string): { label: string; icon: string; pill: string } {
  return (
    CATEGORY_META[c] ?? {
      label: c || 'uncategorised',
      icon: UNKNOWN_CATEGORY_ICON,
      pill: UNKNOWN_CATEGORY_PILL,
    }
  )
}

const ALL_FILTER = '__all__'

// ─────────────────────── fetch helpers ───────────────────────

async function fetchItems(): Promise<LearningItem[]> {
  const r = await fetch('/api/learning/items')
  if (!r.ok) throw new Error('Failed to fetch items')
  return r.json()
}

async function createItem(
  title: string,
  category: string,
  done = false,
): Promise<LearningItem> {
  const r = await fetch('/api/learning/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, category, done }),
  })
  if (!r.ok) throw new Error(`Failed to create item (${r.status})`)
  return r.json()
}

async function patchItem(
  id: number,
  patch: Partial<Pick<LearningItem, 'title' | 'url' | 'category' | 'done' | 'notes'>>,
): Promise<LearningItem> {
  const r = await fetch(`/api/learning/items/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!r.ok) throw new Error(`Failed to update item (${r.status})`)
  return r.json()
}

async function deleteItem(id: number): Promise<void> {
  const r = await fetch(`/api/learning/items/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error('Failed to delete item')
}

async function reorderItems(
  items: { id: number; position: number }[],
): Promise<void> {
  const r = await fetch('/api/learning/items/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!r.ok) throw new Error('Failed to reorder')
}

async function searchTasks(q: string): Promise<SearchResult[]> {
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
  if (!r.ok) throw new Error('Failed to search')
  return r.json()
}

// ─────────────────────── component ───────────────────────

export default function LearningTab() {
  const [items, setItems] = useState<LearningItem[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [newCategory, setNewCategory] = useState('software')
  const [filter, setFilter] = useState<string>(ALL_FILTER)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingUrl, setEditingUrl] = useState('')
  const [editingCategory, setEditingCategory] = useState('')
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [pendingConfirm, setPendingConfirm] = useState<SearchResult | null>(null)
  const [sameCategoryError, setSameCategoryError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  async function refresh() {
    setItems(await fetchItems())
  }

  useEffect(() => {
    refresh().catch(console.error)
  }, [])

  // Distinct categories actually present in the data, in insertion order.
  // Drives the filter chip strip — adding a new category requires no code
  // change.
  const categories = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const it of items) {
      if (!seen.has(it.category)) {
        seen.add(it.category)
        out.push(it.category)
      }
    }
    return out
  }, [items])

  const visibleItems = useMemo(() => {
    if (filter === ALL_FILTER) return items
    return items.filter((it) => it.category === filter)
  }, [items, filter])

  const done = visibleItems.filter((it) => it.done).length
  const total = visibleItems.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  // Debounced cross-tab title search (same pattern as jobs/dissertation).
  // Same-tab hits filtered out client-side; suggestions only surface items
  // from OTHER tabs.
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

  useEffect(() => {
    if (sameCategoryError) setSameCategoryError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTitle, newCategory])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    const category = newCategory.trim().toLowerCase()
    if (!title || !category) return
    // Hard block: same (category, title) already in this tab. Catch it
    // client-side; backend enforces the same constraint authoritatively.
    const lower = title.toLowerCase()
    const dup = items.find(
      (it) => it.category === category && it.title.trim().toLowerCase() === lower,
    )
    if (dup) {
      setSameCategoryError(
        `"${dup.title}" is already in "${categoryMeta(category).label}".`,
      )
      return
    }
    // Soft prompt: same title in a different tab → offer to add here too.
    const results = await searchTasks(title)
    const otherTab = results.find(
      (r) => r.tab !== TAB_ID && r.title.trim().toLowerCase() === lower,
    )
    if (otherTab) {
      setPendingConfirm(otherTab)
      return
    }
    setNewTitle('')
    setSuggestions([])
    await createItem(title, category)
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
    const category = newCategory.trim().toLowerCase()
    setPendingConfirm(null)
    setNewTitle('')
    setSuggestions([])
    await createItem(title, category, done)
    await refresh()
  }

  function handleCancelConfirm() {
    setPendingConfirm(null)
  }

  async function handleToggle(item: LearningItem) {
    await patchItem(item.id, { done: !item.done })
    await refresh()
  }

  async function handleDelete(id: number) {
    await deleteItem(id)
    await refresh()
  }

  async function handleSaveEdit(item: LearningItem) {
    const title = editingTitle.trim()
    const url = editingUrl.trim()
    const category = editingCategory.trim().toLowerCase()
    if (!title) {
      setEditingId(null)
      return
    }
    setEditingId(null)
    const patch: Partial<Pick<LearningItem, 'title' | 'url' | 'category'>> = {}
    if (title !== item.title) patch.title = title
    if (url !== item.url) patch.url = url
    if (category && category !== item.category) patch.category = category
    if (Object.keys(patch).length === 0) return
    await patchItem(item.id, patch)
    await refresh()
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    // Drag only reorders within the currently-visible set. Map indices back
    // to the full list so positions stay sensible globally.
    const oldIndex = items.findIndex((it) => it.id === active.id)
    const newIndex = items.findIndex((it) => it.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(items, oldIndex, newIndex)
    const repositioned = reordered.map((it, i) => ({ ...it, position: i + 1 }))
    setItems(repositioned)
    await reorderItems(repositioned.map((it) => ({ id: it.id, position: it.position })))
    await refresh()
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-700 mb-3">Learning</h1>
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

      {/* Filter chip strip — derived from categories present in the data.
          'All' resets to the full list. */}
      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <FilterChip
            label="All"
            active={filter === ALL_FILTER}
            count={items.length}
            pill="bg-slate-100 text-slate-700"
            onClick={() => setFilter(ALL_FILTER)}
          />
          {categories.map((c) => {
            const meta = categoryMeta(c)
            const count = items.filter((it) => it.category === c).length
            return (
              <FilterChip
                key={c}
                label={meta.label}
                icon={meta.icon}
                active={filter === c}
                count={count}
                pill={meta.pill}
                onClick={() => setFilter(c)}
              />
            )
          })}
        </div>
      )}

      <form onSubmit={handleAdd} className="mb-4 relative flex gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add to learning pile..."
          className="flex-1 bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-sky-500 shadow-sm"
        />
        <input
          type="text"
          list="learning-categories"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder="category"
          className="w-32 bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-sky-500 shadow-sm"
        />
        <datalist id="learning-categories">
          {Object.keys(CATEGORY_META).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
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

      {sameCategoryError && (
        <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
          {sameCategoryError}
        </div>
      )}

      {pendingConfirm && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm flex items-center gap-3">
          <span className="text-slate-700 flex-1">
            “<strong>{pendingConfirm.title}</strong>” already exists in{' '}
            {pendingConfirm.tab_label}
            {pendingConfirm.done && ' (done)'}. Add to{' '}
            {categoryMeta(newCategory).label} here too?
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
            items={visibleItems.map((it) => it.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleItems.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400 text-sm">
                {items.length === 0
                  ? 'Nothing in the pile yet.'
                  : 'Nothing here in this category.'}
              </div>
            ) : (
              visibleItems.map((item) => (
                <SortableRow
                  key={item.id}
                  item={item}
                  editing={editingId === item.id}
                  editingTitle={editingTitle}
                  setEditingTitle={setEditingTitle}
                  editingUrl={editingUrl}
                  setEditingUrl={setEditingUrl}
                  editingCategory={editingCategory}
                  setEditingCategory={setEditingCategory}
                  onToggle={() => handleToggle(item)}
                  onStartEdit={() => {
                    setEditingId(item.id)
                    setEditingTitle(item.title)
                    setEditingUrl(item.url)
                    setEditingCategory(item.category)
                  }}
                  onSaveEdit={() => handleSaveEdit(item)}
                  onCancelEdit={() => setEditingId(null)}
                  onDelete={() => handleDelete(item.id)}
                />
              ))
            )}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

// ─────────────────────── filter chip ───────────────────────

type FilterChipProps = {
  label: string
  icon?: string
  active: boolean
  count: number
  pill: string
  onClick: () => void
}

function FilterChip({ label, icon, active, count, pill, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? `${pill} ring-2 ring-offset-1 ring-sky-500 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5`
          : `${pill} hover:ring-1 hover:ring-slate-300 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5`
      }
    >
      {icon && <i className={`ti ${icon} text-sm`} aria-hidden />}
      <span>{label}</span>
      <span className="opacity-60 tabular-nums">{count}</span>
    </button>
  )
}

// ─────────────────────── row ───────────────────────

type RowProps = {
  item: LearningItem
  editing: boolean
  editingTitle: string
  setEditingTitle: (v: string) => void
  editingUrl: string
  setEditingUrl: (v: string) => void
  editingCategory: string
  setEditingCategory: (v: string) => void
  onToggle: () => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
}

function SortableRow({
  item,
  editing,
  editingTitle,
  setEditingTitle,
  editingUrl,
  setEditingUrl,
  editingCategory,
  setEditingCategory,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  // Two-step delete: first click arms, second click within 3s confirms.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => {
    if (!confirmingDelete) return
    const t = setTimeout(() => setConfirmingDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmingDelete])
  const handleDeleteClick = () => {
    if (confirmingDelete) onDelete()
    else setConfirmingDelete(true)
  }

  const meta = categoryMeta(item.category)

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
        checked={item.done}
        onChange={onToggle}
        className="w-4 h-4 accent-emerald-600 cursor-pointer"
      />
      {editing ? (
        <div
          className="flex-1 flex flex-col gap-1"
          onBlur={(e) => {
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
          <input
            type="text"
            list="learning-categories"
            value={editingCategory}
            onChange={(e) => setEditingCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            placeholder="category"
            className="bg-white border border-slate-200 rounded px-2 py-0.5 text-xs text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      ) : (
        <span
          onClick={onStartEdit}
          className={`flex-1 text-sm cursor-text flex items-center gap-2 ${
            item.done ? 'text-slate-400 line-through' : 'text-slate-700'
          }`}
        >
          <span
            className={`${meta.pill} text-[10px] font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 flex-shrink-0`}
          >
            <i className={`ti ${meta.icon}`} aria-hidden />
            {meta.label}
          </span>
          <span>{item.title}</span>
          {item.url && (
            <a
              href={item.url}
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
