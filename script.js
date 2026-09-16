/* ============================================================
 *  Velostat Square Heatmap Visualizer (Blue -> Cyan -> Green -> Yellow -> Red)
 *  Smooth animated canvas pad with Web Serial API & Auto-Calibration
 * ============================================================ */
(function () {
  'use strict';

  /* --- Config --- */
  const MAX_RAW = 4095;       // ESP32 12-bit ADC max
  const LERP_FACTOR = 0.15;   // Smooth easing

  /* --- State --- */
  let currentTarget = 0;      // 0.0 - 1.0 (from serial or slider)
  let smoothValue   = 0;      // 0.0 - 1.0 (interpolated each frame)
  let rawADC        = 0;
  let peakValue     = 0;

  // Calibration state
  let invertADC     = false;  // Invert reading if voltage drops when pressed
  let calibMin      = 0;      // Lowest recorded ADC
  let calibMax      = 4095;   // Highest recorded ADC
  let isCalibrating = false;

  // Dynamic touch/drag point
  let contactX      = null;   // null = centered
  let contactY      = null;
  let isCanvasDown  = false;

  let serialPort    = null;
  let serialReader  = null;
  let isReading     = false;

  let canvas, ctx;
  let timestamps    = [];

  /* --- Color Palette: Blue (light) -> Cyan -> Green -> Yellow -> Red (heavy) --- */
  const COLOR_STOPS = [
    { pos: 0.00, r: 12,  g: 18,  b: 36  }, // Idle dark surface
    { pos: 0.08, r: 30,  g: 90,  b: 220 }, // Light touch: Deep Blue
    { pos: 0.25, r: 0,   g: 170, b: 255 }, // Light-medium: Vivid Blue/Cyan
    { pos: 0.45, r: 34,  g: 200, b: 94  }, // Medium: Green
    { pos: 0.70, r: 245, g: 190, b: 20  }, // Firm: Yellow
    { pos: 0.88, r: 245, g: 90,  b: 24  }, // Strong: Orange-Red
    { pos: 1.00, r: 235, g: 25,  b: 25  }, // Max: Deep Pure Red
  ];

  function pressureToRGB(t) {
    t = Math.max(0, Math.min(1, t));
    let lo = COLOR_STOPS[0];
    let hi = COLOR_STOPS[COLOR_STOPS.length - 1];

    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
      if (t >= COLOR_STOPS[i].pos && t <= COLOR_STOPS[i + 1].pos) {
        lo = COLOR_STOPS[i];
        hi = COLOR_STOPS[i + 1];
        break;
      }
    }

    const range = hi.pos - lo.pos;
    const factor = range > 0 ? (t - lo.pos) / range : 0;
    return [
      Math.round(lo.r + factor * (hi.r - lo.r)),
      Math.round(lo.g + factor * (hi.g - lo.g)),
      Math.round(lo.b + factor * (hi.b - lo.b)),
    ];
  }

  function pressureDescriptor(p) {
    if (p < 0.03) return 'IDLE (No Touch)';
    if (p < 0.25) return 'LIGHT TOUCH (Blue)';
    if (p < 0.50) return 'MODERATE TOUCH (Cyan / Green)';
    if (p < 0.75) return 'FIRM PRESSURE (Yellow / Orange)';
    return 'MAX PRESSURE (Red)';
  }

  /* ----------------------------------------------------------
   *  Initialization
   * ---------------------------------------------------------- */
  function init() {
    canvas = document.getElementById('pressure-canvas');
    ctx    = canvas.getContext('2d');

    // Check browser compatibility
    if (!('serial' in navigator)) {
      const hint = document.getElementById('serial-hint');
      if (hint) {
        hint.textContent = '⚠ Web Serial not supported in this browser. Use Chrome or Edge.';
        hint.style.color = '#ef4444';
      }
      const btn = document.getElementById('btn-connect');
      if (btn) btn.disabled = true;
    }

    renderLegend();
    bindEvents();
    requestAnimationFrame(renderLoop);
  }

  /* ----------------------------------------------------------
   *  Animation Loop: Smooth Heatmap Rendering
   * ---------------------------------------------------------- */
  function renderLoop() {
    requestAnimationFrame(renderLoop);

    // Exponential smoothing (lerp)
    smoothValue += LERP_FACTOR * (currentTarget - smoothValue);
    if (Math.abs(smoothValue - currentTarget) < 0.0005) {
      smoothValue = currentTarget;
    }

    drawHeatmap();
    updateUIOverlay();
  }

  function drawHeatmap() {
    const w = canvas.width;
    const h = canvas.height;
    const cx = (contactX !== null) ? contactX : w / 2;
    const cy = (contactY !== null) ? contactY : h / 2;
    const p = smoothValue;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw subtle square grid backing (sensor pad feel)
    ctx.fillStyle = '#0e1526';
    ctx.fillRect(0, 0, w, h);

    const gridSize = 40;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 2. Draw radial pressure heatmap bloom
    if (p > 0.005) {
      const rgb = pressureToRGB(p);
      const maxRadius = Math.SQRT2 * (w / 2);
      const currentRadius = Math.max(50, maxRadius * (0.35 + p * 0.65));

      // Multi-stop radial gradient
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, currentRadius);

      // Core center color
      grad.addColorStop(0.0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(0.95, 0.3 + p * 0.7)})`);

      // Mid diffusion
      const midRGB = pressureToRGB(p * 0.65);
      grad.addColorStop(0.45, `rgba(${midRGB[0]}, ${midRGB[1]}, ${midRGB[2]}, ${Math.min(0.7, p * 0.6)})`);

      // Outer falloff
      const outerRGB = pressureToRGB(p * 0.2);
      grad.addColorStop(0.85, `rgba(${outerRGB[0]}, ${outerRGB[1]}, ${outerRGB[2]}, ${p * 0.25})`);
      grad.addColorStop(1.0, `rgba(10, 16, 30, 0)`);

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // 3. Dynamic ripple / pressure contour rings
      const numRings = 3;
      for (let r = 1; r <= numRings; r++) {
        const ringRad = (currentRadius / (numRings + 1)) * r;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRad, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(1 - r / (numRings + 1)) * p * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 4. Center contact point
      ctx.beginPath();
      ctx.arc(cx, cy, 6 + p * 8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + p * 0.6})`;
      ctx.shadowColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // 5. Border glow
    const edgeColor = p > 0.05 ? pressureToRGB(p) : [42, 52, 80];
    ctx.strokeStyle = `rgba(${edgeColor[0]}, ${edgeColor[1]}, ${edgeColor[2]}, ${0.4 + p * 0.6})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  }

  function updateUIOverlay() {
    const p = smoothValue;
    const pct = (p * 100).toFixed(0);
    const badge = document.getElementById('pressure-badge');
    const desc  = document.getElementById('pressure-desc');

    badge.textContent = `${pct}%`;
    desc.textContent  = isCalibrating ? desc.textContent : pressureDescriptor(p);

    if (p > 0.03) {
      const rgb = pressureToRGB(p);
      badge.style.color = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      badge.style.textShadow = `0 0 16px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.6)`;
    } else {
      badge.style.color = 'var(--text-dim)';
      badge.style.textShadow = 'none';
    }
  }

  function updateStats() {
    const now = performance.now();
    while (timestamps.length > 0 && timestamps[0] < now - 2000) {
      timestamps.shift();
    }
    const hz = timestamps.length > 1 ? Math.round(timestamps.length / 2) : 0;

    document.getElementById('stat-raw').textContent  = `${rawADC} / ${MAX_RAW}`;
    document.getElementById('stat-pct').textContent  = `${(currentTarget * 100).toFixed(1)}%`;
    document.getElementById('stat-peak').textContent = `${(peakValue * 100).toFixed(1)}%`;
    document.getElementById('stat-hz').textContent   = serialPort ? `${hz} Hz` : '— Hz';
  }

  setInterval(updateStats, 400);

  /* ----------------------------------------------------------
   *  Legend Bar
   * ---------------------------------------------------------- */
  function renderLegend() {
    const canvas = document.getElementById('legend-canvas');
    if (!canvas) return;
    const lctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const rgb = pressureToRGB(t);
      lctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      lctx.fillRect(x, 0, 1, h);
    }
  }

  /* ----------------------------------------------------------
   *  Web Serial Handling (ESP32 USB)
   * ---------------------------------------------------------- */
  async function connectSerial() {
    if (!('serial' in navigator)) return;

    try {
      serialPort = await navigator.serial.requestPort();
      const baudRate = parseInt(document.getElementById('baud-rate').value, 10);
      await serialPort.open({ baudRate });

      setConnectionStatus('connected');
      isReading = true;
      readSerialLoop();
    } catch (err) {
      if (err.name === 'NotFoundError') {
        setConnectionStatus('disconnected');
      } else {
        console.error('Serial connect error:', err);
        setConnectionStatus('error', err.message);
      }
    }
  }

  async function disconnectSerial() {
    isReading = false;
    if (serialReader) {
      try { await serialReader.cancel(); } catch (_) {}
      serialReader = null;
    }
    if (serialPort) {
      try { await serialPort.close(); } catch (_) {}
      serialPort = null;
    }
    setConnectionStatus('disconnected');
  }

  async function readSerialLoop() {
    const decoder = new TextDecoderStream();
    serialPort.readable.pipeTo(decoder.writable);
    serialReader = decoder.readable.getReader();

    let buffer = '';

    try {
      while (isReading) {
        const { value, done } = await serialReader.read();
        if (done) break;
        if (!value) continue;

        buffer += value;

        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, newlineIdx).trim();
          buffer = buffer.substring(newlineIdx + 1);
          if (line.length > 0) processSerialLine(line);
        }

        if (buffer.length > 4000) {
          buffer = buffer.substring(buffer.length - 400);
        }
      }
    } catch (err) {
      if (isReading) {
        setConnectionStatus('error', 'Read error');
      }
    }
    serialReader.releaseLock();
  }

  function processSerialLine(line) {
    timestamps.push(performance.now());

    let val = parseInt(line, 10);
    if (isNaN(val)) return;

    applyAdcValue(val);
  }

  function applyAdcValue(val) {
    rawADC = val;

    // Normalizing between calibMin and calibMax
    const min = Math.min(calibMin, calibMax);
    const max = Math.max(calibMin, calibMax);
    const span = Math.max(50, max - min);

    let normalized;
    if (invertADC) {
      // High ADC = unpressed, Low ADC = pressed
      normalized = (max - val) / span;
    } else {
      // Low ADC = unpressed, High ADC = pressed
      normalized = (val - min) / span;
    }

    normalized = Math.max(0, Math.min(1.0, normalized));

    currentTarget = normalized;
    if (currentTarget > peakValue) {
      peakValue = currentTarget;
    }

    // Keep slider in sync if not manually dragging it
    const slider = document.getElementById('test-slider');
    if (slider && !isSliderActive) {
      slider.value = val;
    }
  }

  function setConnectionStatus(state, detail) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const btn  = document.getElementById('btn-connect');

    dot.className = 'status-dot';

    switch (state) {
      case 'connected':
        dot.classList.add('connected');
        text.textContent = 'Connected';
        btn.textContent  = 'Disconnect';
        break;
      case 'error':
        dot.classList.add('error');
        text.textContent = detail || 'Error';
        btn.textContent  = 'Connect';
        break;
      default:
        text.textContent = 'Disconnected';
        btn.textContent  = 'Connect';
    }
  }

  /* ----------------------------------------------------------
   *  Auto-Calibration Wizard
   * ---------------------------------------------------------- */
  function startCalibration() {
    if (isCalibrating) return;
    isCalibrating = true;

    const desc = document.getElementById('pressure-desc');
    const rangeEl = document.getElementById('calib-range');
    const btn = document.getElementById('btn-calibrate');
    btn.disabled = true;

    let restingSamples = [];
    let pressedSamples = [];

    // Step 1: Measure rest (1.5s)
    desc.textContent = 'CALIBRATION: RELEASE SENSOR (1.5s)...';
    desc.style.color = '#38bdf8';

    const restInterval = setInterval(() => {
      restingSamples.push(rawADC);
    }, 50);

    setTimeout(() => {
      clearInterval(restInterval);

      // Step 2: Measure hard press (2s)
      desc.textContent = 'CALIBRATION: PRESS HARD NOW (2s)!';
      desc.style.color = '#f87171';

      const pressInterval = setInterval(() => {
        pressedSamples.push(rawADC);
      }, 50);

      setTimeout(() => {
        clearInterval(pressInterval);

        // Calculate averages
        const avgRest = restingSamples.reduce((a, b) => a + b, 0) / (restingSamples.length || 1);
        const maxPress = Math.max(...pressedSamples);
        const minPress = Math.min(...pressedSamples);

        // Auto-detect inversion: if pressing dropped the value, invert!
        if (minPress < avgRest - 100) {
          invertADC = true;
          calibMax = Math.round(avgRest);
          calibMin = Math.round(minPress);
          document.getElementById('toggle-invert').checked = true;
        } else {
          invertADC = false;
          calibMin = Math.round(avgRest);
          calibMax = Math.round(maxPress);
          document.getElementById('toggle-invert').checked = false;
        }

        rangeEl.textContent = `${calibMin} — ${calibMax} ${invertADC ? '(Inverted)' : ''}`;
        desc.textContent = 'CALIBRATION COMPLETE!';
        desc.style.color = '#4ade80';
        btn.disabled = false;
        isCalibrating = false;

        setTimeout(() => {
          desc.style.color = '';
        }, 2000);
      }, 2000);
    }, 1500);
  }

  /* ----------------------------------------------------------
   *  Event Listeners
   * ---------------------------------------------------------- */
  let isSliderActive = false;

  function bindEvents() {
    // Connect / Disconnect button
    document.getElementById('btn-connect').addEventListener('click', () => {
      if (serialPort) disconnectSerial();
      else connectSerial();
    });

    // Reset Peak
    document.getElementById('btn-reset-peak').addEventListener('click', () => {
      peakValue = currentTarget;
    });

    // Zero / Tare sensor
    document.getElementById('btn-zero').addEventListener('click', () => {
      if (invertADC) {
        calibMax = rawADC;
      } else {
        calibMin = rawADC;
      }
      document.getElementById('calib-range').textContent = `${calibMin} — ${calibMax}`;
    });

    // Auto-Calibrate button
    document.getElementById('btn-calibrate').addEventListener('click', startCalibration);

    // Invert checkbox
    document.getElementById('toggle-invert').addEventListener('change', (e) => {
      invertADC = e.target.checked;
      applyAdcValue(rawADC);
    });

    // Manual test slider
    const slider = document.getElementById('test-slider');
    slider.addEventListener('mousedown', () => { isSliderActive = true; });
    slider.addEventListener('mouseup',   () => { isSliderActive = false; });
    slider.addEventListener('input', (e) => {
      applyAdcValue(parseInt(e.target.value, 10));
    });

    // Interactive canvas: Drag/Touch contact point & test pressure
    function handleCanvasPointer(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      contactX = Math.max(0, Math.min(canvas.width, (clientX - rect.left) * scaleX));
      contactY = Math.max(0, Math.min(canvas.height, (clientY - rect.top) * scaleY));
    }

    canvas.addEventListener('mousedown', (e) => {
      isCanvasDown = true;
      handleCanvasPointer(e);
      currentTarget = Math.min(1.0, currentTarget + 0.4);
      if (currentTarget > peakValue) peakValue = currentTarget;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (isCanvasDown) {
        handleCanvasPointer(e);
        currentTarget = Math.min(1.0, currentTarget + 0.05);
        if (currentTarget > peakValue) peakValue = currentTarget;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isCanvasDown) {
        isCanvasDown = false;
        setTimeout(() => {
          currentTarget = 0;
          contactX = null;
          contactY = null;
        }, 200);
      }
    });

    // Touch support for mobile / tablet
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isCanvasDown = true;
      handleCanvasPointer(e);
      currentTarget = 0.5;
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      handleCanvasPointer(e);
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
      isCanvasDown = false;
      currentTarget = 0;
      contactX = null;
      contactY = null;
    });
  }

  /* Boot */
  document.addEventListener('DOMContentLoaded', init);
})();
