/*
 * Heating Control Card
 * One Lovelace card for every virtual thermostat in the house and the boiler
 * behind them, built for https://github.com/BarBaar44/thermostat
 *
 * Header: the room the boiler is heating for (the Tier 1 winner from
 * sensor.delta_temperature), its current and target temperature, what the
 * boiler is doing, schedule and pressure notes.
 * Rows: one per climate.virtual_thermostat_*, each with room temperature,
 * target with - and +, Heat/Off, and its role (heating, heating along,
 * reached, off, paused).
 *
 * What it reads from that backend:
 *  - climate.virtual_thermostat_*: the single source of truth per room. The
 *    card only ever writes here; TRV Setpoint Sync takes it from there.
 *  - sensor.delta_temperature: JSON {"area","target","curr","delta"}. A plain
 *    area sensor (e.g. sensor.virtual_heating_area) works too.
 *  - binary_sensor.main_thermostat_central_heating_active / ..._domestic_hot_
 *    water_active: the mode the boiler is in. CH active alone does not mean
 *    the burner fires: it can just be pumping water that is already warm.
 *  - binary_sensor.diyless_thermostat_flame_on: whether the burner fires.
 *    Heating = CH active + flame, Pumping = CH active without flame.
 *    Without a flame entity, CH active counts as heating.
 *  - sensor.thermostat_relative_modulation_level: burner load while it fires.
 *  - When the boiler entity is unavailable or unknown the ESPHome thermostat
 *    is offline: the header says so instead of guessing "idle". The rows keep
 *    working, the virtual thermostats live in HA itself.
 *  - switch.main_thermostat_central_heating_enabled: owned by the Heating
 *    Schedule. The card reports it, never touches it.
 *  - input_boolean.garden_heating_paused (living room only): while set, the
 *    pause/resume scripts own that thermostat, so its row is locked.
 *  - sensor.thermostat_water_pressure_in_ch_circuit: low and high pressure
 *    warnings (the safety valve opens at 3 bar).
 *  - water_flow (optional, e.g. sensor.watermeterkit_water_meter_kit_current_
 *    usage): L/min, 0 when no water flows. Shown only while it is above 0.
 *    "Hot water at 6.2 L/min" during a hot water run, else "Cold water at
 *    4.0 L/min". With no winning room it replaces the status line, else it
 *    is a small line under the room's temperatures.
 *  - binary_sensor.main_thermostat_fault_indication: OpenTherm fault flag.
 *    When on, the whole card turns red and a banner says so first. OpenTherm
 *    sends only this one bit, not the code on the boiler display, so the
 *    card does not try to interpret it.
 *
 * Setpoint taps are batched per room: the new target shows at once and one
 * climate.set_temperature goes out 0.8 s after the last tap.
 *
 * https://github.com/BarBaar44/Heating-Control-Card  (MIT)
 */

const VERSION = "0.7.1";

const PREFIX = "climate.virtual_thermostat_";
const LIVING_ROOM = "climate.virtual_thermostat_living_room";
const LIVING_ROOM_PAUSED = "input_boolean.garden_heating_paused";

const DEFAULTS = {
  title: "Heating",
  // null: every climate.virtual_thermostat_* entity, sorted by name.
  thermostats: null,
  heating_area: "sensor.delta_temperature",
  boiler: "binary_sensor.main_thermostat_central_heating_active",
  hot_water: "binary_sensor.main_thermostat_domestic_hot_water_active",
  flame: "binary_sensor.diyless_thermostat_flame_on",
  modulation: "sensor.thermostat_relative_modulation_level",
  ch_enabled: "switch.main_thermostat_central_heating_enabled",
  pressure: "sensor.thermostat_water_pressure_in_ch_circuit",
  pressure_min: 1.4,
  pressure_max: 2.7,
  fault: "binary_sensor.main_thermostat_fault_indication",
  // Optional water meter in L/min; null hides the flow entirely.
  water_flow: null,
  step: null,
  on_mode: null,
  show_off: true,
  // Any CSS color ("#ff9800", "orange", "var(--orange-color)") or [r, g, b].
  // Unset keys keep the defaults in COLORS.
  colors: null,
};

// colors key -> CSS variable and default.
const COLORS = {
  heating: ["--hc-fire", "#ff5722"],
  hot_water: ["--hc-dhw", "var(--amber-color, #ffb300)"],
  pumping: ["--hc-pump", "var(--disabled-color, #9e9e9e)"],
  idle: ["--hc-idle", "var(--disabled-color, #9e9e9e)"],
  offline: ["--hc-offline", "var(--disabled-color, #9e9e9e)"],
  fault: ["--hc-err", "var(--error-color, #db4437)"],
  warning: ["--hc-warn", "var(--error-color, #db4437)"],
  room: ["--hc-heat", "var(--state-climate-heat-color, #ff8100)"],
  water: ["--hc-water", "var(--light-blue-color, #03a9f4)"],
};

