// Which alert rule the page is showing (the Alert rule switch in the replay panel: 'sd' or 'p99').
// The alerts sidebar, the building's Alert / Not an alert yet tags and the recurring badges all read the alert file
// built for that rule (Qn_A/scripts/build_alerts.py writes one per rule), so they always agree with the colours on show.
import { createContext, useContext } from 'react'

export const AlertRuleContext = createContext('p99')
export const useAlertRule = () => useContext(AlertRuleContext)
export const alertFile = (rule) => (rule === 'sd' ? 'qa_alerts_sd.json' : 'qa_alerts.json')
