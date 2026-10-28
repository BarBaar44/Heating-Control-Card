# Changelog

## v0.9.0

### Added
* **Waiting for heat:** a room with "Drives the heat source" turned off in Cloudless Multiroom Thermostat (v1.1.0 or later, for example a hallway) shows "Waiting for heat" while it is below target and no other room needs heat. It is a dimmed grey with an hourglass, calmer than "Calls for heat", because nothing is heating it. It used to show "Calls for heat", which was wrong: the boiler is not asked for anything.
* **Header with a waiting room:** a waiting room never counts as demand. With nothing else heating the header says "Heating off" and the line under it "Boiler idle · Hallway waiting" (or "2 rooms waiting").
* **Header for a room that calls for heat** before the boiler has started for it: "Office calls for heat" instead of "All rooms at target".
* **Tests:** `npm test` runs jsdom tests for the room roles, the header texts, the YAML setup and batched taps, also in the Validate workflow.

### Changed
* **Room roles come from the integration:** with integration rooms each row now follows the room's own `role` attribute (winner, heating along, calls for heat, waiting, reached) instead of working it out in the card. The card and the integration always agree, also when an eco preset lowers a room's target. With an integration older than v1.1.0, or the YAML setup, the card works the roles out itself as before.
* **Paused rooms:** the Heat/Off button of a paused room keeps its grey background, so it is visible.
* **README:** the example with several rooms has a third card with the hallway waiting, and the YAML setup points to thermostat v1.1.0, the last version that has it.

## v0.8.0

### Changed
* **Cloudless Multiroom Thermostat rooms by default:** without a `thermostats` list the card shows the integration's room climates and only falls back to `climate.virtual_thermostat_*` when there are none. The winner comes from the room's `is_winner` attribute, so `heating_area` is not needed, and rows are named after the room.
* **Paused rooms:** a room the integration holds off says why: "Paused · window open", "Paused · nobody home" or "Paused". The row stays editable, since the integration keeps the room's target.
* **Header:** "Heating off · nobody home" when every heating room is away, "Heating paused" when every heating room is held off.
* **Narrow cards:** room names and roles get more room; long roles end in an ellipsis instead of overlapping.
* The YAML setup keeps working unchanged.

### Added
* README example with several rooms, and a single card image for the thermostat README.
