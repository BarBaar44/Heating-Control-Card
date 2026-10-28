// Tests for heating-control-card.js in a simulated browser. Run: npm test
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.eval(fs.readFileSync(path.join(__dirname, "..", "heating-control-card.js"), "utf8"));
const Card = w.customElements.get("heating-control-card");
assert(Card, "registered");

const INT = "cloudless_multiroom_thermostat";
const B = {
  boiler: "binary_sensor.main_thermostat_central_heating_active",
  dhw: "binary_sensor.main_thermostat_domestic_hot_water_active",
  flame: "binary_sensor.diyless_thermostat_flame_on",
  mod: "sensor.thermostat_relative_modulation_level",
  ch: "switch.main_thermostat_central_heating_enabled",
  fault: "binary_sensor.main_thermostat_fault_indication",
  pressure: "sensor.thermostat_water_pressure_in_ch_circuit",
  delta: "sensor.delta_temperature",
  garden: "input_boolean.garden_heating_paused",
};
const st = (state, attributes = {}) => ({ state: String(state), attributes });

/* Boiler entities: mode "idle", "heating", "pumping", "dhw", "dhw_ch", "offline". */
function boiler(mode = "idle", o = {}) {
  const on = (b) => st(b ? "on" : "off");
  const off = mode === "offline";
  return {
    [B.boiler]: off ? st("unavailable") : on(["heating", "pumping", "dhw_ch"].includes(mode)),
    [B.dhw]: on(mode === "dhw" || mode === "dhw_ch"),
    [B.flame]: off ? st("unavailable") : on(["heating", "dhw", "dhw_ch"].includes(mode)),
    [B.mod]: st(o.mod ?? 40),
    [B.ch]: on(o.ch !== false),
    [B.fault]: on(!!o.fault),
    [B.pressure]: st(o.pressure ?? 1.8),
  };
}

/* A room climate. */
function room(name, cur, tgt, attrs = {}, mode = "heat") {
  return st(mode, {
    friendly_name: name, current_temperature: cur, temperature: tgt,
    hvac_modes: ["off", "heat"], min_temp: 5, max_temp: 30, target_temp_step: 0.5, ...attrs,
  });
}

function hass(states, entities = {}, extra = {}) {
  const calls = [];
  return {
    states, entities, devices: extra.devices || {}, areas: extra.areas || {},
    callService: (d, s, data) => calls.push([d, s, data]), calls,
  };
}
/* Integration rooms: every climate in `rooms` gets the integration platform. */
function intHass(rooms, mode = "idle", o = {}) {
  const entities = Object.fromEntries(Object.keys(rooms).map((id) => [id, { entity_id: id, platform: INT }]));
  return hass({ ...boiler(mode, o), ...rooms, ...(o.extra || {}) }, entities);
}

function render(h, config = {}) {
  const c = new Card();
  w.document.body.appendChild(c);
  c.setConfig(config);
  c.hass = h;
  return c;
}
function read(c) {
  const sr = c.shadowRoot;
  const cls = c._el.card.classList;
  return {
    winner: c._el.winner.textContent,
    sub: c._el.sub.textContent,
    icon: c._el.flame.getAttribute("icon"),
    cls: (k) => cls.contains(k),
    rows: [...sr.querySelectorAll(".row")].map((r) => ({
      name: r.querySelector(".rname").textContent,
      role: r.querySelector(".rtext").textContent,
      icon: r.querySelector(".ricon").getAttribute("icon"),
      cls: (k) => r.classList.contains(k),
      down: r.querySelector(".down").disabled,
    })),
  };
}
const row = (v, name) => v.rows.find((r) => r.name === name);

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log(`ok ${n} ${name}`);
}

/* ---------------- integration rooms ---------------- */

const HALL = "climate.hallway";
const OFFICE = "climate.office";
const LIVING = "climate.living_room";

test("waiting room alone: header Heating off, row Waiting for heat, no demand", () => {
  const v = read(render(intHass({
    [HALL]: room("Hallway", 17.5, 19, { role: "waiting", is_winner: false }),
    [OFFICE]: room("Office", 20.5, 20, { role: "reached", is_winner: false }),
  })));
  assert.strictEqual(v.winner, "Heating off");
  assert.strictEqual(v.sub, "Boiler idle · Hallway waiting");
  assert.strictEqual(v.icon, "mdi:fire-off");
  assert(!v.cls("burning"));
  const h = row(v, "Hallway");
  assert.strictEqual(h.role, "Waiting for heat");
  assert.strictEqual(h.icon, "mdi:timer-sand");
  assert(h.cls("waiting") && !h.cls("win") && !h.cls("along"));
  assert.strictEqual(row(v, "Office").role, "Reached");
});

test("two waiting rooms: count in the sub line", () => {
  const v = read(render(intHass({
    [HALL]: room("Hallway", 17.5, 19, { role: "waiting" }),
    [OFFICE]: room("Office", 18, 20, { role: "waiting" }),
  })));
  assert.strictEqual(v.winner, "Heating off");
  assert.strictEqual(v.sub, "Boiler idle · 2 rooms waiting");
});

