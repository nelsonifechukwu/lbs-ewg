import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tabs } from './tabs/registry'

type TabStats = {
  name: string
  path: string
  icon: string
  done: number
  total: number
}

// Same helper as in App.tsx — small enough that one copy in each chrome file
// beats a shared util module per this project's "duplication > abstraction"
// preference.
function renderIcon(icon: string) {
  if (icon.startsWith('ti-')) return <i className={`ti ${icon}`} aria-hidden />
  return <>{icon}</>
}

export default function LandingPage() {
  const [stats, setStats] = useState<TabStats[] | null>(null)

  // Only tabs with progress semantics contribute to the aggregate. Thinkers
  // has no "done" state, so it sets progress: false in the registry.
  const progressTabs = tabs.filter((t) => t.progress !== false)

  useEffect(() => {
    Promise.all(
      progressTabs.map(async (t) => {
        const r = await fetch(t.listUrl)
        const items = (await r.json()) as Array<{ done: boolean }>
        return {
          name: t.name,
          path: t.path,
          icon: t.icon,
          done: items.filter((i) => i.done).length,
          total: items.length,
        }
      }),
    )
      .then(setStats)
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = (stats ?? []).reduce((s, x) => s + x.total, 0)
  const done = (stats ?? []).reduce((s, x) => s + x.done, 0)
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <h1 className="text-2xl font-semibold text-slate-700 mb-6">Overview</h1>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700">Overall</span>
          <span className="text-sm text-slate-500 tabular-nums">
            {done} / {total}
            {total > 0 && (
              <span className="text-slate-400 ml-2">({pct}%)</span>
            )}
          </span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </section>

      {stats && stats.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          {stats.map((s) => {
            const sPct = s.total === 0 ? 0 : Math.round((s.done / s.total) * 100)
            return (
              <Link
                key={s.path}
                to={s.path}
                className="flex items-center gap-4 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
              >
                <span className="text-lg">{renderIcon(s.icon)}</span>
                <span className="text-sm font-medium text-slate-700 w-32">
                  {s.name}
                </span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all"
                    style={{ width: `${sPct}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500 tabular-nums w-16 text-right">
                  {s.done} / {s.total}
                </span>
              </Link>
            )
          })}
        </section>
      )}
    </div>
  )
}
