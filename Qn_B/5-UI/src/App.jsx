import { useEffect, useState } from 'react'
import ForecastPage from './pages/ForecastPage.jsx'
// Question A's page lives in Qn_A/ui (see vite.config.js for how the build reaches it)
import AfterHoursPage from '../../../Qn_A/ui/AfterHoursPage.jsx'
import LiveForecastPage from './pages/LiveForecastPage.jsx'

// Add a page here to give it a tab. Hash routing keeps it working as a static site.
const PAGES = [
  { id: 'qn-a', label: 'After-hours energy', sub: 'Question A', Component: AfterHoursPage },
  { id: 'qn-b-live', label: 'AC forecast · upcoming', sub: 'Question B: today and the next 7 days', Component: LiveForecastPage },
  { id: 'qn-b', label: 'AC forecast · test period', sub: 'Question B: model vs actual, Jul–Sep 2018', Component: ForecastPage },
]

// A tab's hash may carry a query (e.g. #/qn-a?t=2018-08-07T06:00), which the page reads itself
const fromHash = () => PAGES.find((p) => `#/${p.id}` === window.location.hash.split('?')[0])?.id ?? 'qn-b'

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