test("waiting room heats along once another room wins", () => {
  const v = read(render(intHass({
    [HALL]: room("Hallway", 17.5, 19, { role: "passenger" }),
    [OFFICE]: room("Office", 18, 20, { role: "winner", is_winner: true, effective_target: 20 }),
  }, "heating")));
  assert.strictEqual(v.winner, "Office");
  assert(v.sub.includes("boiler heating"));
  assert.strictEqual(row(v, "Office").role, "Heating");
  const h = row(v, "Hallway");
  assert.strictEqual(h.role, "Heating along");
  assert(h.cls("along") && !h.cls("waiting"));
});

test("passenger while pumping", () => {
  const v = read(render(intHass({
    [HALL]: room("Hallway", 17.5, 19, { role: "passenger" }),
    [OFFICE]: room("Office", 18, 20, { role: "winner", is_winner: true }),
  }, "pumping")));
  assert.strictEqual(row(v, "Office").role, "Pumping");
  assert.strictEqual(row(v, "Hallway").role, "Pumping along");
  assert(!row(v, "Hallway").cls("along"));
});

test("passenger with no boiler activity (switch heat source) still heats along", () => {
  const v = read(render(intHass({
    [HALL]: room("Hallway", 17.5, 19, { role: "passenger" }),
    [OFFICE]: room("Office", 18, 20, { role: "winner", is_winner: true }),
  })));
  assert.strictEqual(row(v, "Hallway").role, "Heating along");
});

test("calls_for_heat without a winner: header names it", () => {
  const v = read(render(intHass({
    [HALL]: room("Hallway", 17.5, 19, { role: "waiting" }),
    [OFFICE]: room("Office", 18, 20, { role: "calls_for_heat" }),
  })));
  assert.strictEqual(v.winner, "Office calls for heat");
  assert.strictEqual(v.sub, "Boiler idle");
  assert.strictEqual(row(v, "Office").role, "Calls for heat");
  assert.strictEqual(row(v, "Hallway").role, "Waiting for heat");
});

test("role follows the integration, not the card's own target test (eco preset)", () => {
  // Below `temperature`, but at its effective (eco) target: the integration says reached.
  const v = read(render(intHass({
    [OFFICE]: room("Office", 18, 20, { role: "reached", effective_target: 17 }),
  }, "heating")));
  assert.strictEqual(row(v, "Office").role, "Reached");
  assert.strictEqual(v.winner, "All rooms at target");
});

test("integration without a role attribute: card works it out (older integration)", () => {
  const v = read(render(intHass({
    [HALL]: room("Hallway", 17.5, 19),
    [OFFICE]: room("Office", 18, 20, { is_winner: true }),
  }, "heating")));
  assert.strictEqual(row(v, "Office").role, "Heating");
  assert.strictEqual(row(v, "Hallway").role, "Heating along");
  const v2 = read(render(intHass({ [HALL]: room("Hallway", 17.5, 19) })));
  assert.strictEqual(row(v2, "Hallway").role, "Calls for heat");
  assert.strictEqual(v2.winner, "All rooms at target");
});

test("unknown role value falls back to the card's own logic", () => {
  const v = read(render(intHass({ [HALL]: room("Hallway", 20, 19, { role: "something_new" }) })));
  assert.strictEqual(row(v, "Hallway").role, "Reached");
});

test("waiting with central heating off by schedule: Heating off, no waiting note", () => {
  const v = read(render(intHass({ [HALL]: room("Hallway", 17.5, 19, { role: "waiting" }) }, "idle", { ch: false })));
  assert.strictEqual(v.winner, "Heating off");
  assert.strictEqual(v.sub, "Boiler idle");
});

test("waiting room during hot water: header Hot water", () => {
  const v = read(render(intHass({ [HALL]: room("Hallway", 17.5, 19, { role: "waiting" }) }, "dhw")));
  assert.strictEqual(v.winner, "Hot water");
  assert.strictEqual(v.icon, "mdi:shower-head");
  assert.strictEqual(row(v, "Hallway").role, "Waiting for heat");
});

test("pauses keep their texts, rows editable; all away", () => {
  const v = read(render(intHass({
    [HALL]: room("Hallway", 17, 19, { role: "paused", paused_reason: "window" }),
    [OFFICE]: room("Office", 17, 20, { role: "paused", paused_reason: "manual" }),
  })));
  assert.strictEqual(row(v, "Hallway").role, "Paused · window open");
  assert.strictEqual(row(v, "Office").role, "Paused");
  assert(!row(v, "Hallway").down);
  assert.strictEqual(v.winner, "Heating paused");
  const v2 = read(render(intHass({ [HALL]: room("Hallway", 17, 19, { role: "paused", paused_reason: "away" }) })));
  assert.strictEqual(v2.winner, "Heating off · nobody home");
  assert.strictEqual(row(v2, "Hallway").role, "Paused · nobody home");
});

