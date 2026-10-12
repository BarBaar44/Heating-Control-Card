# Heating Control Card

One Lovelace card for every virtual thermostat in the house and the boiler behind them, built for the multi-room heating in [BarBaar44/thermostat](https://github.com/BarBaar44/thermostat).

* **Header:** the room the boiler is heating for right now, the Tier 1 winner from `sensor.delta_temperature`, with its current and target temperature and what the boiler does ("Office · 18.0° → 20.0° · boiler heating · 45%"). With no winner it says "Heating off" when no room is set to heat or the schedule has central heating off, "All rooms at target" when rooms are in heat but none needs more, or "Hot water" while the boiler runs for the tap.
* **Boiler activity:** CH active alone does not mean the burner fires, so the flame sensor decides:

  | CH active | Hot water | Flame | Shown |
  |---|---|---|---|
  | on | off | on | boiler heating, with the modulation level |
  | on | off | off | boiler pumping (water circulates, burner off) |
  | any | on | any | boiler on for hot water |
  | off | off | off | boiler idle |

  The flame flickers only while the burner fires for heating. Without a flame entity, CH active counts as heating.
* **Thermostat offline:** when the CH active or flame entity is unavailable or unknown (the ESPHome thermostat reboots or loses its connection), the header says "Thermostat offline" with a grey icon instead of guessing. The rows keep working; the virtual thermostats live in HA itself.
* **Boiler fault:** when `binary_sensor.main_thermostat_fault_indication` is on, the card gets a red border, a pulsing red "Boiler fault" banner on top and a red header. Tap the banner for the fault sensor. OpenTherm only sends one general fault bit, not the code on the boiler display (such as C1 51), so the card tells you to check the display and does not interpret anything.
* **Rooms:** one row per `climate.virtual_thermostat_*` with room temperature, target with − and +, and Heat/Off. Each row shows its role in the two-tier model: **Heating** (the winner, highlighted), **Pumping** (the winner while the burner is off), **Heating along** or **Pumping along** (below target while the boiler runs for another room), **Calls for heat**, **Reached**, **Off** or **Paused**.
* **Batched taps:** the new target shows at once and one `climate.set_temperature` goes out 0.8 s after the last tap, so TRV Setpoint Sync runs once per adjustment.
* **Garden doors:** while `input_boolean.garden_heating_paused` is on, the living room row says "Paused · garden doors open" and is locked. The pause and resume scripts own that thermostat then; a change made here would be overwritten by the resume snapshot.
* **Schedule:** when a room is in heat but the schedule has `switch.main_thermostat_central_heating_enabled` off, a note says central heating is off by schedule. The card never touches that switch.
* **Pressure:** a red warning line appears when CH pressure drops below `pressure_min` or rises above `pressure_max`. The safety valve opens at 3 bar.

Tap a room name for its thermostat, the header for the winning room, the flame for the boiler.

## How it fits the backend

The card writes only to the `climate.virtual_thermostat_*` entities, the single source of truth. Everything downstream (TRVs, the +1 °C buffer for the winner, the boiler setpoint) is TRV Setpoint Sync's job, exactly as with any other change to a virtual thermostat.

The winner's `area` from `sensor.delta_temperature` is matched to a row by the thermostat's area (its own, else its device's, the same as `area_name()`). A plain area sensor such as `sensor.virtual_heating_area` works too, but then the header has no temperatures.

## Install

HACS > three dots > Custom repositories > add `https://github.com/BarBaar44/Heating-Control-Card`, type **Dashboard**. Install, then reload the browser.

## Use

```yaml
type: custom:heating-control-card
```

That shows every virtual thermostat, sorted by room. To pick and order rooms, or rename one:

```yaml
type: custom:heating-control-card
thermostats:
  - climate.virtual_thermostat_living_room
  - climate.virtual_thermostat_office
  - entity: climate.virtual_thermostat_room_tim
    name: Tim
```

All options are optional:

| Option | Default |
|---|---|
| `title` | `Heating` |
| `thermostats` | every `climate.virtual_thermostat_*`, sorted by room. A list of entities, or objects with `entity`, `name`, `paused`, `step`, `on_mode` |
| `show_off` | `true`. With `false`, rooms that are off are hidden |
| `heating_area` | `sensor.delta_temperature` |
| `boiler` | `binary_sensor.main_thermostat_central_heating_active` |
| `hot_water` | `binary_sensor.main_thermostat_domestic_hot_water_active` |
| `flame` | `binary_sensor.diyless_thermostat_flame_on` |
| `modulation` | `sensor.thermostat_relative_modulation_level`, shown while the burner fires |
| `ch_enabled` | `switch.main_thermostat_central_heating_enabled` |
| `fault` | `binary_sensor.main_thermostat_fault_indication` |
| `pressure` | `sensor.thermostat_water_pressure_in_ch_circuit` |
| `pressure_min` | `1.4` (bar) |
| `pressure_max` | `2.7` (bar) |
| `step` | each thermostat's `target_temp_step`, else `0.5` |
| `on_mode` | `heat` |

The living room's `paused` defaults to `input_boolean.garden_heating_paused`; other rooms have none. Set any entity option to `null` to switch that part off. The card also has a visual editor in the dashboard UI.

A 0.2 config with `climate:` still works and shows that one room.

**Upgrading from 0.2:** once `thermostats` is set, the old keys `climate`, `name` and `paused` are ignored, and the card logs a warning in the browser console. Remove them and put a room's own `name` or `paused` inside its `thermostats` entry. A config with `thermostats: [living_room]` left over plus those keys shows only that one room; delete `thermostats` to get every room.

## Licence

MIT
