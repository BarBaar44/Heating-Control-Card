# Heating Control Card

One Lovelace card for a room's virtual thermostat and the boiler behind it, built for the multi-room heating in [BarBaar44/thermostat](https://github.com/BarBaar44/thermostat).

* **Status:** what the boiler is doing, seen from this room: "Boiler on for this room" when the room is the Tier 1 winner, "Boiler on for Office · heating along" when another room drives the boiler and this one rides along, "Boiler on for hot water", "Boiler idle" or "Off". The flame flickers only while central heating fires.
* **Temperatures:** current room temperature on the left, target on the right with − and +. Taps are batched: the new target shows at once and one `climate.set_temperature` goes out 0.8 s after the last tap, so TRV Setpoint Sync runs once instead of once per tap.
* **Heat/Off:** the round button top right.
* **Garden doors (living room):** while `input_boolean.garden_heating_paused` is on, the card shows "Paused · garden doors open" and locks the controls. The pause and resume scripts own the thermostat then; a change made here would be overwritten by the resume snapshot.
* **Schedule:** a room in heat while the schedule has `switch.main_thermostat_central_heating_enabled` off gets a note that central heating is off by schedule. The card never touches that switch.
* **Pressure:** a red warning line appears only when CH pressure drops below the threshold.

Tap the name for the thermostat, the flame for the boiler, a note or warning for its entity.

## How it fits the backend

The card writes to one entity only: the room's `climate.virtual_thermostat_*`, the single source of truth. Everything downstream (TRVs, the +1 °C buffer for the winner, the boiler setpoint) is TRV Setpoint Sync's job, exactly as with any other change to the virtual thermostat.

The winning room comes from `sensor.delta_temperature` (its JSON `area`), compared with the area of the card's thermostat (its own area, else its device's, the same as `area_name()`). A plain area sensor such as `sensor.virtual_heating_area` works too.

## Install

HACS > three dots > Custom repositories > add `https://github.com/BarBaar44/Heating-Control-Card`, type **Dashboard**. Install, then reload the browser.

## Use

```yaml
type: custom:heating-control-card
```

Another room:

```yaml
type: custom:heating-control-card
climate: climate.virtual_thermostat_office
name: Office
```

All options are optional:

| Option | Default |
|---|---|
| `name` | the thermostat's friendly name |
| `climate` | `climate.virtual_thermostat_living_room` |
| `heating_area` | `sensor.delta_temperature` |
| `boiler` | `binary_sensor.main_thermostat_central_heating_active`. Without it the card reads the thermostat's `hvac_action` |
| `hot_water` | `binary_sensor.main_thermostat_domestic_hot_water_active` |
| `ch_enabled` | `switch.main_thermostat_central_heating_enabled` |
| `paused` | `input_boolean.garden_heating_paused` for the living room, none for other rooms |
| `pressure` | `sensor.thermostat_water_pressure_in_ch_circuit` |
| `pressure_min` | `1.4` (bar) |
| `step` | the thermostat's `target_temp_step`, else `0.5` |
| `on_mode` | `heat` |

Set any entity option to `null` to switch that part off. The card also has a visual editor in the dashboard UI.

## Licence

MIT