test("off room shows Off; only integration climates listed, named after the room", () => {
  const h = intHass({ [HALL]: room("Hallway", 17, 19, { role: "off" }, "off") });
  h.states["climate.virtual_thermostat_attic"] = room("Attic", 15, 18);
  h.states[B.delta] = st(JSON.stringify({ area: "Attic", target: 18, curr: 15, delta: 3 }));
  const v = read(render(h));
  assert.deepStrictEqual(v.rows.map((r) => r.name), ["Hallway"]);
  assert.strictEqual(v.rows[0].role, "Off");
  assert.strictEqual(v.winner, "Heating off");
});

/* ---------------- YAML setup (never sees role) ---------------- */

const VT_LIV = "climate.virtual_thermostat_living_room";
const VT_OFF = "climate.virtual_thermostat_office";
function yamlHass(mode, area, o = {}) {
  const h = hass({
    ...boiler(mode, o),
    [VT_LIV]: room("VT living", 19, 21),
    [VT_OFF]: room("VT office", 20.5, 20),
    [B.delta]: st(JSON.stringify({ area, target: 21, curr: 19, delta: 2 })),
    [B.garden]: st(o.garden ? "on" : "off"),
  }, {
    [VT_LIV]: { entity_id: VT_LIV, area_id: "liv" },
    [VT_OFF]: { entity_id: VT_OFF, area_id: "off" },
  }, { areas: { liv: { name: "Living Room" }, off: { name: "Office" } } });
  return h;
}

test("YAML: heating winner and reached room", () => {
  const v = read(render(yamlHass("heating", "Living Room")));
  assert.strictEqual(v.winner, "Living Room");
  assert(v.sub.includes("boiler heating · 40%"));
  assert.strictEqual(v.icon, "mdi:fire");
  assert(v.cls("burning"));
  assert.strictEqual(row(v, "Living Room").role, "Heating");
  assert.strictEqual(row(v, "Office").role, "Reached");
});

test("YAML: pumping, idle, no winner below target", () => {
  assert.strictEqual(row(read(render(yamlHass("pumping", "Living Room"))), "Living Room").role, "Pumping");
  const v = read(render(yamlHass("idle", "Off")));
  assert.strictEqual(v.winner, "All rooms at target");
  assert.strictEqual(row(v, "Living Room").role, "Calls for heat");
});

test("YAML: hot water + CH, offline, fault, pressure, schedule off, garden pause", () => {
  assert.strictEqual(read(render(yamlHass("dhw_ch", "Off"))).winner, "Hot water");
  const off = read(render(yamlHass("offline", "Living Room")));
  assert.strictEqual(off.winner, "Thermostat offline");
  assert.strictEqual(off.icon, "mdi:lan-disconnect");
  const f = read(render(yamlHass("idle", "Off", { fault: true })));
  assert.strictEqual(f.winner, "Boiler fault");
  assert(f.cls("fault"));
  assert.strictEqual(read(render(yamlHass("idle", "Off", { pressure: 1.1 }))).icon, "mdi:fire-alert");
  assert(read(render(yamlHass("idle", "Off", { pressure: 2.9 }))).cls("alert"));
  assert.strictEqual(read(render(yamlHass("idle", "Off", { ch: false }))).winner, "Heating off");
  const g = read(render(yamlHass("idle", "Off", { garden: true })));
  assert.strictEqual(row(g, "Living Room").role, "Paused · garden doors open");
  assert(row(g, "Living Room").down);
});

test("YAML: a stray role attribute is ignored outside the integration", () => {
  const h = yamlHass("idle", "Off");
  h.states[VT_LIV].attributes.role = "waiting";
  assert.strictEqual(row(read(render(h)), "Living Room").role, "Calls for heat");
});

test("legacy climate config and explicit list", () => {
  const v = read(render(yamlHass("heating", "Living Room"), { climate: VT_LIV }));
  assert.deepStrictEqual(v.rows.map((r) => r.name), ["Living Room"]);
  assert(v.cls("single"));
  const v2 = read(render(yamlHass("heating", "Living Room"), { thermostats: [{ entity: VT_OFF, name: "Work" }] }));
  assert.deepStrictEqual(v2.rows.map((r) => r.name), ["Work"]);
});

test("setpoint taps send one batched call", async () => {
  const h = yamlHass("idle", "Off");
  const c = render(h);
  const up = c.shadowRoot.querySelector(".row .up");
  up.click(); up.click(); up.click();
  return new Promise((res) => setTimeout(() => {
    const sets = h.calls.filter(([, s]) => s === "set_temperature");
    assert.strictEqual(sets.length, 1);
    assert.strictEqual(sets[0][2].temperature, 22.5);
    res();
  }, 900));
});

setTimeout(() => {
  console.log(`\n${n} tests passed`);
  process.exit(0);
}, 1500);
