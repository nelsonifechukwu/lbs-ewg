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

type Task = {
  id: number
  title: string
  notes: string
  done: boolean
  position: number
  created_at: string
  updated_at: string
}

async function fetchTasks(): Promise<Task[]> {
  const r = await fetch('/api/dissertation/tasks')
  if (!r.ok) throw new Error('Failed to fetch tasks')
  return r.json()
}

async function createTask(title: string): Promise<Task> {
  const r = await fetch('/api/dissertation/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!r.ok) throw new Error('Failed to create task')
  return r.json()
}

async function patchTask(
  id: number,
  patch: Partial<Pick<Task, 'title' | 'notes' | 'done'>>,
): Promise<Task> {
  const r = await fetch(`/api/dissertation/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!r.ok) throw new Error('Failed to update task')
  return r.json()
}

async function deleteTask(id: number): Promise<void> {
  const r = await fetch(`/api/dissertation/tasks/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error('Failed to delete task')
}

async function reorderTasks(items: { id: number; position: number }[]): Promise<void> {
  const r = await fetch('/api/dissertation/tasks/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  })
  if (!r.ok) throw new Error('Failed to reorder')
}

export default function DissertationTab() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  async function refresh() {
    setTasks(await fetchTasks())
  }

  useEffect(() => {
    refresh().catch(console.error)
  }, [])

  const done = tasks.filter((t) => t.done).length
  const total = tasks.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    setNewTitle('')
    await createTask(title)
    await refresh()
  }

  async function handleToggle(task: Task) {
    await patchTask(task.id, { done: !task.done })
    await refresh()
  }

  async function handleDelete(id: number) {
    await deleteTask(id)
    await refresh()
  }

  async function handleSaveTitle(task: Task) {
    const title = editingTitle.trim()
    setEditingId(null)
    if (!title || title === task.title) return
    await patchTask(task.id, { title })
    await refresh()
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = tasks.findIndex((t) => t.id === active.id)
    const newIndex = tasks.findIndex((t) => t.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(tasks, oldIndex, newIndex)
    const repositioned = reordered.map((t, i) => ({ ...t, position: i + 1 }))
    setTasks(repositioned)
    await reorderTasks(repositioned.map((t) => ({ id: t.id, position: t.position })))
    await refresh()
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-700 mb-3">Dissertation</h1>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-sm text-slate-500 tabular-nums">
            {done}/{total}
          </span>
        </div>
      </header>

      <form onSubmit={handleAdd} className="mb-4">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add task..."
          className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-sky-500 shadow-sm"
        />
      </form>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {tasks.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400 text-sm">
                No tasks yet.
              </div>
            ) : (
              tasks.map((task) => (
                <SortableRow
                  key={task.id}
                  task={task}
                  editing={editingId === task.id}
                  editingTitle={editingTitle}
                  setEditingTitle={setEditingTitle}
                  onToggle={() => handleToggle(task)}
                  onStartEdit={() => {
                    setEditingId(task.id)
                    setEditingTitle(task.title)
                  }}
                  onSaveEdit={() => handleSaveTitle(task)}
                  onCancelEdit={() => setEditingId(null)}
                  onDelete={() => handleDelete(task.id)}
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
  task: Task
  editing: boolean
  editingTitle: string
  setEditingTitle: (v: string) => void
  onToggle: () => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
}

function SortableRow({
  task,
  editing,
  editingTitle,
  setEditingTitle,
  onToggle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })

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
        checked={task.done}
        onChange={onToggle}
        className="w-4 h-4 accent-sky-600 cursor-pointer"
      />
      {editing ? (
        <input
          type="text"
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onBlur={onSaveEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSaveEdit()
            if (e.key === 'Escape') onCancelEdit()
          }}
          autoFocus
          className="flex-1 bg-white border border-sky-500 rounded px-2 py-0.5 text-sm focus:outline-none"
        />
      ) : (
        <span
          onClick={onStartEdit}
          className={`flex-1 text-sm cursor-text ${
            task.done ? 'text-slate-400 line-through' : 'text-slate-700'
          }`}
        >
          {task.title}
        </span>
      )}
      <button
        onClick={onDelete}
        className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm"
        aria-label="Delete"
        type="button"
      >
        ✕
      </button>
    </div>
  )
}