const cssColor = (v) => {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => num(n) !== null)) return `rgb(${v.map(Number).join(",")})`;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const BAD = ["unknown", "unavailable", "none", ""];
const num = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
const fmt = (v, d = 1) => (num(v) === null ? "--" : Number(v).toFixed(d));
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const STYLE = `
  :host {
${Object.values(COLORS).map(([v, d]) => `    ${v}: ${d};`).join("\n")}
    --hc-soft: var(--secondary-background-color, rgba(127,127,127,.15));
  }
  ha-card { padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; }
  button {
    border: none; font: inherit; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
    -webkit-tap-highlight-color: transparent;
  }
  button:disabled { opacity: .35; cursor: default; }

  /* Header */
  .head { display: flex; align-items: center; gap: 10px; }
  .icon {
    width: 44px; height: 44px; border-radius: 50%; flex: none;
    color: var(--hc-idle); background: color-mix(in srgb, var(--hc-idle) 15%, transparent);
    transition: background .3s, color .3s;
  }
  .pumping .head .icon { color: var(--hc-pump); background: color-mix(in srgb, var(--hc-pump) 15%, transparent); }
  .dhw .head .icon { color: var(--hc-dhw); background: color-mix(in srgb, var(--hc-dhw) 15%, transparent); }
  .coldwater .head .icon { color: var(--hc-water); background: color-mix(in srgb, var(--hc-water) 15%, transparent); }
  .burning .head .icon { color: var(--hc-fire); background: color-mix(in srgb, var(--hc-fire) 20%, transparent); }
  .alert .head .icon { color: var(--hc-warn); background: color-mix(in srgb, var(--hc-warn) 20%, transparent); }
  .offline .head .icon { color: var(--hc-offline); background: color-mix(in srgb, var(--hc-offline) 15%, transparent); }
  /* Animations run only while the header shows the flame or shower head:
     fault and pressure warnings keep their own static icon. Offline never
     sets burning or dhw. */
  .burning:not(.fault):not(.alert) #flame { animation: flicker 1.6s ease-in-out infinite; transform-origin: 50% 90%; }
  .dhw:not(.fault):not(.alert) #flame { animation: shower 0.7s ease-out infinite; }
  .htext { flex: 1; min-width: 0; cursor: pointer; }
  .title { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary-text-color); }
  .winner { font-size: 18px; font-weight: 600; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .burning .winner { color: var(--hc-fire); }
  .sub { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .note { display: none; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; padding: 6px 8px; border-radius: 8px; }
  .note ha-icon { --mdc-icon-size: 16px; flex: none; }
  .note.show { display: flex; }
  #warn { color: var(--hc-warn); background: color-mix(in srgb, var(--hc-warn) 12%, transparent); }
  #fault {
    display: none; align-items: center; gap: 10px; cursor: pointer;
    padding: 10px 12px; border-radius: 10px; color: #fff; background: var(--hc-err);
    font-size: 14px; font-weight: 600; animation: pulse 2s ease-in-out infinite;
  }
  #fault ha-icon { --mdc-icon-size: 26px; flex: none; }
  #fault small { display: block; font-size: 12px; font-weight: 400; opacity: .9; }
  .fault #fault { display: flex; }
  ha-card.fault { border: 2px solid var(--hc-err); }
  .fault .head .icon { color: var(--hc-err); background: color-mix(in srgb, var(--hc-err) 20%, transparent); }
  .fault .winner { color: var(--hc-err); }
  #sched { color: var(--secondary-text-color); background: var(--hc-soft); }

  /* Water flow under the status line while a room wins (or a fault shows). */
  .flowline { display: none; align-items: center; gap: 3px; font-size: 12px; font-weight: 500; color: var(--hc-water); white-space: nowrap; }
  .flowline.show { display: flex; }
  .flowline.hot { color: var(--hc-dhw); }
  .flowline ha-icon { --mdc-icon-size: 14px; flex: none; }
  .flowline.show #drop { animation: drip 1.4s ease-in infinite; }
  .flowhead .winner { color: var(--hc-water); }
  .flowhead.dhw .winner { color: var(--hc-dhw); }

  /* Rooms */
  .rooms { display: flex; flex-direction: column; gap: 4px; }
  .row {
    display: grid; grid-template-columns: minmax(0,1fr) minmax(64px,1fr) auto 34px; align-items: center; gap: 8px;
    padding: 6px 6px 6px 10px; border-radius: 12px; border: 1px solid transparent;
  }
  .row.win { border-color: color-mix(in srgb, var(--hc-fire) 45%, transparent); background: color-mix(in srgb, var(--hc-fire) 8%, transparent); }
  .rinfo { min-width: 0; cursor: pointer; }
  .rname { font-size: 14px; font-weight: 500; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rrole { font-size: 11px; color: var(--secondary-text-color); display: flex; align-items: center; gap: 3px; white-space: nowrap; }
  .rrole ha-icon { --mdc-icon-size: 13px; }
  .row.win .rrole { color: var(--hc-fire); font-weight: 600; }
  .row.along .rrole { color: var(--hc-heat); }
  .row.paused .rrole { color: var(--hc-heat); }
  /* Room temperature is the main reading: larger and bolder than the target. */
  .rcur { display: flex; align-items: center; justify-content: center; gap: 2px; font-size: 20px; font-weight: 600; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .rcur ha-icon { --mdi-icon-size: 16px; --mdc-icon-size: 16px; color: var(--secondary-text-color); }
  .set { display: flex; align-items: center; gap: 2px; }
  .adj { width: 28px; height: 28px; border-radius: 8px; background: var(--hc-soft); color: var(--primary-text-color); }
  .adj ha-icon { --mdc-icon-size: 18px; }
  .adj:active:not(:disabled) { transform: scale(.92); }
  .rtgt { font-size: 14px; font-weight: 500; min-width: 46px; text-align: center; color: var(--primary-text-color); }
  .row.off .rtgt, .row.paused .rtgt { opacity: .4; }
  .row.pending .rtgt { color: var(--hc-heat); opacity: 1; }
  .mode { width: 32px; height: 32px; border-radius: 50%; background: var(--hc-soft); color: var(--secondary-text-color); }
  .mode ha-icon { --mdc-icon-size: 18px; }
  .row.heat .mode { background: var(--hc-heat); color: #fff; }
  .row.paused .mode { color: var(--hc-heat); opacity: 1; cursor: pointer; }
  .row.unavailable { opacity: .45; }
  /* One room: its Heat/Off sits in the header, the row loses that column. */
  #hmode { display: none; flex: none; }
  .single #hmode { display: flex; }
  .single .row { grid-template-columns: minmax(0,1fr) minmax(64px,1fr) auto; }
  .single .row .mode { display: none; }
  #hmode.heat { background: var(--hc-heat); color: #fff; }
  #hmode.paused { color: var(--hc-heat); opacity: 1; cursor: pointer; }
  .empty { font-size: 13px; color: var(--secondary-text-color); padding: 4px 2px; }

  @keyframes shower {
    0%   { clip-path: inset(0 0 45% 0); }
    100% { clip-path: inset(0 0 0 0); }
  }
  @keyframes drip {
    0%   { transform: translateY(-2px); opacity: .5; }
    60%  { transform: translateY(1px);  opacity: 1;  }
    100% { transform: translateY(2px);  opacity: .5; }
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .75; } }
  @keyframes flicker {
    0%   { transform: rotate(-1.5deg) scaleY(1);    opacity: .9; }
    20%  { transform: rotate(1.8deg)  scaleY(1.12); opacity: 1;  }
    40%  { transform: rotate(-.8deg)  scaleY(.94);  opacity: .8; }
    60%  { transform: rotate(1.2deg)  scaleY(1.08); opacity: 1;  }
    80%  { transform: rotate(-1.8deg) scaleY(.97);  opacity: .85;}
    100% { transform: rotate(-1.5deg) scaleY(1);    opacity: .9; }
  }
  @media (prefers-reduced-motion: reduce) { .burning #flame, .dhw #flame, #fault, #drop { animation: none !important; } }
  @media (max-width: 360px) { .row { gap: 4px; } .rcur { font-size: 18px; } .rcur ha-icon { display: none; } }
`;

class HeatingControlCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._rows = new Map(); // entity_id -> { el, refs, pending, timer, clear }
    this._rowKey = "";
  }

  static getConfigElement() {
    return document.createElement("heating-control-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    const c = { ...DEFAULTS, ...(config || {}) };
    // 0.2.x had one `climate`; keep it working as a one-room list.
    if (!c.thermostats && c.climate) c.thermostats = [{ entity: c.climate, name: c.name, paused: c.paused }];
    else if (c.thermostats && (c.climate || c.name || c.paused !== undefined)) {
      console.warn(
        "heating-control-card: `thermostats` is set, so the 0.2 keys `climate`, `name` and `paused` are ignored. " +
        "Remove them, and give a room its own name or paused entity inside `thermostats`."
      );
    }
    if (c.thermostats && !Array.isArray(c.thermostats)) throw new Error("thermostats must be a list");
    if (c.colors != null && (typeof c.colors !== "object" || Array.isArray(c.colors))) throw new Error("colors must be a map, e.g. hot_water: orange");
    this._config = c;
    this._applyColors(c.colors || {});
    this._rows.forEach((r) => { clearTimeout(r.timer); clearTimeout(r.clear); });
    this._rows.clear();
    this._rowKey = "";
    this._build();
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  // Inline custom properties on the host beat the :host defaults.
  _applyColors(colors) {
    Object.keys(colors).forEach((k) => {
      if (!COLORS[k]) console.warn(`heating-control-card: unknown colors key "${k}". Known: ${Object.keys(COLORS).join(", ")}`);
    });
    Object.entries(COLORS).forEach(([k, [v]]) => {
      const val = cssColor(colors[k]);
      if (val) this.style.setProperty(v, val);
      else this.style.removeProperty(v);
    });
  }

  getCardSize() {
    return 2 + this._rooms().length;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div id="fault"><ha-icon icon="mdi:alert-octagon"></ha-icon><div>Boiler fault<small>The boiler reports a fault. Check its display; heating may not work.</small></div></div>
        <div class="head">
          <button class="icon" id="icon" title="Boiler"><ha-icon id="flame" icon="mdi:fire-off"></ha-icon></button>
          <div class="htext" id="htext">
            <div class="title" id="title"></div>
            <div class="winner" id="winner"></div>
            <div class="sub" id="sub"></div>
            <div class="flowline" id="flowline"><ha-icon id="drop" icon="mdi:water"></ha-icon><span id="flowText"></span></div>
          </div>
          <button class="mode" id="hmode"><ha-icon id="hmicon" icon="mdi:radiator-off"></ha-icon></button>
        </div>
        <div class="note" id="sched"><ha-icon icon="mdi:calendar-clock"></ha-icon><span>Central heating is off by schedule</span></div>
        <div class="note" id="warn"><ha-icon icon="mdi:alert"></ha-icon><span id="warnText"></span></div>
        <div class="rooms" id="rooms"></div>
      </ha-card>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = {
      card: this.shadowRoot.querySelector("ha-card"),
      title: $("title"), winner: $("winner"), sub: $("sub"), flame: $("flame"),
      hmode: $("hmode"), hmicon: $("hmicon"),
      flowline: $("flowline"), flowText: $("flowText"),
      sched: $("sched"), warn: $("warn"), warnText: $("warnText"), rooms: $("rooms"),
    };
    $("icon").addEventListener("click", () => this._moreInfo(this._iconTarget));
    $("htext").addEventListener("click", () => this._moreInfo(this._flowHead ? this._config.water_flow : this._winnerEntity || this._config.heating_area));
    $("fault").addEventListener("click", () => this._moreInfo(this._config.fault));
    $("hmode").addEventListener("click", () => this._single && this._modeTap(this._single));
    $("flowline").addEventListener("click", (ev) => { ev.stopPropagation(); this._moreInfo(this._config.water_flow); });
    $("sched").addEventListener("click", () => this._moreInfo(this._config.ch_enabled));
    $("warn").addEventListener("click", () => this._moreInfo(this._config.pressure));
  }

  _state(id) {
    return id && this._hass ? this._hass.states[id] : undefined;
  }

  _on(id) {
    const s = this._state(id);
    return !!s && s.state === "on";
  }

  // The area name HA's area_name() gives: the entity's own area, else its device's.
  _areaOf(entityId) {
    const h = this._hass;
    const ent = h.entities && h.entities[entityId];
    if (!ent) return null;
    let areaId = ent.area_id;
    if (!areaId && ent.device_id && h.devices && h.devices[ent.device_id]) areaId = h.devices[ent.device_id].area_id;
    return areaId && h.areas && h.areas[areaId] ? h.areas[areaId].name : null;
  }

  // Configured rooms, or every virtual thermostat sorted by name.
  _rooms() {
    const c = this._config;
    if (!c || !this._hass) return [];
    let list;
    if (c.thermostats) {
      list = c.thermostats.map((t) => (typeof t === "string" ? { entity: t } : { ...t })).filter((t) => t.entity);
    } else {
      list = Object.keys(this._hass.states).filter((id) => id.startsWith(PREFIX)).map((entity) => ({ entity }));
    }
    list.forEach((t) => {
      if (t.paused === undefined) t.paused = t.entity === LIVING_ROOM ? LIVING_ROOM_PAUSED : null;
      const s = this._state(t.entity);
      t.label = t.name || this._areaOf(t.entity) || (s && s.attributes.friendly_name) || t.entity;
    });
    if (!c.thermostats) list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }

  // sensor.delta_temperature holds JSON; a plain area sensor holds the name.
  _winnerInfo() {
    const s = this._state(this._config.heating_area);
    if (!s) return { area: null };
    const raw = String(s.state);
    let info = { area: raw };
    if (raw.startsWith("{")) {
      try {
        info = JSON.parse(raw);
      } catch (err) {
        return { area: null };
      }
    }
    const area = info.area == null ? "" : String(info.area);
    return {
      area: area && !BAD.includes(area.toLowerCase()) && area.toLowerCase() !== "off" ? area : null,
      target: num(info.target),
      curr: num(info.curr),
    };
  }

  _update() {
    if (!this._el || !this._hass) return;
    const c = this._config;
    const e = this._el;
    const rooms = this._rooms();

    const boilerState = this._state(c.boiler);
    const flameState = this._state(c.flame);
    const offline = (!!boilerState && BAD.includes(boilerState.state)) || (!!flameState && BAD.includes(flameState.state));
    const chActive = !offline && !!boilerState && boilerState.state === "on";
    const dhw = !offline && this._on(c.hot_water);
    // Burner firing: the flame entity when there is one, else CH active.
    const firing = !offline && (flameState ? flameState.state === "on" : chActive || dhw);
    // On a combi a hot water run wins: the flame is then for the tap.
    const heating = chActive && firing && !dhw;
    const pumping = chActive && !firing && !dhw;
    const modState = this._state(c.modulation);
    const mod = firing && modState ? num(modState.state) : null;
    const chEnabledState = this._state(c.ch_enabled);
    const chDisabled = !!chEnabledState && chEnabledState.state === "off";
    const pState = this._state(c.pressure);
    const p = pState ? parseFloat(pState.state) : NaN;
    const lowP = !isNaN(p) && p < Number(c.pressure_min);
    const highP = !isNaN(p) && c.pressure_max != null && p > Number(c.pressure_max);
    const fault = !offline && this._on(c.fault);

    const w = this._winnerInfo();
    const winRoom = w.area ? rooms.find((r) => this._areaOf(r.entity) === w.area || r.label === w.area) : null;
    this._winnerEntity = winRoom ? winRoom.entity : null;

    // Header
    e.title.textContent = c.title || "";
    const anyHeat = rooms.some((r) => {
      const s = this._state(r.entity);
      return s && s.state !== "off" && !BAD.includes(s.state);
    });
    const modText = mod !== null ? ` · ${Math.round(mod)}%` : "";
    let activity;
    if (offline) activity = "thermostat offline";
    else if (heating) activity = `boiler heating${modText}`;
    else if (pumping) activity = "boiler pumping";
    else if (dhw) activity = `boiler on for hot water${firing ? modText : ""}`;
    else activity = "boiler idle";
    if (offline) {
      e.winner.textContent = "Thermostat offline";
      e.sub.textContent = w.area ? `${w.area} calls for heat · boiler status unknown` : "Boiler status unknown";
    } else if (w.area) {
      e.winner.textContent = w.area;
      const temps = w.curr !== null && w.target !== null ? `${fmt(w.curr)}° → ${fmt(w.target)}°` : "";
      e.sub.textContent = [temps, activity].filter(Boolean).join(" · ");
    } else {
      // No winner: either nothing is set to heat, or every room is at target.
      e.winner.textContent = dhw ? "Hot water" : !anyHeat || chDisabled ? "Heating off" : "All rooms at target";
      e.sub.textContent = activity.charAt(0).toUpperCase() + activity.slice(1);
    }
    if (fault) {
      e.winner.textContent = "Boiler fault";
      e.sub.textContent = w.area ? `Heating for ${w.area} may not work` : "Heating may not work";
    }
    // Water flow: nothing at 0, unavailable or without the option.
    const flowState = this._state(c.water_flow);
    const flow = flowState ? num(flowState.state) : null;
    const flowing = flow !== null && flow > 0;
    // Hot during a hot water run, else cold; offline we cannot tell. With no
    // winning room (and no offline or fault text) the flow takes the status
    // line, else it is a small line under the temperatures.
    const flowText = flowing ? `${offline ? "Water" : dhw ? "Hot water" : "Cold water"} at ${flow.toFixed(1)} L/min` : "";
    this._flowHead = flowing && !offline && !fault && !w.area;
    if (this._flowHead) e.winner.textContent = flowText;
    const flowLine = flowing && !this._flowHead;
    e.flowline.classList.toggle("show", flowLine);
    e.flowline.classList.toggle("hot", flowLine && dhw);
    e.flowText.textContent = flowLine ? flowText : "";

    let icon = "mdi:fire-off";
    if (offline) icon = "mdi:lan-disconnect";
    else if (fault) icon = "mdi:alert-octagon";
    else if (lowP || highP) icon = "mdi:fire-alert";
    else if (heating) icon = "mdi:fire";
    else if (pumping) icon = "mdi:pump";
    else if (dhw) icon = "mdi:shower-head";
    else if (flowing) icon = "mdi:water-pump";
    e.flame.setAttribute("icon", icon);
    const coldIcon = icon === "mdi:water-pump";
    this._iconTarget = offline ? c.boiler : fault ? c.fault : dhw ? c.hot_water : coldIcon ? c.water_flow : c.flame && flameState ? c.flame : c.boiler;

    e.sched.classList.toggle("show", chDisabled && anyHeat);
    e.warn.classList.toggle("show", lowP || highP);
    e.warnText.textContent = lowP
      ? `Low CH pressure: ${fmt(p)} bar (min ${fmt(c.pressure_min)})`
      : highP ? `High CH pressure: ${fmt(p)} bar (max ${fmt(c.pressure_max)})` : "";

    const cls = e.card.classList;
    cls.toggle("burning", heating);
    cls.toggle("dhw", dhw);
    cls.toggle("pumping", pumping);
    cls.toggle("alert", lowP || highP);
    cls.toggle("offline", offline);
    cls.toggle("fault", fault);
    cls.toggle("flowhead", this._flowHead);
    cls.toggle("coldwater", coldIcon);

    // Rows: rebuild only when the set of rooms changes, else update in place.
    const visible = rooms.filter((r) => {
      if (c.show_off !== false) return true;
      const s = this._state(r.entity);
      return !s || s.state !== "off" || r.entity === this._winnerEntity;
    });
    const key = visible.map((r) => `${r.entity}|${r.label}`).join(",");
    if (key !== this._rowKey) this._buildRows(visible, key);
    visible.forEach((r) => this._updateRow(r, { heating, pumping, offline, winner: this._winnerEntity }));

    // One room: mirror its Heat/Off button into the header.
    this._single = visible.length === 1 ? visible[0].entity : null;
    cls.toggle("single", !!this._single);
    if (this._single) {
      const f = this._rows.get(this._single).refs;
      e.hmicon.setAttribute("icon", f.micon.getAttribute("icon"));
      e.hmode.title = f.mode.title;
      e.hmode.disabled = f.mode.disabled;
      e.hmode.classList.toggle("heat", f.row.classList.contains("heat"));
      e.hmode.classList.toggle("paused", f.row.classList.contains("paused"));
    }
  }

  _buildRows(rooms, key) {
    const box = this._el.rooms;
    const keep = new Set(rooms.map((r) => r.entity));
    this._rows.forEach((r, id) => {
      if (!keep.has(id)) {
        clearTimeout(r.timer);
        clearTimeout(r.clear);
        this._rows.delete(id);
      }
    });
    box.innerHTML = rooms.length ? "" : `<div class="empty">No virtual thermostats found</div>`;
    rooms.forEach((room) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `
        <div class="rinfo">
          <div class="rname">${esc(room.label)}</div>
          <div class="rrole"><ha-icon class="ricon" icon="mdi:fire"></ha-icon><span class="rtext"></span></div>
        </div>
        <div class="rcur" title="Room temperature"><ha-icon icon="mdi:thermometer"></ha-icon><span class="rcurv"></span></div>
        <div class="set">
          <button class="adj down" title="Lower"><ha-icon icon="mdi:minus"></ha-icon></button>
          <div class="rtgt"></div>
          <button class="adj up" title="Raise"><ha-icon icon="mdi:plus"></ha-icon></button>
        </div>
        <button class="mode"><ha-icon class="micon" icon="mdi:radiator-off"></ha-icon></button>`;
      const q = (s) => row.querySelector(s);
      const refs = { row, ricon: q(".ricon"), rtext: q(".rtext"), cur: q(".rcurv"), tgt: q(".rtgt"), up: q(".up"), down: q(".down"), mode: q(".mode"), micon: q(".micon") };
      const prev = this._rows.get(room.entity);
      const state = { refs, pending: prev ? prev.pending : null, timer: prev ? prev.timer : null, clear: prev ? prev.clear : null, room };
      this._rows.set(room.entity, state);
      q(".rinfo").addEventListener("click", () => this._moreInfo(room.entity));
      refs.up.addEventListener("click", () => this._adjust(room.entity, 1));
      refs.down.addEventListener("click", () => this._adjust(room.entity, -1));
      refs.mode.addEventListener("click", () => this._modeTap(room.entity));
      box.appendChild(row);
    });
    this._rowKey = key;
  }

  _updateRow(room, ctx) {
    const r = this._rows.get(room.entity);
    if (!r) return;
    r.room = room;
    const f = r.refs;
    const s = this._state(room.entity);
    const unavailable = !s || BAD.includes(s.state);
    const a = s ? s.attributes : {};
    const isOff = !unavailable && s.state === "off";
    const paused = this._on(room.paused);

    if (r.pending !== null && !r.timer && num(a.temperature) === r.pending) {
      r.pending = null;
      clearTimeout(r.clear);
    }
    const target = r.pending !== null ? r.pending : a.temperature;
    const min = a.min_temp ?? 5;
    const max = a.max_temp ?? 30;
    const below = num(a.temperature) !== null && num(a.current_temperature) !== null && num(a.current_temperature) < num(a.temperature);
    const isWinner = ctx.winner === room.entity;

    // Role in the two-tier model
    let role, roleIcon;
    if (unavailable) { role = "Unavailable"; roleIcon = "mdi:help-circle-outline"; }
    else if (paused) { role = "Paused · garden doors open"; roleIcon = "mdi:door-open"; }
    else if (isOff) { role = "Off"; roleIcon = "mdi:power"; }
    else if (isWinner && ctx.heating) { role = "Heating"; roleIcon = "mdi:fire"; }
    else if (isWinner && ctx.pumping) { role = "Pumping"; roleIcon = "mdi:pump"; }
    else if (isWinner) { role = "Calls for heat"; roleIcon = "mdi:fire"; }
    else if (below && ctx.heating) { role = "Heating along"; roleIcon = "mdi:radiator"; }
    else if (below && ctx.pumping) { role = "Pumping along"; roleIcon = "mdi:pump"; }
    else if (below) { role = "Calls for heat"; roleIcon = "mdi:thermometer-chevron-up"; }
    else { role = "Reached"; roleIcon = "mdi:check"; }

    f.rtext.textContent = role;
    f.ricon.setAttribute("icon", roleIcon);
    f.cur.textContent = `${fmt(a.current_temperature)}°`;
    f.tgt.textContent = isOff && r.pending === null ? "--" : `${fmt(target)}°`;

    if (paused) {
      f.micon.setAttribute("icon", "mdi:pause");
      f.mode.title = "Paused by the garden doors";
    } else {
      f.micon.setAttribute("icon", isOff ? "mdi:radiator-off" : "mdi:radiator");
      f.mode.title = isOff ? "Turn heating on" : "Turn heating off";
    }

    // While paused the pause/resume scripts own the thermostat: a change
    // here would be overwritten by the resume snapshot.
    const locked = unavailable || paused || isOff;
    f.down.disabled = locked || num(target) === null || num(target) <= min;
    f.up.disabled = locked || num(target) === null || num(target) >= max;
    f.mode.disabled = unavailable;

    const cls = f.row.classList;
    cls.toggle("win", isWinner && !paused && !isOff && !unavailable);
    cls.toggle("along", !isWinner && below && ctx.heating && !isOff && !paused && !unavailable);
    cls.toggle("heat", !isOff && !paused && !unavailable);
    cls.toggle("off", isOff);
    cls.toggle("paused", paused);
    cls.toggle("pending", r.pending !== null);
    cls.toggle("unavailable", unavailable);
  }

  _adjust(entityId, dir) {
    const r = this._rows.get(entityId);
    const s = this._state(entityId);
    if (!r || !s) return;
    const a = s.attributes;
    const step = Number(r.room.step || this._config.step || a.target_temp_step || 0.5);
    const min = a.min_temp ?? 5;
    const max = a.max_temp ?? 30;
    const base = Number(r.pending !== null ? r.pending : (a.temperature ?? min));
    let v = Math.round((base + dir * step) / step) * step;
    v = Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
    r.pending = v;

    // One service call after the last tap, so TRV Setpoint Sync runs once.
    clearTimeout(r.timer);
    clearTimeout(r.clear);
    r.timer = setTimeout(() => {
      r.timer = null;
      this._hass.callService("climate", "set_temperature", { entity_id: entityId, temperature: v });
      // Fallback if HA never confirms (rejected call, rounding)
      r.clear = setTimeout(() => {
        r.pending = null;
        this._update();
      }, 5000);
      this._update();
    }, 800);
    this._update();
  }

  _modeTap(entityId) {
    const r = this._rows.get(entityId);
    if (r && this._on(r.room.paused)) {
      this._moreInfo(r.room.paused);
      return;
    }
    const s = this._state(entityId);
    if (!s) return;
    const modes = s.attributes.hvac_modes || [];
    const onMode = (r && r.room.on_mode) || this._config.on_mode || (modes.includes("heat") ? "heat" : modes.find((m) => m !== "off"));
    this._hass.callService("climate", "set_hvac_mode", {
      entity_id: entityId,
      hvac_mode: s.state === "off" ? onMode : "off",
    });
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }
}

