# Heating Control Card: notes for working on this repo

HACS dashboard card (Lovelace) for the multi-room heating in
[BarBaar44/thermostat](https://github.com/BarBaar44/thermostat). Owner: BarBaar44 (Bb).

## Files

| File | Purpose |
|---|---|
| `heating-control-card.js` | The whole card: plain custom elements, no build step, no dependencies. Card plus visual editor (`ha-form`). |
| `hacs.json` | HACS manifest (`filename`, `render_readme`, minimum HA version). |
| `README.md` | User docs, also the HACS info page. Keep the option table in sync with `DEFAULTS`. |
| `shot.png` | README screenshot, linked by absolute raw URL so it renders in HACS. |
| `examples.png` | README grid of six states (one room and all rooms; hot/cold water, heating, fault), rendered from the real card in headless Chromium with stub `ha-card`/`ha-icon` (`@mdi/js` paths) and a fake `hass`. Regenerate when the look changes. |
| `multi-room.png` | README example with six rooms covering every row role (Heating, Heating along, Pumping, Pumping along, Reached, Off, Paused) and the low pressure warning. Same render setup; regenerate with `examples.png`. |
| `multi-room-card.png` | One six-room card at 372 px card width, rendered 2x, page width 412 px like `shot.png`. Used in the BarBaar44/thermostat README with `<img width="412">` so it shows at the same scale as `shot.png`. |
| `.github/workflows/validate.yml` | `hacs/action`, category `plugin`, ignoring `brands topics` only. Must stay green. |

Repo layout and README style follow [BarBaar44/EV-Trip-Card](https://github.com/BarBaar44/EV-Trip-Card): header comment with repo URL and MIT, `VERSION` constant, `DEFAULTS` block, console banner, README with feature bullets, Install line, option/default table, Licence.

## Backend contract

The card writes to **one thing only**: `climate.virtual_thermostat_*` (`climate.set_temperature`, `climate.set_hvac_mode`). TRVs, the +1 °C buffer and the boiler setpoint are TRV Setpoint Sync's job in the thermostat repo. Never write to the boiler climate, TRVs, the schedule switch or the pause helper.

| Option | Default entity | Used for |
|---|---|---|
| `thermostats` | all `climate.virtual_thermostat_*` | rows; list of entities or `{entity, name, paused, step, on_mode}` |
| `heating_area` | `sensor.delta_temperature` | Tier 1 winner. State is JSON `{"area","target","curr","delta"}`; `area: "Off"` means no winner. A plain area sensor also works. |
| `boiler` | `binary_sensor.main_thermostat_central_heating_active` | CH mode (not the same as burning) |
| `hot_water` | `binary_sensor.main_thermostat_domestic_hot_water_active` | DHW run |
| `flame` | `binary_sensor.diyless_thermostat_flame_on` | burner actually firing |
| `modulation` | `sensor.thermostat_relative_modulation_level` | % shown while firing |
| `ch_enabled` | `switch.main_thermostat_central_heating_enabled` | owned by the Heating Schedule; read only |
| `fault` | `binary_sensor.main_thermostat_fault_indication` | OpenTherm general fault bit |
| `pressure` | `sensor.thermostat_water_pressure_in_ch_circuit` | warnings below `pressure_min` 1.4 / above `pressure_max` 2.7 bar |
| `colors` | map of `COLORS` keys | each key sets one `--hc-*` custom property on the host (inline beats `:host`); unknown keys warn. Keep README color table in sync with `COLORS` |
| `water_flow` | none (optional) | L/min. Shown only when > 0. Text "Hot water at 6.2 L/min" (`--hc-dhw`) during DHW, else "Cold water at 4.0 L/min" (`--hc-water`), "Water at" while offline. With no winner, offline or fault it replaces the status line (class `flowhead`, header tap opens the flow sensor). Otherwise it is `#flowline` under the sub line, with a dripping `mdi:water`. Never a tinted note row. 0/unavailable/unset shows nothing |
| living room `paused` | `input_boolean.garden_heating_paused` | row locked while on (resume snapshot would overwrite changes) |

The winner `area` is matched to a row via the thermostat's area (entity area, else device area, same as Jinja `area_name()`), from `hass.entities`, `hass.devices`, `hass.areas`.

## State logic (header)

Priority, highest first: **offline** → **fault** → winner / no winner text.

- Offline: `boiler` or `flame` entity is `unavailable`/`unknown`. Header "Thermostat offline", grey `mdi:lan-disconnect`; fault and pressure stay quiet; rows keep working.
- Fault: red border, pulsing banner, red header "Boiler fault". OpenTherm sends no display code (e.g. C1 51): **do not add code interpretation**, the banner says to check the boiler display.
- Activity: hot water wins (combi). Then CH + flame = heating (with %), CH without flame = pumping, else idle. No flame entity: CH active counts as heating.
- No winner: "Hot water" during DHW, "Heating off" when no room is in heat or the schedule switch is off, otherwise "All rooms at target".
- Icon: offline > fault > pressure warning > `mdi:fire` (heating) > `mdi:pump` > `mdi:shower-head` (DHW, amber) > `mdi:water-pump` (cold water flowing, light blue, class `coldwater`, taps open the flow sensor) > `mdi:fire-off`.
- Animations: flame flicker (`.burning`), falling water shower (`.dhw`) and a drop falling from the water pump spout (`.coldwater`: the icon's own drop is clipped away and `#drip` falls instead) run only while that icon is shown, never over fault or pressure icons (`:not(.fault):not(.alert)`), and stop under `prefers-reduced-motion`.

Row roles: Heating / Pumping (winner), Heating along / Pumping along (below target while the boiler runs for another room), Calls for heat, Reached, Off, Paused, Unavailable.

## Behaviour to keep

- Setpoint taps are debounced per room: optimistic value at once, one service call 0.8 s after the last tap, pending value dropped when HA confirms or after 5 s.
- Rows are rebuilt only when the room set changes; otherwise updated in place (keeps pending timers).
- 0.2 configs with `climate:` still work as a one-room list. When `thermostats` is set, `climate`/`name`/`paused` are ignored and a console warning is logged.
- Row grid is `3fr / 2fr` for name and room temperature (the same in every row, so temperatures line up). The card is a size container: at 360 px content width or less the thermometer icon hides and gaps shrink. Long role texts end in an ellipsis.
- A one-room `thermostats` list is a supported, intended setup (the owner's own dashboard uses it). With one visible room the card gets class `single`: the row's Heat/Off button is hidden and mirrored as `#hmode` in the header. It is still that room's `set_hvac_mode`, never the `ch_enabled` switch.

## Releasing

1. Only when the owner says to release: bump `VERSION` in `heating-control-card.js`, commit, push to `main`, check the Validate run is green.
2. The owner creates the GitHub release and its `vX.Y.Z` tag on `main` (Claude sessions here cannot create releases or push tags). Supply release notes in Markdown with Changed / Added sections.
3. Changes the owner marks as "no release yet" go to `main` without a version bump.

## Testing

No test suite. Before pushing: `node --check heating-control-card.js`, then load the file in jsdom with a fake `hass` (`states`, `entities`, `devices`, `areas`, `callService`) and check header text, icon, card classes and row roles for: heating, pumping, hot water, hot water + CH, idle, offline, fault, low/high pressure, garden pause, schedule off, explicit list, legacy `climate`, and that taps send one batched call.

## Not possible

HACS shows its own icon for dashboard repos; custom icons only exist for integrations (brands). The README screenshot is the visual instead.
