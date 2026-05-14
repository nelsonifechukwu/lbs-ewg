import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router-dom'
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
import LandingPage from './LandingPage'
import { tabs } from './tabs/registry'

// Render either a Tabler icon class (e.g. "ti-bulb") as an <i>, or any other
// string (an emoji like "📚") as plain text. Lets registry entries use either
// convention without coupling the chrome to one icon system.
function renderIcon(icon: string) {
  if (icon.startsWith('ti-')) return <i className={`ti ${icon}`} aria-hidden />
  return <>{icon}</>
}

// localStorage-backed personal preference. Survives reload, doesn't sync
// across machines — tab order is opinion, not project data.
const TAB_ORDER_KEY = 'lbs-tab-order'

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(TAB_ORDER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) {
        return parsed
      }
    }
  } catch {
    /* corrupted localStorage entry — fall through to default */
  }
  return tabs.map((t) => t.path)
}

// Drop saved paths that no longer correspond to a registered tab (renamed /
// deleted), append any new tabs that the saved order doesn't yet know about.
function reconcileOrder(saved: string[]): string[] {
  const valid = saved.filter((p) => tabs.some((t) => t.path === p))
  const known = new Set(valid)
  for (const t of tabs) {
    if (!known.has(t.path)) valid.push(t.path)
  }
  return valid
}

type TabItem = (typeof tabs)[number]

function SortableTabLink({ tab }: { tab: TabItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.path })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <NavLink
        to={tab.path}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2 rounded-md text-sm mb-1 cursor-grab active:cursor-grabbing select-none ${
            isActive
              ? 'bg-sky-50 text-sky-700'
              : 'text-slate-600 hover:bg-slate-50'
          }`
        }
      >
        <span className="text-base">{renderIcon(tab.icon)}</span>
        <span>{tab.name}</span>
      </NavLink>
    </div>
  )
}

export default function App() {
  const [order, setOrder] = useState<string[]>(() => reconcileOrder(loadOrder()))

  useEffect(() => {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order))
  }, [order])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = order.indexOf(active.id as string)
    const newIdx = order.indexOf(over.id as string)
    if (oldIdx < 0 || newIdx < 0) return
    setOrder(arrayMove(order, oldIdx, newIdx))
  }

  const orderedTabs = order
    .map((p) => tabs.find((t) => t.path === p))
    .filter((t): t is TabItem => !!t)

  return (
    <div className="flex min-h-screen bg-stone-50 text-slate-700">
      <aside className="w-[220px] bg-white border-r border-slate-200 flex flex-col">
        <Link
          to="/"
          className="px-6 py-5 text-lg font-semibold text-slate-700 hover:text-sky-700"
        >
          LBS
        </Link>
        <nav className="flex-1 px-3">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {orderedTabs.map((tab) => (
                <SortableTabLink key={tab.path} tab={tab} />
              ))}
            </SortableContext>
          </DndContext>
        </nav>
      </aside>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          {tabs.map((tab) => (
            <Route key={tab.path} path={tab.path} element={<tab.Component />} />
          ))}
        </Routes>
      </main>
    </div>
  )
}
