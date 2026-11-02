// Question A lives here. Placeholder until the Qn A team's CSV/JSON and charts land.
export default function AfterHoursPage() {
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>After-hours energy</h1>
          <p>How does after-hours energy use vary across floors and day-types?</p>
        </div>
      </div>
      <div className="placeholder">
        <h2>Question A page: not built yet</h2>
        <p>This tab is reserved for the Qn A team. To add it:</p>
        <ol>
          <li>Export your results (e.g. floor × day-type ratios, zone ratios, alerts) as JSON or CSV
              into <code>public/data/qn_a/</code>.</li>
          <li>Build your charts as components in <code>src/components/qn_a/</code> and lay them out in
              this file (<code>src/pages/AfterHoursPage.jsx</code>).</li>
          <li>Reuse the shared styles: <code>.panel</code>, <code>.kpi</code>, <code>.alert</code>,
              and the table styles in <code>src/styles.css</code>, so both pages look the same.</li>
        </ol>
        <p className="muted small">The Question B tab shows the pattern: a loader in <code>src/data.js</code>,
          one component per panel, and a sidebar for alerts.</p>
      </div>
    </main>
  )
}
