import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { tabs } from './tabs/registry'

export default function App() {
  return (
    <div className="flex min-h-screen bg-stone-50 text-slate-700">
      <aside className="w-[220px] bg-white border-r border-slate-200 flex flex-col">
        <div className="px-6 py-5 text-lg font-semibold text-slate-700">LBS</div>
        <nav className="flex-1 px-3">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm mb-1 ${
                  isActive
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-600 hover:bg-slate-50'
                }`
              }
            >
              <span className="text-base">{tab.icon}</span>
              <span>{tab.name}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to={tabs[0].path} replace />} />
          {tabs.map((tab) => (
            <Route key={tab.path} path={tab.path} element={<tab.Component />} />
          ))}
        </Routes>
      </main>
    </div>
  )
}
