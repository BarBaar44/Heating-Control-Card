/*
 * Heating Control Card
 * One Lovelace card for a room's virtual thermostat and the boiler behind it,
 * built for the multi-room setup in https://github.com/BarBaar44/thermostat
 *
 * What it reads from that backend:
 *  - climate.virtual_thermostat_<room>: the single source of truth for the
 *    room. The card only ever writes here; TRV Setpoint Sync takes it from
 *    there (TRVs, +1 C buffer for the winner, boiler setpoint).
 *  - sensor.delta_temperature: JSON {"area","target","curr","delta"}. The
 *    area is the Tier 1 winner, the room the boiler is currently heating for.
 *    A plain area sensor (e.g. sensor.virtual_heating_area) works too.
 *  - binary_sensor.main_thermostat_central_heating_active / ..._domestic_hot_
 *    water_active: what the boiler is firing for.
 *  - switch.main_thermostat_central_heating_enabled: owned by the Heating
 *    Schedule. When off, a room in heat gets no heat; the card says so but
 *    never touches the switch.
 *  - input_boolean.garden_heating_paused (living room only): while set, the
 *    pause/resume scripts own the thermostat, so the controls are locked.
 *  - sensor.thermostat_water_pressure_in_ch_circuit: low pressure warning.
 *
 * Setpoint taps are batched: the card shows the new target at once and
 * sends one climate.set_temperature call 0.8 s after the last tap.
 *
 * https://github.com/BarBaar44/Heating-Control-Card  (MIT)
 */

const VERSION = "0.2.0";

const LIVING_ROOM = "climate.virtual_thermostat_living_room";

const DEFAULTS = {
  name: null,
  climate: LIVING_ROOM,
  heating_area: "sensor.delta_temperature",
  boiler: "binary_sensor.main_thermostat_central_heating_active",
  hot_water: "binary_sensor.main_thermostat_domestic_hot_water_active",
  ch_enabled: "switch.main_thermostat_central_heating_enabled",
  pressure: "sensor.thermostat_water_pressure_in_ch_circuit",
  pressure_min: 1.4,
  // Only defaults for the living room; see setConfig.
  paused: undefined,
  step: null,
  on_mode: null,
};
const LIVING_ROOM_PAUSED = "input_boolean.garden_heating_paused";

const BAD = ["unknown", "unavailable", "none", ""];
const fmt = (v, d = 1) =>
  v === undefined || v === null || v === "" || isNaN(Number(v)) ? "--" : Number(v).toFixed(d);

const STYLE = `
  :host { --hc-heat: var(--state-climate-heat-color, #ff8100); --hc-fire: #ff5722; --hc-dhw: var(--blue-color, #2196f3); }
  ha-card {
    padding: 12px; height: 100%; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 10px; overflow: hidden;
  }
  button {
    border: none; font: inherit; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
    -webkit-tap-highlight-color: transparent;
  }
  button:disabled { opacity: .35; cursor: default; }
  .top { display: flex; align-items: center; gap: 10px; }
  .icon {
    width: 40px; height: 40px; border-radius: 50%; flex: none;
    background: rgba(127,127,127,.15); color: var(--disabled-color, #9e9e9e);
    transition: background .3s, color .3s;
  }
  .heat .icon { color: var(--hc-heat); background: color-mix(in srgb, var(--hc-heat) 15%, transparent); }
  .dhw .icon { color: var(--hc-dhw); background: color-mix(in srgb, var(--hc-dhw) 15%, transparent); }
  .burning .icon { color: var(--hc-fire); background: color-mix(in srgb, var(--hc-fire) 20%, transparent); }
  .alert .icon { color: var(--error-color, #db4437); background: color-mix(in srgb, var(--error-color, #db4437) 20%, transparent); }
  .info { flex: 1; min-width: 0; cursor: pointer; }
  .name, .status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-size: 14px; font-weight: 600; color: var(--primary-text-color); }
  .status { font-size: 12px; color: var(--secondary-text-color); }
  .mine .status { color: var(--hc-fire); }
  .mode {
    width: 36px; height: 36px; border-radius: 50%; flex: none;
    background: var(--secondary-background-color, rgba(127,127,127,.15));
    color: var(--secondary-text-color);
  }
  .heat .mode { background: var(--hc-heat); color: #fff; }
  .paused .mode { background: var(--secondary-background-color, rgba(127,127,127,.15)); color: var(--hc-heat); opacity: 1; cursor: pointer; }
  .bottom { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; margin-top: auto; }
  .block { display: flex; flex-direction: column; }
  .label { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary-text-color); }
  .value { font-size: 24px; font-weight: 600; line-height: 1.1; color: var(--primary-text-color); }
  .setpoint { display: flex; align-items: center; gap: 6px; }
  .setpoint .block { align-items: center; min-width: 52px; }
  .off .setpoint .value, .paused .setpoint .value { opacity: .4; }
  .pending .setpoint .value { color: var(--hc-heat); opacity: 1; }
  .adj {
    width: 34px; height: 34px; border-radius: 10px;
    background: var(--secondary-background-color, rgba(127,127,127,.15));
    color: var(--primary-text-color);
  }
  .adj:active:not(:disabled) { transform: scale(.92); }
  .note {
    display: none; align-items: center; gap: 6px; cursor: pointer;
    font-size: 12px; padding: 6px 8px; border-radius: 8px;
  }
  .note ha-icon { --mdc-icon-size: 16px; flex: none; }
  .note.show { display: flex; }
  #warn { color: var(--error-color, #db4437); background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
  #info2 { color: var(--secondary-text-color); background: var(--secondary-background-color, rgba(127,127,127,.12)); }
  .unavailable .bottom { opacity: .4; }
  .burning #flame { animation: flicker 1.6s ease-in-out infinite; transform-origin: 50% 90%; }
  @keyframes flicker {
    0%   { transform: rotate(-1.5deg) scaleY(1);    opacity: .9; }
    20%  { transform: rotate(1.8deg)  scaleY(1.12); opacity: 1;  }
    40%  { transform: rotate(-.8deg)  scaleY(.94);  opacity: .8; }
    60%  { transform: rotate(1.2deg)  scaleY(1.08); opacity: 1;  }
    80%  { transform: rotate(-1.8deg) scaleY(.97);  opacity: .85;}
    100% { transform: rotate(-1.5deg) scaleY(1);    opacity: .9; }
  }
  @media (prefers-reduced-motion: reduce) { .burning #flame { animation: none; } }
`;

class HeatingControlCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._pending = null;
    this._timer = null;
    this._clear = null;
  }

  static getConfigElement() {
    return document.createElement("heating-control-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    const c = { ...DEFAULTS, ...(config || {}) };
    if (!c.climate) throw new Error("climate entity missing");
    // The garden door pause belongs to the living room only.
    if (c.paused === undefined) c.paused = c.climate === LIVING_ROOM ? LIVING_ROOM_PAUSED : null;
    this._config = c;
    this._build();
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 6, rows: 3, min_columns: 6, min_rows: 3 };
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="top">
          <button class="icon" id="icon" title="Boiler"><ha-icon id="flame" icon="mdi:fire-off"></ha-icon></button>
          <div class="info" id="info">
            <div class="name" id="name"></div>
            <div class="status" id="status"></div>
          </div>
          <button class="mode" id="mode"><ha-icon id="modeIcon" icon="mdi:radiator-off"></ha-icon></button>
        </div>
        <div class="bottom">
          <div class="block">
            <span class="label">Room</span>
            <span class="value" id="current">--</span>
          </div>
          <div class="setpoint">
            <button class="adj" id="down" title="Lower"><ha-icon icon="mdi:minus"></ha-icon></button>
            <div class="block">
              <span class="label">Target</span>
              <span class="value" id="target">--</span>
            </div>
            <button class="adj" id="up" title="Raise"><ha-icon icon="mdi:plus"></ha-icon></button>
          </div>
        </div>
        <div class="note" id="info2"><ha-icon id="info2Icon" icon="mdi:information-outline"></ha-icon><span id="info2Text"></span></div>
        <div class="note" id="warn"><ha-icon icon="mdi:alert"></ha-icon><span id="warnText"></span></div>
      </ha-card>`;

    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = {
      card: this.shadowRoot.querySelector("ha-card"),
      name: $("name"), status: $("status"), current: $("current"), target: $("target"),
      mode: $("mode"), modeIcon: $("modeIcon"), flame: $("flame"),
      warn: $("warn"), warnText: $("warnText"),
      info2: $("info2"), info2Icon: $("info2Icon"), info2Text: $("info2Text"),
      up: $("up"), down: $("down"),
    };
    $("info").addEventListener("click", () => this._moreInfo(this._config.climate));
    $("icon").addEventListener("click", () => this._moreInfo(this._iconTarget || this._config.climate));
    $("warn").addEventListener("click", () => this._moreInfo(this._config.pressure));
    $("info2").addEventListener("click", () => this._moreInfo(this._info2Target));
    $("up").addEventListener("click", () => this._adjust(1));
    $("down").addEventListener("click", () => this._adjust(-1));
    $("mode").addEventListener("click", () => this._modeTap());
  }

  _state(id) {
    return id && this._hass ? this._hass.states[id] : undefined;
  }

  _on(id) {
    const s = this._state(id);
    return !!s && s.state === "on";
  }

  // The area name HA's area_name() would give: the entity's own area, else its device's.
  _areaOf(entityId) {
    const h = this._hass;
    const ent = h.entities && h.entities[entityId];
    if (!ent) return null;
    let areaId = ent.area_id;
    if (!areaId && ent.device_id && h.devices && h.devices[ent.device_id]) areaId = h.devices[ent.device_id].area_id;
    return areaId && h.areas && h.areas[areaId] ? h.areas[areaId].name : null;
  }

  // sensor.delta_temperature holds JSON; a plain area sensor holds the name.
  _winner() {
    const s = this._state(this._config.heating_area);
    if (!s) return null;
    let raw = String(s.state);
    if (raw.startsWith("{")) {
      try {
        raw = String(JSON.parse(raw).area ?? "");
      } catch (err) {
        return null;
      }
    }
    return raw && !BAD.includes(raw.toLowerCase()) && raw.toLowerCase() !== "off" ? raw : null;
  }

  _update() {
    if (!this._el || !this._hass) return;
    const c = this._config;
    const e = this._el;
    const cl = this._state(c.climate);
    if (!cl) {
      e.name.textContent = c.name || c.climate;
      e.status.textContent = "Entity not found";
      return;
    }

    const a = cl.attributes;
    const unavailable = BAD.includes(cl.state);
    const isOff = cl.state === "off";
    const paused = this._on(c.paused);

    const boilerState = this._state(c.boiler);
    const chActive = boilerState ? boilerState.state === "on" : a.hvac_action === "heating";
    const dhw = this._on(c.hot_water);
    const chEnabledState = this._state(c.ch_enabled);
    const chDisabled = !!chEnabledState && chEnabledState.state === "off";

    const winner = this._winner();
    const myArea = this._areaOf(c.climate);
    const mine = !!winner && !!myArea && winner === myArea;
    const callsForHeat = !isOff && Number(a.temperature) > Number(a.current_temperature);

    const pState = this._state(c.pressure);
    const p = pState ? parseFloat(pState.state) : NaN;
    const lowP = !isNaN(p) && p < Number(c.pressure_min);

    // Drop the optimistic value once HA reports it
    if (this._pending !== null && !this._timer && Number(a.temperature) === this._pending) {
      this._pending = null;
      clearTimeout(this._clear);
    }
    const target = this._pending !== null ? this._pending : a.temperature;
    const min = a.min_temp ?? 5;
    const max = a.max_temp ?? 30;

    // Status line: what the boiler is doing, seen from this room.
    let status;
    if (unavailable) status = "Unavailable";
    else if (paused) status = "Paused · garden doors open";
    else if (chActive && mine) status = "Boiler on for this room";
    else if (chActive && winner) status = callsForHeat ? `Boiler on for ${winner} · heating along` : `Boiler on for ${winner}`;
    else if (chActive) status = "Boiler on";
    else if (dhw) status = "Boiler on for hot water";
    else status = isOff ? "Off" : "Boiler idle";

    // Extra line: a room in heat that cannot get heat right now.
    let note = null;
    this._info2Target = null;
    if (!unavailable && !paused && !isOff && chDisabled) {
      note = { icon: "mdi:calendar-clock", text: "Central heating is off by schedule", target: c.ch_enabled };
    }

    let icon = "mdi:fire-off";
    if (lowP) icon = "mdi:fire-alert";
    else if (chActive) icon = "mdi:fire";
    else if (dhw) icon = "mdi:water-boiler";
    this._iconTarget = chActive || !dhw ? c.boiler : c.hot_water;

    e.name.textContent = c.name || a.friendly_name || c.climate;
    e.status.textContent = status;
    e.current.textContent = `${fmt(a.current_temperature)}°`;
    e.target.textContent = `${fmt(target)}°`;
    e.flame.setAttribute("icon", icon);

    if (paused) {
      e.modeIcon.setAttribute("icon", "mdi:pause");
      e.mode.title = "Paused by the garden doors";
    } else {
      e.modeIcon.setAttribute("icon", isOff ? "mdi:radiator-off" : "mdi:radiator");
      e.mode.title = isOff ? "Turn heating on" : "Turn heating off";
    }

    e.info2.classList.toggle("show", !!note);
    if (note) {
      e.info2Icon.setAttribute("icon", note.icon);
      e.info2Text.textContent = note.text;
      this._info2Target = note.target;
    }
    e.warn.classList.toggle("show", lowP);
    e.warnText.textContent = lowP ? `Low CH pressure: ${fmt(p)} bar (min ${fmt(c.pressure_min)})` : "";

    // While paused the pause/resume scripts own the thermostat: a change
    // here would be overwritten by the resume snapshot.
    const locked = unavailable || paused;
    e.down.disabled = locked || isOff || Number(target) <= min;
    e.up.disabled = locked || isOff || Number(target) >= max;
    e.mode.disabled = unavailable;

    const cls = e.card.classList;
    cls.toggle("burning", chActive && !unavailable);
    cls.toggle("dhw", dhw && !chActive && !unavailable);
    cls.toggle("mine", chActive && mine);
    cls.toggle("heat", !isOff && !unavailable && !paused);
    cls.toggle("off", isOff && !paused);
    cls.toggle("paused", paused);
    cls.toggle("alert", lowP);
    cls.toggle("pending", this._pending !== null);
    cls.toggle("unavailable", unavailable);
  }

  _adjust(dir) {
    const cl = this._state(this._config.climate);
    if (!cl) return;
    const a = cl.attributes;
    const step = Number(this._config.step || a.target_temp_step || 0.5);
    const min = a.min_temp ?? 5;
    const max = a.max_temp ?? 30;
    const base = Number(this._pending !== null ? this._pending : (a.temperature ?? min));
    let v = Math.round((base + dir * step) / step) * step;
    v = Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
    this._pending = v;

    // Debounce: one service call after the last tap, so TRV Setpoint Sync
    // runs once instead of once per tap.
    clearTimeout(this._timer);
    clearTimeout(this._clear);
    this._timer = setTimeout(() => {
      this._timer = null;
      this._hass.callService("climate", "set_temperature", {
        entity_id: this._config.climate,
        temperature: v,
      });
      // Fallback if HA never confirms (rejected call, rounding)
      this._clear = setTimeout(() => {
        this._pending = null;
        this._update();
      }, 5000);
      this._update();
    }, 800);
    this._update();
  }

  _modeTap() {
    const c = this._config;
    if (this._on(c.paused)) {
      this._moreInfo(c.paused);
      return;
    }
    const cl = this._state(c.climate);
    if (!cl) return;
    const modes = cl.attributes.hvac_modes || [];
    const onMode = c.on_mode || (modes.includes("heat") ? "heat" : modes.find((m) => m !== "off"));
    this._hass.callService("climate", "set_hvac_mode", {
      entity_id: c.climate,
      hvac_mode: cl.state === "off" ? onMode : "off",
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
  { name: "name", selector: { text: {} } },
  { name: "climate", selector: { entity: { domain: "climate" } } },
  { name: "heating_area", selector: { entity: { domain: ["sensor", "input_text", "input_select"] } } },
  { name: "boiler", selector: { entity: { domain: "binary_sensor" } } },
  { name: "hot_water", selector: { entity: { domain: "binary_sensor" } } },
  { name: "ch_enabled", selector: { entity: { domain: ["switch", "input_boolean"] } } },
  { name: "paused", selector: { entity: { domain: ["input_boolean", "binary_sensor"] } } },
  { name: "pressure", selector: { entity: { domain: "sensor" } } },
  {
    type: "grid", name: "", schema: [
      { name: "pressure_min", selector: { number: { min: 0, max: 3, step: 0.1, mode: "box", unit_of_measurement: "bar" } } },
      { name: "step", selector: { number: { min: 0.1, max: 1, step: 0.1, mode: "box", unit_of_measurement: "°" } } },
    ],
  },
];

const LABELS = {
  name: "Name",
  climate: "Virtual thermostat",
  heating_area: "Winning room (delta temperature or area sensor)",
  boiler: "Central heating active",
  hot_water: "Hot water active",
  ch_enabled: "Central heating enabled",
  paused: "Heating paused (living room)",
  pressure: "CH water pressure",
  pressure_min: "Low pressure threshold",
  step: "Setpoint step",
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
        this._config = ev.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: this._config }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._config;
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
  description: "Room thermostat, setpoint, boiler status, winning room and pressure warning.",
  preview: true,
});

console.info(`%c HEATING-CONTROL-CARD %c ${VERSION} `, "background:#ff5722;color:#fff", "");
