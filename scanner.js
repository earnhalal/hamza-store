/*
 * Hamza Departmental Store — real camera barcode/QR scanner
 * ---------------------------------------------------------
 * - getUserMedia live camera (phone rear camera preferred,
 *   laptop webcam works too — HTTPS or localhost required by browsers)
 * - BarcodeDetector where available (Chrome/Android, most laptops)
 * - jsQR fallback decoding from a canvas (needs jsQR CDN global)
 * - Scanner-gun / keyboard-wedge support: guns type the code + Enter,
 *   captured by the manual entry field in the overlay
 * - Type-the-code fallback always available
 *
 * Usage:
 *   HamzaScanner.open({
 *     title: "Scan barcode / QR",
 *     continuous: true,              // keep scanning after each hit
 *     onCode: function(code) {...},  // return false to reject & keep scanning
 *     onClose: function() {...}
 *   });
 */
(function () {
  "use strict";

  var overlay = null, video = null, stream = null, rafId = null;
  var detector = null, running = false, opts = null;
  var lastCode = "", lastAt = 0, busy = false;

  function build() {
    overlay = document.createElement("div");
    overlay.className = "scanner-overlay";
    overlay.innerHTML =
      '<div class="scanner-box">' +
        '<div class="scanner-head"><strong id="scTitle">Scan</strong>' +
        '<button type="button" class="btn btn-ghost" id="scClose">Close</button></div>' +
        '<div class="scanner-view"><video id="scVideo" playsinline muted></video>' +
        '<div class="scanner-frame"></div></div>' +
        '<p class="scanner-status" id="scStatus">Starting camera…</p>' +
        '<div class="scanner-manual">' +
          '<input id="scManual" type="text" inputmode="text" autocomplete="off" ' +
            'placeholder="Or type / scanner-gun the code, then Enter">' +
          '<button type="button" class="btn" id="scManualBtn">Add</button>' +
        '</div>' +
        '<label class="scanner-cont"><input type="checkbox" id="scCont"> Keep scanning (rapid mode)</label>' +
      "</div>";
    document.body.appendChild(overlay);
    video = overlay.querySelector("#scVideo");
    overlay.querySelector("#scClose").addEventListener("click", close);
    var manual = overlay.querySelector("#scManual");
    var submitManual = function () {
      var v = manual.value.trim();
      if (v) { manual.value = ""; deliver(v); }
    };
    overlay.querySelector("#scManualBtn").addEventListener("click", submitManual);
    manual.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submitManual(); }
    });
    overlay.querySelector("#scCont").addEventListener("change", function (e) {
      if (opts) { opts.continuous = e.target.checked; }
    });
  }

  function setStatus(msg) {
    var el = overlay && overlay.querySelector("#scStatus");
    if (el) { el.textContent = msg; }
  }

  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { return; }
      var ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = 1200; gain.gain.value = 0.06;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.09);
      setTimeout(function () { ctx.close(); }, 200);
    } catch (e) { /* sound is optional */ }
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
  }

  function deliver(code) {
    var now = Date.now();
    if (code === lastCode && now - lastAt < 2500) { return; } // de-bounce repeats
    lastCode = code; lastAt = now;
    if (busy || !opts || typeof opts.onCode !== "function") { return; }
    busy = true;
    beep();
    var keep = opts.continuous;
    var result;
    try { result = opts.onCode(code); } catch (e) { result = null; }
    Promise.resolve(result).then(function () {
      busy = false;
      if (!overlay) { return; }
      if (!keep) { close(); }
      else { setStatus("Scanned: " + code + " — ready for the next item."); }
    });
  }

  function tick() {
    if (!running) { return; }
    if (detector) {
      detector.detect(video).then(function (codes) {
        if (codes && codes.length && codes[0].rawValue) { deliver(String(codes[0].rawValue)); }
        if (running) { rafId = requestAnimationFrame(tick); }
      }).catch(function () { if (running) { rafId = requestAnimationFrame(tick); } });
      return;
    }
    // jsQR fallback
    if (video.readyState === video.HAVE_ENOUGH_DATA && typeof window.jsQR === "function") {
      var canvas = tick._canvas || (tick._canvas = document.createElement("canvas"));
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      if (canvas.width > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var found = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (found && found.data) { deliver(String(found.data)); }
      }
    }
    if (running) { rafId = requestAnimationFrame(tick); }
  }

  function open(options) {
    opts = options || {};
    if (!overlay) { build(); }
    overlay.style.display = "flex";
    overlay.querySelector("#scTitle").textContent = opts.title || "Scan barcode / QR";
    overlay.querySelector("#scCont").checked = !!opts.continuous;
    lastCode = ""; busy = false;
    setStatus("Starting camera…");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Camera is not available in this browser/context (HTTPS is required). You can still type the code below.");
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }, audio: false
    }).then(function (s) {
      stream = s;
      video.srcObject = s;
      return video.play();
    }).then(function () {
      detector = null;
      if (typeof window.BarcodeDetector === "function") {
        try {
          detector = new window.BarcodeDetector({
            formats: ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"]
          });
        } catch (e) { detector = null; }
      }
      running = true;
      setStatus(detector ? "Point the camera at the barcode or QR code."
        : "Point the camera at the code (using the QR fallback decoder).");
      tick();
    }).catch(function () {
      setStatus("Camera permission was not given, or no camera was found. You can still type / scanner-gun the code below.");
    });
  }

  function close() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (overlay) { overlay.style.display = "none"; }
    if (opts && typeof opts.onClose === "function") { opts.onClose(); }
    opts = null;
  }

  window.HamzaScanner = { open: open, close: close };
})();
