(function () {
  var TOTAL_STATES = 16;
  var cachedFuncs = null;

  function setStatus(root, text, isError) {
    var status = root.querySelector("#import-status");
    if (!status) {
      return;
    }
    status.textContent = text;
    status.style.color = isError ? "#ff8f8f" : "#bde8c5";
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
        clampInt(row[1], 0, 127),
        clampInt(row[2], 0, 127),
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

    if (event.type === "start") {
      setupDom();
      var roots = document.querySelectorAll(".ocs-conductor");
      for (var i = 0; i < roots.length; i++) {
        renderStateList(roots[i]);
      }
    }
  }

  function setupRoot(root) {
    if (root._ocsSetupDone) {
      return;
    }
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
  window.OCSConductorModGui = handleHostEvent;
  window.ocsConductorModGui = handleHostEvent;
  window.event_handler = handleHostEvent;
  window.handle_event = handleHostEvent;
})();