/* ---------- Visual editor ---------- */

const SCHEMA = [
  { name: "title", selector: { text: {} } },
  { name: "thermostats", selector: { entity: { domain: "climate", multiple: true } } },
  { name: "show_off", selector: { boolean: {} } },
  { name: "heating_area", selector: { entity: { domain: ["sensor", "input_text", "input_select"] } } },
  { name: "boiler", selector: { entity: { domain: "binary_sensor" } } },
  { name: "hot_water", selector: { entity: { domain: "binary_sensor" } } },
  { name: "flame", selector: { entity: { domain: "binary_sensor" } } },
  { name: "modulation", selector: { entity: { domain: "sensor" } } },
  { name: "ch_enabled", selector: { entity: { domain: ["switch", "input_boolean"] } } },
  { name: "pressure", selector: { entity: { domain: "sensor" } } },
  { name: "fault", selector: { entity: { domain: "binary_sensor" } } },
  { name: "water_flow", selector: { entity: { domain: "sensor" } } },
  {
    type: "expandable", name: "colors", title: "Colors", schema: [
      {
        type: "grid", name: "", schema: Object.keys(COLORS).map((k) => ({ name: k, selector: { text: {} } })),
      },
    ],
  },
  {
    type: "grid", name: "", schema: [
      { name: "pressure_min", selector: { number: { min: 0, max: 3, step: 0.1, mode: "box", unit_of_measurement: "bar" } } },
      { name: "pressure_max", selector: { number: { min: 0, max: 4, step: 0.1, mode: "box", unit_of_measurement: "bar" } } },
      { name: "step", selector: { number: { min: 0.1, max: 1, step: 0.1, mode: "box", unit_of_measurement: "°" } } },
    ],
  },
];

