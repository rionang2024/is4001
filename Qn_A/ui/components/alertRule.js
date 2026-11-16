// Which alert rule the page is showing: 'sd' (median + 3 SD, the page's rule), or 'p99' only if the API has no sd rule files.
// The alerts sidebar, the building's Alert tags and the recurring badges all read the alert file
// built for that rule (Qn_A/scripts/build_alerts.py writes one per rule), so they always agree with the colours on show.
import { createContext, useContext } from 'react'

export const AlertRuleContext = createContext('sd')
export const useAlertRule = () => useContext(AlertRuleContext)
export const alertFile = (rule) => (rule === 'sd' ? 'qa_alerts_sd.json' : 'qa_alerts.json')
