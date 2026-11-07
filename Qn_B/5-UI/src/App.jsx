import { useEffect, useState } from 'react'
import ForecastPage from './pages/ForecastPage.jsx'
import AfterHoursPage from './pages/AfterHoursPage.jsx'

// Add a page here to give it a tab. Hash routing keeps it working as a static site.
const PAGES = [
  { id: 'qn-a', label: 'After-hours energy', sub: 'Question A', Component: AfterHoursPage },
  { id: 'qn-b', label: 'AC demand forecast', sub: 'Question B', Component: ForecastPage },
]

const fromHash = () => PAGES.find((p) => `#/${p.id}` === window.location.hash)?.id ?? 'qn-b'

export default function App() {
  const [page, setPage] = useState(fromHash)

  useEffect(() => {
    const onHash = () => setPage(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const { Component } = PAGES.find((p) => p.id === page)

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <b>Smarter Buildings, Lower Loads</b>
          <span>Facilities Manager view · CU-BEMS, Floors 2–7 · IS4001 G6</span>
        </div>
        <nav className="tabs">
          {PAGES.map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={`tab ${p.id === page ? 'active' : ''}`}
               style={{ textDecoration: 'none' }} title={p.sub}>
              {p.label}
            </a>
          ))}
        </nav>
      </header>
      <Component />
    </>
  )
}
