import { fmt, modelName, ASHRAE } from '../data.js'

// Operating-hours accuracy for the selected zone, always shown next to the comparison.
export default function KpiTiles({ zoneMetrics, model, compare }) {
  const m = zoneMetrics?.operating?.[model]
  const c = zoneMetrics?.operating?.[compare]
  if (!m || !c) return null

  const skill = c.MAE ? (1 - m.MAE / c.MAE) * 100 : null
  const cvOk = m.CVRMSE <= ASHRAE.cvrmse
  const nmbeOk = Math.abs(m.NMBE) <= ASHRAE.nmbe

  return (
    <section className="kpis">
      <div className="kpi">
        <div className="label">WAPE · operating hours</div>
        <div className="value">{fmt(m.WAPE)}<small>%</small></div>
        <div className="foot">vs {fmt(c.WAPE)}% for {modelName(compare)}</div>
      </div>
      <div className="kpi">
        <div className="label">Skill vs {modelName(compare).split(' · ')[0]}</div>
        <div className="value">{skill == null ? '–' : `${skill > 0 ? '+' : ''}${fmt(skill, 0)}`}<small>%</small></div>
        <div className="foot">
          {skill > 0
            ? <span className="chip good">beats comparison</span>
            : <span className="chip bad">does not beat comparison</span>} <span className="muted">1 − MAE ratio</span>
        </div>
      </div>
      <div className="kpi">
        <div className="label">CV(RMSE)</div>
        <div className="value">{fmt(m.CVRMSE)}<small>%</small></div>
        <div className="foot">
          <span className={`chip ${cvOk ? 'good' : 'bad'}`}>{cvOk ? 'within' : 'over'} ASHRAE ≤ 30%</span>
        </div>
      </div>
      <div className="kpi">
        <div className="label">NMBE (bias)</div>
        <div className="value">{m.NMBE > 0 ? '+' : ''}{fmt(m.NMBE)}<small>%</small></div>
        <div className="foot">
          <span className={`chip ${nmbeOk ? 'good' : 'bad'}`}>{nmbeOk ? 'within' : 'outside'} ±10%</span>{' '}
          <span className="muted">{m.NMBE > 0 ? 'under-forecasts' : 'over-forecasts'}</span>
        </div>
      </div>
    </section>
  )
}
