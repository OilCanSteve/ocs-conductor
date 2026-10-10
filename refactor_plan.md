# OCS Conductor Output Port Refactor Plan

## Goal
Refactor the MOD GUI output port markup and CSS so output sockets are anchored and wireable like ocs-channel2port, without requiring large negative offsets or causing clipping.

## Root Cause Summary
- Current ocs-conductor markup uses .mod-pedal-output directly as each socket node with mod-role attributes.
- Working ocs-channel2port pattern uses:
  - one .mod-pedal-output container
  - child .mod-output nodes that carry mod-role and mod-port-symbol
  - inner .mod-pedal-output-image for visual socket image
- Current ocs-conductor CSS also forces .mod-pedal-output to position: static !important and uses large right offset, which likely desynchronizes visual socket location from host anchor assumptions.

## Refactor Strategy
Mirror the host-compatible output pattern used by ocs-channel2port, then remove compensating layout hacks.

## Step-by-Step Plan

### 1. Snapshot Current State
- Save a backup copy of:
  - source/modgui/icon-ocs-conductor.html
  - source/modgui/stylesheet-ocs-conductor.css
- Keep this backup for quick rollback after each incremental test.

### 2. Refactor Output Markup Structure
- In source/modgui/icon-ocs-conductor.html:
  - Keep one .io-row wrapper if desired for local grouping.
  - Replace each direct .mod-pedal-output socket node with host-style output nodes:
    - outer container: .mod-pedal-output
    - per-port children: .mod-output mod-output-disconnected
    - per-port attributes on .mod-output:
      - mod-role="output-midi-port"
      - mod-port-symbol="MidiOutput" and "SysExOutput"
    - inner visual child per output: .mod-pedal-output-image
- Resulting shape should match channel2port semantics:
  - container class for output lane
  - child output endpoint elements for wire anchoring

### 3. Remove Conflicting Socket Overrides
- In source/modgui/stylesheet-ocs-conductor.css remove/avoid these hacks:
  - forcing .io-row .mod-pedal-output to position: static !important
  - large negative right values used only to compensate for mis-anchoring
  - temporary debug border/background used for diagnosis
- Keep socket positioning as close as possible to host defaults unless absolutely necessary.

### 4. Reduce Clipping Constraints on Socket Lane
- Verify whether output lane needs to extend outside content area.
- If yes, adjust clipping carefully:
  - consider removing overflow: hidden from one ancestor only (prefer .conductor-shell first) while preserving overall UI containment
  - do not remove both overflow constraints unless required
- Keep this change minimal and reversible.

### 5. Reposition Output Lane with Small Offsets
- After structural refactor, position the output lane near the right edge using small offsets only.
- Target: right offset magnitude should be small (for example near 0 to low negative single digits), not extreme values like -80px.

### 6. Validate Cable Anchor Alignment
- In MOD host UI, test both outputs:
  - socket visual center aligns with cable start point
  - no visible empty gap between socket graphic and cable
  - both ports remain independently wireable

### 7. Regression Check
- Confirm these remain unchanged:
  - all control ports and state viewport controls
  - bypass switch/light behavior
  - import JSON behavior
  - overall panel dimensions and typography

### 8. Final Cleanup
- Remove temporary diagnostics:
  - debug background colors on output lane
  - debug borders
- Re-run native sync and verify final visuals against ocs-channel2port behavior.

## Acceptance Criteria
- Both MidiOutput and SysExOutput are visible at the right edge.
- Both are easy to connect with no awkward cable gap.
- No severe clipping of socket graphics.
- No large compensating offset required.
- No regressions in other UI controls.

## Suggested Implementation Order
1. Markup structure change.
2. Remove static/negative hack CSS.
3. Minimal right-edge positioning.
4. Clipping adjustment only if still needed.
5. Visual and wiring validation.