const LABELS = {
  title: "Title",
  thermostats: "Thermostats (empty: all virtual thermostats)",
  show_off: "Show rooms that are off",
  heating_area: "Winning room (delta temperature or area sensor)",
  boiler: "Central heating active",
  hot_water: "Hot water active",
  flame: "Flame on",
  modulation: "Relative modulation level",
  ch_enabled: "Central heating enabled",
  pressure: "CH water pressure",
  fault: "Boiler fault indication",
  water_flow: "Water flow (L/min, optional)",
  pressure_min: "Low pressure threshold",
  pressure_max: "High pressure threshold",
  step: "Setpoint step",
  heating: "Heating",
  hot_water: "Hot water",
  pumping: "Pumping",
  idle: "Idle",
  offline: "Offline",
  fault: "Fault",
  warning: "Pressure warning",
  room: "Rooms in heat",
  water: "Water flow",
};

async function loadHaForm() {
  if (customElements.get("ha-form")) return;
  const helpers = await window.loadCardHelpers?.();
  if (!helpers) return;
  const card = await helpers.createCardElement({ type: "entities", entities: [] });
  await card.constructor.getConfigElement();
}

class HeatingControlCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  async connectedCallback() {
    await loadHaForm();
    this._render();
  }

  _render() {
    if (!this._hass || !this._config || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = SCHEMA;
      this._form.computeLabel = (s) => LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const cfg = { ...ev.detail.value };
        if (Array.isArray(cfg.thermostats) && !cfg.thermostats.length) delete cfg.thermostats;
        if (cfg.colors) {
          const col = Object.fromEntries(Object.entries(cfg.colors).filter(([, v]) => v !== "" && v != null));
          if (Object.keys(col).length) cfg.colors = col;
          else delete cfg.colors;
        }
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: this._config }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    // Objects in YAML (entity + name) show as plain entities in the editor.
    const data = { ...this._config };
    if (Array.isArray(data.thermostats)) data.thermostats = data.thermostats.map((t) => (typeof t === "string" ? t : t.entity));
    this._form.data = data;
  }
}

if (!customElements.get("heating-control-card")) {
  customElements.define("heating-control-card", HeatingControlCard);
}
if (!customElements.get("heating-control-card-editor")) {
  customElements.define("heating-control-card-editor", HeatingControlCardEditor);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "heating-control-card",
  name: "Heating Control Card",
  description: "All virtual thermostats, the room the boiler heats for, boiler status and pressure warning.",
  preview: true,
});

console.info(`%c HEATING-CONTROL-CARD %c ${VERSION} `, "background:#ff5722;color:#fff", "");
