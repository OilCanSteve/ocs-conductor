function handleEvent(event, funcs) {
  if (typeof window !== "undefined" && typeof window.__ocsConductorDispatch === "function") {
    return window.__ocsConductorDispatch(event, funcs);
  }
}

function event_handler(event, funcs) {
  return handleEvent(event, funcs);
}

function handle_event(event, funcs) {
  return handleEvent(event, funcs);
}

(function () {
  var TOTAL_STATES = 16;
  var cachedFuncs = null;

  function getSpinnerRange(symbol) {
    if (/^bits_change_\d+$/.test(symbol)) {
      return { min: 0, max: 127, step: 1 };
    }
    if (/^cc_a_change_\d+$/.test(symbol) || /^cc_b_change_\d+$/.test(symbol)) {
      return { min: -1, max: 127, step: 1 };
    }
    if (/^ccnum_4_bit_[1-7]$/.test(symbol)) {
      return { min: -1, max: 127, step: 1 };
    }
    if (symbol === "cc_a_num" || symbol === "cc_b_num") {
      return { min: -1, max: 127, step: 1 };
    }
    if (symbol === "MidiChannel") {
      return { min: 0, max: 15, step: 1 };
    }
    if (symbol === "OverFlowBase") {
      return { min: 1, max: 15, step: 1 };
    }
    if (symbol === "InternalSysExId" || symbol === "SysExPacketId") {
      return { min: 0, max: 127, step: 1 };
    }
    return { min: 0, max: 127, step: 1 };
  }

  function normalizeSpinnerValue(rawValue, range) {
    var n = Number(rawValue);
    if (!Number.isFinite(n)) {
      return null;
    }
    n = Math.round(n);
    if (n < range.min) {
      n = range.min;
    }
    if (n > range.max) {
      n = range.max;
    }
    return n;
  }

  function bindSpinnerControl(control, symbol, range, root) {
    var spinner = control.querySelector(".spinner-input");
    if (!spinner) {
      spinner = document.createElement("input");
      spinner.type = "number";
      spinner.className = "spinner-input";
      control.appendChild(spinner);
    }

    spinner.min = String(range.min);
    spinner.max = String(range.max);
    spinner.step = String(range.step);
    spinner.value = String(range.min);

    // Prevent MOD's knob drag handlers on the parent node from stealing input gestures.
    var stopBubble = function (e) {
      e.stopPropagation();
    };
    spinner.addEventListener("pointerdown", stopBubble);
    spinner.addEventListener("mousedown", stopBubble);
    spinner.addEventListener("touchstart", stopBubble);
    spinner.addEventListener("click", stopBubble);

    var submitValue = function () {
      var normalized = normalizeSpinnerValue(spinner.value, range);
      if (normalized == null) {
        return;
      }

      spinner.value = String(normalized);
      try {
        setPortValue(symbol, normalized, null);
        updateKnobValueDisplay(symbol, normalized);
      } catch (err) {
        if (root) {
          setStatus(root, "Control update failed: " + err.message, true);
        }
      }
    };

    spinner.addEventListener("change", submitValue);
    spinner.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        submitValue();
      }
    });
  }

  function setStatus(root, text, isError) {
    var status = root.querySelector("#import-status");
    if (!status) {
      return;
    }
    status.textContent = text;
    status.style.color = isError ? "#ff8f8f" : "#bde8c5";
  }

  function updateEventDebug(root, event) {
    var debug = root.querySelector("#event-debug");
    if (!debug) {
      return;
    }

    if (!event) {
      debug.textContent = "event: (none)";
      return;
    }

    var type = event.type || "(no-type)";
    var symbol = event.symbol || event.port || event.name || "-";
    var value = event.value == null ? "-" : String(event.value);
    var portsLen = Array.isArray(event.ports) ? String(event.ports.length) : "-";
    var valuesKeys = event.values && typeof event.values === "object" ? String(Object.keys(event.values).length) : "-";

    debug.textContent = "event=" + type + " symbol=" + symbol + " value=" + value + " ports=" + portsLen + " valuesKeys=" + valuesKeys;
  }

  function getHostFuncs(providedFuncs) {
    if (providedFuncs && typeof providedFuncs.set_port_value === "function") {
      cachedFuncs = providedFuncs;
      return providedFuncs;
    }
    if (cachedFuncs && typeof cachedFuncs.set_port_value === "function") {
      return cachedFuncs;
    }
    if (window.funcs && typeof window.funcs.set_port_value === "function") {
      cachedFuncs = window.funcs;
      return cachedFuncs;
    }
    return null;
  }

  function setPortValue(symbol, value, providedFuncs) {
    var funcs = getHostFuncs(providedFuncs);
    if (!funcs) {
      throw new Error("MOD host API unavailable");
    }
    funcs.set_port_value(symbol, value);
  }

  function toDisplayValue(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return "-";
    }
    return String(Math.round(n));
  }

  function updateKnobValueDisplay(symbol, value) {
    var controls = document.querySelectorAll('.ocs-conductor [mod-role="input-control-port"][mod-port-symbol="' + symbol + '"]');
    if (!controls.length) {
      return;
    }

    var shownValue = toDisplayValue(value);
    for (var i = 0; i < controls.length; i++) {
      controls[i].setAttribute("data-value", shownValue);
      controls[i].setAttribute("title", symbol + ": " + shownValue);
      var readout = controls[i].querySelector(".knob-readout");
      if (readout) {
        readout.textContent = shownValue;
      }

      var spinner = controls[i].querySelector(".spinner-input");
      if (spinner && shownValue !== "-") {
        spinner.value = shownValue;
      }
    }
  }

  function isBitCcSymbol(symbol) {
    return /^ccnum_4_bit_[1-7]$/.test(symbol);
  }

  function initKnobValueDisplay(root) {
    var controls = root.querySelectorAll('[mod-role="input-control-port"][mod-port-symbol]');
    for (var i = 0; i < controls.length; i++) {
      var symbol = controls[i].getAttribute("mod-port-symbol") || "";
      var range = getSpinnerRange(symbol);
      controls[i].setAttribute("data-value", "-");
      controls[i].setAttribute("title", symbol + ": -");

      controls[i].classList.add("spinner-control");
      controls[i].classList.remove("readout-above");
      controls[i].classList.remove("readout-right");
      bindSpinnerControl(controls[i], symbol, range, root);

      var readout = controls[i].querySelector(".knob-readout");
      if (readout && readout.parentNode) {
        readout.parentNode.removeChild(readout);
      }
    }
  }

  function applyEventPortList(ports) {
    if (!Array.isArray(ports)) {
      return;
    }
    for (var i = 0; i < ports.length; i++) {
      if (!ports[i]) {
        continue;
      }
      var symbol = ports[i].symbol || ports[i].port || ports[i].name;
      var value = ports[i].value;
      if (symbol != null && value != null) {
        updateKnobValueDisplay(String(symbol), value);
      }
    }
  }

  function applyEventValueMap(values) {
    if (!values || typeof values !== "object") {
      return;
    }
    for (var symbol in values) {
      if (!Object.prototype.hasOwnProperty.call(values, symbol)) {
        continue;
      }
      updateKnobValueDisplay(symbol, values[symbol]);
    }
  }

  function applySingleEventValue(event) {
    if (!event || typeof event !== "object") {
      return;
    }
    var symbol = event.symbol || event.port || event.name;
    var value = event.value;
    if (symbol != null && value != null) {
      updateKnobValueDisplay(String(symbol), value);
    }
  }

  function clampInt(value, min, max) {
    var n = Number(value);
    if (!Number.isInteger(n)) {
      throw new Error("Value is not an integer");
    }
    if (n < min || n > max) {
      throw new Error("Value " + n + " out of range " + min + ".." + max);
    }
    return n;
  }

  function parseTripletArray(text) {
    var parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON root must be an array");
    }
    if (parsed.length > TOTAL_STATES) {
      throw new Error("Array can contain at most 16 items");
    }

    var out = [];
    for (var i = 0; i < parsed.length; i++) {
      var row = parsed[i];
      if (!Array.isArray(row) || row.length !== 3) {
        throw new Error("Item " + (i + 1) + " must be a triplet [bits, cc_a, cc_b]");
      }
      out.push([
        clampInt(row[0], 0, 127),
        clampInt(row[1], -1, 127),
        clampInt(row[2], -1, 127),
      ]);
    }

    while (out.length < TOTAL_STATES) {
      out.push([0, 0, 0]);
    }
    return out;
  }

  function applyTriplets(triplets, providedFuncs) {
    for (var i = 0; i < TOTAL_STATES; i++) {
      var n = i + 1;
      setPortValue("bits_change_" + n, triplets[i][0], providedFuncs);
      setPortValue("cc_a_change_" + n, triplets[i][1], providedFuncs);
      setPortValue("cc_b_change_" + n, triplets[i][2], providedFuncs);
    }
  }

  function renderStateList(root) {
    var status = root.querySelector("#viewport-status");
    if (status) {
      status.textContent = "Showing all " + TOTAL_STATES + " states";
    }
  }

  function bindImportButton(root) {
    var button = root.querySelector("#import-btn");
    var textarea = root.querySelector("#json-import");

    if (!button || !textarea) {
      return;
    }

    button.addEventListener("click", function () {
      try {
        var triplets = parseTripletArray(textarea.value.trim());
        applyTriplets(triplets, null);
        setStatus(root, "Import complete: loaded " + TOTAL_STATES + " states.", false);
      } catch (err) {
        setStatus(root, "Import failed: " + err.message, true);
      }
    });
  }

  function handleHostEvent(event, funcs) {
    if (funcs && typeof funcs.set_port_value === "function") {
      cachedFuncs = funcs;
    }

    if (!event) {
      return;
    }

    var roots = document.querySelectorAll(".ocs-conductor");
    for (var r = 0; r < roots.length; r++) {
      updateEventDebug(roots[r], event);
    }

    if (event.type === "start") {
      setupDom();
      var startRoots = document.querySelectorAll(".ocs-conductor");
      for (var i = 0; i < startRoots.length; i++) {
        renderStateList(startRoots[i]);
      }

      applyEventPortList(event.ports);
      applyEventValueMap(event.values);
      applySingleEventValue(event);
      return;
    }

    applyEventPortList(event.ports);
    applyEventValueMap(event.values);
    applySingleEventValue(event);
  }

  function setupRoot(root) {
    if (root._ocsSetupDone) {
      return;
    }
    updateEventDebug(root, null);
    initKnobValueDisplay(root);
    bindImportButton(root);
    renderStateList(root);
    root._ocsSetupDone = true;
  }

  function setupDom() {
    var roots = document.querySelectorAll(".ocs-conductor");
    if (!roots.length) {
      return;
    }
    for (var i = 0; i < roots.length; i++) {
      setupRoot(roots[i]);
    }
  }

  function kickstartBinding() {
    var attempts = 0;
    var maxAttempts = 40;
    var timer = setInterval(function () {
      attempts += 1;
      setupDom();
      var roots = document.querySelectorAll(".ocs-conductor");
      for (var i = 0; i < roots.length; i++) {
        if (roots[i]._ocsSetupDone) {
          clearInterval(timer);
          return;
        }
      }
      if (attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupDom);
  } else {
    setupDom();
  }
  kickstartBinding();

  // Register common callback names used by MOD custom GUI loaders.
  window.__ocsConductorDispatch = handleHostEvent;
  window.OCSConductorModGui = handleHostEvent;
  window.ocsConductorModGui = handleHostEvent;
  window.handleEvent = handleHostEvent;
  window.event_handler = handleHostEvent;
  window.handle_event = handleHostEvent;
})();
