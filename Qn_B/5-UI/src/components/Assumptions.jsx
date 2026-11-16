// Assumptions footer: what the numbers on this page are, and are not.
export default function Assumptions({ meta }) {
  return (
    <section className="panel assumptions">
      <div className="panel-head"><h2>Assumptions</h2></div>
      <ul>
        <li><b>Model:</b> LightGBM, feature set M4, trained on 2019. Tested on {meta.period.start} to {meta.period.end}.</li>
        <li><b>Weather:</b> observed values stand in for a forecast.</li>
        <li><b>Scope:</b> 23 zones, Floors 2–7. Missing readings are gaps, not zero.</li>
        <li><b>Operating hours:</b> {meta.rules.operating_hours}.</li>
        <li><b>No occupancy data:</b> alerts are leads to check, not confirmed faults.</li>
      </ul>
    </section>
  )
}
