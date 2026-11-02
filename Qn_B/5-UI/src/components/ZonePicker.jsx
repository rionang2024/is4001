// Floor buttons, then the zones on that floor.
export default function ZonePicker({ zones, value, onChange }) {
  const floors = [...new Set(zones.map((z) => z.floor))]
  const current = zones.find((z) => z.id === value)
  const onFloor = zones.filter((z) => z.floor === current.floor)

  const pickFloor = (f) => {
    const sameZone = zones.find((z) => z.floor === f && z.zone === current.zone)
    onChange((sameZone ?? zones.find((z) => z.floor === f)).id)
  }

  return (
    <>
      <div className="field">
        <label>Floor</label>
        <div className="seg">
          {floors.map((f) => (
            <button key={f} className={f === current.floor ? 'on' : ''} onClick={() => pickFloor(f)}>{f}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Zone</label>
        <div className="seg">
          {onFloor.map((z) => (
            <button key={z.id} className={z.id === value ? 'on' : ''} onClick={() => onChange(z.id)}>Z{z.zone}</button>
          ))}
        </div>
      </div>
    </>
  )
}
