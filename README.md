# Heating Control Card

![Heating Control Card](https://raw.githubusercontent.com/BarBaar44/Heating-Control-Card/main/shot.png)

One Lovelace card for every room of [Cloudless Multiroom Thermostat](https://github.com/BarBaar44/thermostat) and the boiler behind them.

* **Header:** the room the boiler is heating for right now (the winner), with its current and target temperature and what the boiler does ("Office · 18.0° → 20.0° · boiler heating · 45%"). With no winner it says "Heating off" when no room is set to heat or central heating is switched off, "Heating off · nobody home" when everybody is away, "Heating paused" when every heating room is held off, "Office calls for heat" when a room asks for heat but the boiler has not started for it yet, "All rooms at target" when rooms are in heat but none needs more, or "Hot water" while the boiler runs for the tap. A room that is only waiting (see below) is never counted as demand: with nothing else heating the header says "Heating off" and the line under it "Boiler idle · Hallway waiting".
* **Boiler activity:** CH active alone does not mean the burner fires, so the flame sensor decides:

  | CH active | Hot water | Flame | Shown |
  |---|---|---|---|
  | on | off | on | boiler heating, with the modulation level |
  | on | off | off | boiler pumping (water circulates, burner off) |
  | any | on | any | boiler on for hot water |
  | off | off | off | boiler idle |

  The flame flickers only while the burner fires for heating. During a hot water run the header shows an amber shower head with falling water. Both animations stop when the system asks for reduced motion. Without a flame entity, CH active counts as heating.
* **Thermostat offline:** when the CH active or flame entity is unavailable or unknown (the ESPHome thermostat reboots or loses its connection), the header says "Thermostat offline" with a grey icon instead of guessing. The rows keep working; the room climates live in HA itself.
* **Boiler fault:** when `binary_sensor.main_thermostat_fault_indication` is on, the card gets a red border, a pulsing red "Boiler fault" banner on top and a red header. Tap the banner for the fault sensor. OpenTherm only sends one general fault bit, not the code on the boiler display (such as C1 51), so the card tells you to check the display and does not interpret anything.
* **Rooms:** one row per room with room temperature, target with − and +, and Heat/Off. Each row shows its role in the two-tier model: **Heating** (the winner, highlighted), **Pumping** (the winner while the burner is off), **Heating along** or **Pumping along** (below target while the boiler runs for another room), **Calls for heat**, **Waiting for heat**, **Reached**, **Off** or **Paused**. With the integration the role comes from the room itself (its `role` attribute), so the card and the integration always agree, also with an eco preset.
* **Waiting for heat:** a room with "Drives the heat source" turned off in the integration (thermostat v1.1.0 or later, for example a hallway) never starts the boiler. While it is below target and no other room needs heat it shows **Waiting for heat** in a dimmed grey with an hourglass, calmer than Calls for heat, because nothing is heating it. As soon as another room drives the boiler it heats along like any other room.
* **Batched taps:** the new target shows at once and one `climate.set_temperature` goes out 0.8 s after the last tap, so the TRVs are written once per adjustment.
* **Paused rooms:** a room the integration holds off says why: "Paused · window open", "Paused · nobody home" or "Paused". Its target can still be changed; the room picks it up when the pause ends.
* **Central heating switch:** when a room is in heat but the `ch_enabled` switch is off, a note says central heating is off. The card never touches that switch.
* **Pressure:** a red warning line appears when CH pressure drops below `pressure_min` or rises above `pressure_max`. The safety valve opens at 3 bar.
* **Water flow (optional):** with `water_flow` set to a water meter in L/min, the flow shows while water runs. It reads "Hot water at 6.2 L/min" (amber) during a hot water run, else "Cold water at 4.0 L/min" (light blue) with a light blue water pump as the header icon while the boiler is idle, a drop falling from its spout. With no room being heated it replaces the status line; while a room is being heated, or during a fault, it is a small line with a dripping drop under the room's temperatures. At 0 or unavailable nothing shows. Tap it for the sensor.
* **Colors:** every state color is configurable, see below.

With a single room its Heat/Off button sits in the header, on the line with "All rooms at target", so the setpoint control gets more room.

### Examples

![Heating Control Card examples](https://raw.githubusercontent.com/BarBaar44/Heating-Control-Card/main/examples.png)

With several thermostats every room shows its role, the room the boiler heats for is highlighted. On the right the hallway is below target but does not drive the boiler, so heating stays off:

![Heating Control Card with several rooms](https://raw.githubusercontent.com/BarBaar44/Heating-Control-Card/main/multi-room.png)

Tap a room name for its thermostat, the header for the winning room, the flame for the boiler.

## How it fits the integration

The card writes only to the room climates of [Cloudless Multiroom Thermostat](https://github.com/BarBaar44/thermostat), the single source of truth per room. Everything downstream (TRVs, the overshoot buffer for the winner, the boiler setpoint) is the integration's job, exactly as with any other change to a room.

The rooms tell the card which one is the winner, each room's role and why a room is paused, so no extra sensor is needed. With an integration older than v1.1.0 (no `role` attribute) the card works the roles out itself.

**Without the integration** the card still works with the original YAML setup ([thermostat v1.1.0](https://github.com/BarBaar44/thermostat/tree/v1.1.0); later versions dropped it): it then shows every `climate.virtual_thermostat_*`, takes the winner from `sensor.delta_temperature` (JSON `area`, `target`, `curr`; matched to a row by the thermostat's area), and locks the living room while `input_boolean.garden_heating_paused` is on, because the pause and resume scripts own it then.

## Install

HACS > three dots > Custom repositories > add `https://github.com/BarBaar44/Heating-Control-Card`, type **Dashboard**. Install, then reload the browser.

## Use

```yaml
type: custom:heating-control-card
```

That shows every room, sorted by name. To pick and order rooms, or rename one:

```yaml
type: custom:heating-control-card
thermostats:
  - climate.living_room
  - climate.office
  - entity: climate.room_tim
    name: Tim
```

All options are optional:

| Option | Default |
|---|---|
| `title` | `Heating` |
| `thermostats` | every room of the integration (without it: every `climate.virtual_thermostat_*`), sorted by name. A list of entities, or objects with `entity`, `name`, `paused`, `step`, `on_mode` |
| `show_off` | `true`. With `false`, rooms that are off are hidden |
| `heating_area` | `sensor.delta_temperature`, only used without the integration |
| `boiler` | `binary_sensor.main_thermostat_central_heating_active` |
| `hot_water` | `binary_sensor.main_thermostat_domestic_hot_water_active` |
| `flame` | `binary_sensor.diyless_thermostat_flame_on` |
| `modulation` | `sensor.thermostat_relative_modulation_level`, shown while the burner fires |
| `ch_enabled` | `switch.main_thermostat_central_heating_enabled` |
| `fault` | `binary_sensor.main_thermostat_fault_indication` |
| `pressure` | `sensor.thermostat_water_pressure_in_ch_circuit` |
| `water_flow` | none. A sensor in L/min, e.g. `sensor.watermeterkit_water_meter_kit_current_usage` |
| `pressure_min` | `1.4` (bar) |
| `pressure_max` | `2.7` (bar) |
| `step` | each thermostat's `target_temp_step`, else `0.5` |
| `on_mode` | `heat` |
| `colors` | see below |

A room's `paused` is an entity that locks its row while on; without the integration the living room's defaults to `input_boolean.garden_heating_paused`. The boiler entity defaults are the names of an ESPHome OpenTherm thermostat ([`thermostat.yaml`](https://github.com/BarBaar44/thermostat/blob/main/thermostat.yaml)); point them at your own. Set any entity option to `null` to switch that part off. The card also has a visual editor in the dashboard UI.

### Colors

Each key takes any CSS color (`"#ff9800"`, `orange`, `var(--orange-color)`) or `[r, g, b]`. Leave a key out to keep its default. The visual editor has them under **Colors**.

```yaml
type: custom:heating-control-card
colors:
  hot_water: "#ffb300"
  pumping: teal
```

| Key | Used for | Default |
|---|---|---|
| `heating` | flame icon, header text and winning row while the burner fires | `#ff5722` |
| `hot_water` | shower head during a hot water run | `var(--amber-color)` |
| `pumping` | pump icon | `var(--disabled-color)` |
| `idle` | icon when the boiler is idle | `var(--disabled-color)` |
| `offline` | icon when the thermostat is offline | `var(--disabled-color)` |
| `fault` | fault banner, border and header | `var(--error-color)` |
| `warning` | pressure icon and warning line | `var(--error-color)` |
| `room` | Heat buttons, Heating along, Paused, pending targets | `var(--state-climate-heat-color)` |
| `water` | water flow text and line | `var(--light-blue-color)` |

A 0.2 config with `climate:` still works and shows that one room.

**Upgrading from 0.2:** once `thermostats` is set, the old keys `climate`, `name` and `paused` are ignored, and the card logs a warning in the browser console. Remove them and put a room's own `name` or `paused` inside its `thermostats` entry. A config with `thermostats: [living_room]` left over plus those keys shows only that one room; delete `thermostats` to get every room.

## Licence

MIT
