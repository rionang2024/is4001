import { LOADS, LOAD_NAME } from '../qnaApi.js'

const ART = {
  AC: (
    <svg viewBox="0 0 64 64">
      <rect className="ac-body" x="5" y="10" width="54" height="26" rx="6" />
      <rect x="11" y="16" width="26" height="3" rx="1.5" fill="#c3c9d4" />
      <circle className="ac-led" cx="50" cy="19" r="2.6" />
      <rect className="ac-louver" x="10" y="36" width="44" height="4.5" rx="2" />
      <path className="ac-air" d="M16 47c5-4 9 4 14 0s9 4 14 0" />
      <path className="ac-air" style={{ animationDelay: '-0.45s' }} d="M20 55c5-4 9 4 14 0s9 4 14 0" />
    </svg>
  ),
  Lighting: (
    <svg viewBox="0 0 64 64">
      <defs>
        <radialGradient id="qa-bulb-glow">
          <stop offset="0" stopColor="#ffe27a" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffe27a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="bulb-glow" cx="32" cy="26" r="30" fill="url(#qa-bulb-glow)" />
      <g className="bulb-rays" strokeWidth="2.5" strokeLinecap="round">
        <line x1="32" y1="1" x2="32" y2="6" /><line x1="9" y1="9" x2="13" y2="13" /><line x1="55" y1="9" x2="51" y2="13" />
        <line x1="3" y1="26" x2="8" y2="26" /><line x1="61" y1="26" x2="56" y2="26" />
      </g>
      <path className="bulb-glass" d="M32 10c-8.8 0-15 6.4-15 14.4 0 5.2 2.6 8.4 5.4 11.2 1.6 1.6 2.6 3.4 2.6 5.4V43h14v-2c0-2 1-3.8 2.6-5.4 2.8-2.8 5.4-6 5.4-11.2C47 16.4 40.8 10 32 10z" />
      <path className="bulb-fil" d="M28 36l4-8 4 8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="26" y="45" width="12" height="4" rx="1.5" fill="#8d939e" />
      <rect x="28" y="50.5" width="8" height="4" rx="1.5" fill="#6f7683" />
    </svg>
  ),
  Plug: (
    <svg viewBox="0 0 64 64">
      <g className="plug">
        <path d="M6 32H-2" stroke="#8d939e" strokeWidth="3.5" strokeLinecap="round" />
        <rect className="plug-metal" x="28" y="25.5" width="15" height="3.4" rx="1.2" />
        <rect className="plug-metal" x="28" y="35" width="15" height="3.4" rx="1.2" />
        <rect className="plug-body" x="6" y="19" width="23" height="26" rx="6" />
        <circle className="plug-led" cx="17" cy="32" r="2.8" />
      </g>
      <rect x="42" y="14" width="19" height="36" rx="5" fill="#d9dee6" stroke="#9aa2b0" strokeWidth="1.5" />
      <g className="plug-spark" stroke="#ffc83a" strokeWidth="2.2" strokeLinecap="round">
        <line x1="40" y1="16" x2="38" y2="11" /><line x1="40" y1="48" x2="38" y2="53" /><line x1="36" y1="31" x2="30" y2="31" />
        <line x1="38" y1="22" x2="33" y2="19" /><line x1="38" y1="40" x2="33" y2="43" />
      </g>
    </svg>
  ),
}

// Three animated switches: each turns one load type on or off on every floor.
export default function LoadSwitches({ on, onToggle, justOn }) {
  return (
    <div className="ex-switches" role="group" aria-label="Load types">
      {LOADS.map((e) => (
        <button key={e} type="button" role="switch" aria-checked={on[e]} data-eu={e}
                className={`sw${justOn === e ? ' just-on' : ''}`} onClick={() => onToggle(e)}>
          <span className="sw-art" aria-hidden="true">{ART[e]}</span>
          <span className="sw-text"><b>{LOAD_NAME[e]}</b><small className="sw-state">{on[e] ? 'On' : 'Off'}</small></span>
          <span className="sw-rocker" aria-hidden="true"><i /></span>
        </button>
      ))}
    </div>
  )
}
