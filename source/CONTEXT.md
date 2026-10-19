# ocs-conductor — Plugin Context Document

## Overview

**ocs-conductor** is an LV2 MIDI plugin that sends a fixed set of MIDI CC messages whenever a "state trigger" control port changes value. It is purely an output plugin: it receives no audio or MIDI input, only control-rate parameters, and emits MIDI CC events on its output atom port.

The fundamental idea is that the plugin holds **16 named states** (indexed 0–15 internally, 1–16 as seen by the trigger). When the trigger changes to a new value, the plugin fires the MIDI messages corresponding to that state.

---

## Port Map

| Index | Symbol              | Description |
|-------|---------------------|-------------|
| 0     | `MidiOutput`        | Atom sequence output — carries MIDI CC events |
| 1     | `MidiChannel`       | MIDI channel to use for all outgoing messages (0–15) |
| 2     | `EnactChangesOnly`  | When non-zero, bit messages are only sent when a bit's value differs from the previous state |
| 3     | `state_trigger`     | The state-selection trigger (0 = idle; 1–16 = state 1–16; values >16 wrap via `ReturnPoint`) |
| 4     | `cc_a_num`          | CC number for the "free" CC-A message (-1 = disabled) |
| 5     | `cc_b_num`          | CC number for the "free" CC-B message (-1 = disabled) |
| 6–12  | `ccnum_4_bit_1..7`  | CC numbers for the 7 individual bit messages (-1 = disabled for that bit) |
| 13    | `ReturnPoint`       | When trigger values exceed 16, this sets the base state (1–15) for the wrap-around cycle |
| 14    | `SysExOutput`       | Atom sequence output — carries a proprietary SysEx summary packet |
| 15    | `SysExPacketId`     | Developer-defined SysEx tag byte embedded in every packet (`0..127`, default `0`); always present, no legacy/disabled state |
| 16–18 | `bits_change_1`, `cc_a_change_1`, `cc_b_change_1` | State 1 data |
| 19–21 | `bits_change_2`, `cc_a_change_2`, `cc_b_change_2` | State 2 data |
| 22–24 | `bits_change_3`, `cc_a_change_3`, `cc_b_change_3` | State 3 data |
| 25–27 | `bits_change_4`, `cc_a_change_4`, `cc_b_change_4` | State 4 data |
| 28–30 | `bits_change_5`, `cc_a_change_5`, `cc_b_change_5` | State 5 data |
| 31–33 | `bits_change_6`, `cc_a_change_6`, `cc_b_change_6` | State 6 data |
| 34–36 | `bits_change_7`, `cc_a_change_7`, `cc_b_change_7` | State 7 data |
| 37–39 | `bits_change_8`, `cc_a_change_8`, `cc_b_change_8` | State 8 data |
| 40–42 | `bits_change_9`, `cc_a_change_9`, `cc_b_change_9` | State 9 data |
| 43–45 | `bits_change_10`, `cc_a_change_10`, `cc_b_change_10` | State 10 data |
| 46–48 | `bits_change_11`, `cc_a_change_11`, `cc_b_change_11` | State 11 data |
| 49–51 | `bits_change_12`, `cc_a_change_12`, `cc_b_change_12` | State 12 data |
| 52–54 | `bits_change_13`, `cc_a_change_13`, `cc_b_change_13` | State 13 data |
| 55–57 | `bits_change_14`, `cc_a_change_14`, `cc_b_change_14` | State 14 data |
| 58–60 | `bits_change_15`, `cc_a_change_15`, `cc_b_change_15` | State 15 data |
| 61–63 | `bits_change_16`, `cc_a_change_16`, `cc_b_change_16` | State 16 data |

The state data ports are laid out consecutively in groups of three: `(bits, cc_a, cc_b)` × 16. The `connect_port` function maps them using integer division/modulo on `(port - STATE_DATA_START)`.

---

## State Data Per State

Each of the 16 states carries three values:

### `bits_change_n` — 7-bit integer → 7 individual bit CC messages

This is a 7-bit integer (0–127). At trigger time the plugin unpacks it into 7 boolean bits (bit 0 = LSB … bit 6 = MSB). For each bit:

- If the bit is **1**, the corresponding CC message is sent with value **127**.
- If the bit is **0**, the corresponding CC message is sent with value **0**.

The CC number for bit `i` (0-indexed) is taken from the `ccnum_4_bit_{i+1}` port (ports 6–12). Setting any of those CC-number ports to **-1** disables that bit entirely — no message is sent for it.

**`EnactChangesOnly` mode:** When this port is non-zero, a bit message is only fired if the bit's value differs from the same bit in the *previous* state that was triggered. The plugin stores the last emitted bit array in `last_bit_array[7]` and compares before sending.

