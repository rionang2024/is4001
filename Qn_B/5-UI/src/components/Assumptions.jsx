// Assumptions footer: what the numbers on this page are, and are not.
export default function Assumptions({ meta }) {
  return (
    <section className="panel assumptions">
      <div className="panel-head"><h2>Assumptions &amp; limitations</h2>
        <span className="sub">Data generated {meta.generated_at.slice(0, 10)}</span></div>
      <ul>
        <li><b>Test period:</b> {meta.period.start} to {meta.period.end} (Jul–Sep 2018, rainy season only). Models were trained on 2019, so this is an out-of-year test.</li>
        <li><b>Weather:</b> observed Open-Meteo values stand in for a day-ahead forecast. Real forecasts carry error, so live accuracy would be lower.</li>
        <li><b>Scope:</b> 23 zones on Floors 2–7. Floor 1 is excluded (no indoor sensors), as are zone 3 (no AC) and the dead meters F2 z2_AC11 and F7 z1_AC1.</li>
        <li><b>Gaps:</b> hours where any AC unit in a zone had no reading are missing, not zero. Floor 6's record ends 22 Oct 2019.</li>
        <li><b>Floor 5 zone 1:</b> its temperature sensor reads AC supply air, not room air.</li>
        <li><b>Operating hours:</b> {meta.rules.operating_hours}. Thai public holidays are treated as non-working days.</li>
        <li><b>No occupancy data:</b> deviations and after-hours running are leads to inspect, not confirmed faults or waste.</li>
        {meta.pending_models.length > 0 && <li><b>Pending:</b> {meta.pending_models.join(', ')} results are not in yet. They appear here once exported.</li>}
      </ul>
    </section>
  )
}