Default values in the TTL give a useful ladder:
| State | `bits_change_n` default | Binary meaning |
|-------|------------------------|----------------|
| 1 | 1   | only bit 0 set |
| 2 | 3   | bits 0–1 set   |
| 3 | 7   | bits 0–2 set   |
| 4 | 15  | bits 0–3 set   |
| 5 | 31  | bits 0–4 set   |
| 6 | 63  | bits 0–5 set   |
| 7 | 127 | all 7 bits set |
| 8 | 0   | no bits set    |
| 9–16 | 0 | no bits set |

### `cc_a_change_n` — free CC-A value

A plain 7-bit value (0–127) sent on the CC number specified by `cc_a_num`. A value of **-1** disables the message for that state. The CC number port `cc_a_num` being **-1** also disables it globally.

### `cc_b_change_n` — free CC-B value

Identical logic to `cc_a_change_n`, but using CC number `cc_b_num`.

---

## Trigger & State Selection Logic (`run`)

1. Each audio cycle the plugin compares `*state_trigger` (cast to `uint8_t`) against its stored `curr_trigger_val`.
2. If they differ, `curr_trigger_val` is updated and state dispatch begins.
3. A trigger value of **0** is the idle/reset state — the plugin simply returns without sending anything.
4. Trigger values **1–16** map directly to states **0–15** (zero-indexed internally: `ctv = trigger - 1`).
5. Trigger values **> 16** wrap cyclically using `ReturnPoint`:
   - `base_index = ReturnPoint - 1` (clamped 0–14).
   - The cycle covers states `[base_index, 15]`, length = `16 - base_index`.
   - `ctv = base_index + ((trigger - 16 - 1) % cycle_len)` (approximated).
   - This allows indefinite incremental triggering that cycles through a sub-range of states.

---

## MIDI Output

### CC messages (`MidiOutput`, port 0)

All MIDI CC messages are standard 3-byte Control Change events on the configured `MidiChannel`. They are written into the output atom sequence at frame offset 0 (all events land at the start of the processing block).

Order of emission per trigger:
1. Up to 7 bit-derived CC messages (bits 0–6 of `bits_change_n`).
2. One CC-A message (if both `cc_a_num` and `cc_a_change_n` are ≥ 0).
3. One CC-B message (if both `cc_b_num` and `cc_b_change_n` are ≥ 0).

### SysEx summary packet (`SysExOutput`, port 14)

On every trigger (including wrap-around states), the plugin emits a proprietary SysEx packet on a separate output port. There is a single fixed 8-byte format, unconditional on the value of `SysExPacketId`:

```
F0  7D  <sysex_packet_id>  <state_index>  <bits_change_n>  <cc_a_change_n>  <cc_b_change_n>  F7
```

- `0xF0` / `0xF7` — standard SysEx start/end bytes.
- `0x7D` — non-commercial / experimental manufacturer ID.
- Byte 2 is `(uint8_t) SysExPacketId` — a developer-defined tag (default `0`) that lets a receiver distinguish this message from other SysEx traffic sharing the same manufacturer ID. It carries no other special meaning (there is no "disabled"/legacy sentinel value any more).
- The remaining 4 payload bytes (`state_index`, `bits_change_n`, `cc_a_change_n`, `cc_b_change_n`) are assembled into a local array and copied into the packet in one step, avoiding duplicated per-branch assignment logic.

See [`sysex.py`](sysex.py) for an example CircuitPython receiver that keys off `SysExPacketId` before processing the rest of the payload.

---

## Internal State

| Field | Type | Purpose |
|-------|------|---------|
| `curr_trigger_val` | `int` | Tracks the last seen trigger value to detect changes |
| `last_bit_array[7]` | `bool[7]` | Stores the 7 bit values sent in the most recent trigger, used by `EnactChangesOnly` |

## Presets

The plugin bundle currently defines one developer preset:

- **Identity (n=n)**: for states 1–16, all three values `bits_change_n`, `cc_a_change_n`, and `cc_b_change_n` are set to `n`.

This is exposed as an LV2 `pset:Preset` and can be used for straightforward runtime verification in hosts such as `jalv`.

---

## Conditional Compilation

A debug macro `ORCH_DEBUG` (default 0) controls verbose `stderr` logging via `ORCH_DEBUGF`. Setting `ORCH_DEBUG=1` at compile time causes the plugin to print trigger mapping, state selection, and individual CC values for each run cycle in which a trigger fires.

---

## File Structure

| File | Role |
|------|------|
| `ocs-conductor.c` | Plugin implementation — instantiate, connect_port, run, sendMidiCCMessages, sysExOut, fireMidiEvent |
| `ocs-conductor.ttl` | LV2 plugin descriptor — declares all 64 ports with ranges, defaults, types, and one preset |
| `manifest.ttl` | LV2 bundle manifest — registers the plugin URI and TTL |
| `uris.h` | Defines `conductorURIs` struct and `map_conductor_uris()` helper for URID mapping |
| `sysex.py` | Example CircuitPython SysEx receiver matching the plugin's 8-byte packet format |
| `Makefile` | Build system |
