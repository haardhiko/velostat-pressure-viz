/**
 * Velostat Plantar Pressure Map — Core Logic (Phase 1)
 * Anatomical foot visualization, multi-sensor mapping, simulation/hardware modes,
 * Web Serial API adapter with multi-channel extensibility, and calibration persistence.
 */
(function () {
  'use strict';

  /* ==========================================================================
   * 1. Sensor Configuration & Layout (Plantar Right Foot - 4 Regional Sensors)
   * ========================================================================== */

  /**
   * 4 Regional anatomical sensor locations:
   * 1. Toes: All 5 toes as 1 unified anatomical part (Distal digital crest)
   * 2. Forefoot: Metatarsal ball pad
   * 3. Midfoot: Plantar arch / instep
   * 4. Heel: Calcaneus rearfoot pad
   *
   * Normalized coordinates (x: 0..1, y: 0..1) relative to foot bounding box:
   * x=0 is medial (big toe side on right plantar view), x=1 is lateral (pinky side)
   * y=0 is distal (toes), y=1 is proximal (heel)
   */
  const SENSOR_LOCATIONS = [
    // --- 1. Toes (All 5 Phalanges as 1 Unified Region) ---
    { id: 'toes', label: 'Toes (Digital Pad)', region: 'Toes', x: 0.50, y: 0.14, radius: 0.12 },

    // --- 2. Forefoot (Metatarsal Ball) ---
    { id: 'forefoot', label: 'Forefoot (Ball)', region: 'Forefoot', x: 0.50, y: 0.35, radius: 0.13 },

    // --- 3. Midfoot (Plantar Arch) ---
    { id: 'midfoot', label: 'Midfoot (Arch)', region: 'Midfoot', x: 0.54, y: 0.57, radius: 0.12 },

    // --- 4. Heel (Calcaneus) ---
    { id: 'heel', label: 'Heel (Calcaneus)', region: 'Heel', x: 0.53, y: 0.80, radius: 0.13 }
  ];

  /* ==========================================================================
   * 2. State Management & Sensor Resolution
   * ========================================================================== */

  const state = {
    mode: 'simulation', // 'simulation' | 'hardware'
    selectedSensorId: 'heel',
    focusedSensorIndex: 3, // for keyboard accessibility (0: toes, 1: forefoot, 2: midfoot, 3: heel)

    // Per-sensor dynamic values
    sensors: {},

    // Hardware connection state
    hwMappedSensorId: 'heel', // The single ESP32 GPIO32 reading maps here
    hwConnected: false,
    rawADC: 0,
    lastSerialTimestamp: 0,
    serialPort: null,
    serialReader: null,
    isReading: false,
    serialTimestamps: [],

    // Calibration settings for hardware channel
    calibMin: 0,
    calibMax: 4095,
    invertADC: false,
    isCalibrating: false
  };

  /**
   * Resolves sensor IDs across aliases (e.g. legacy 15-sensor names, 'ball'/'arch', etc.)
   */
  function resolveSensorId(id) {
    if (!id || typeof id !== 'string') return null;
    const clean = id.trim().toLowerCase();
    if (state.sensors && state.sensors[clean]) return clean;
    const aliases = {
      'toes': 'toes',
      'toe': 'toes',
      'toe_1': 'toes',
      'toe_2': 'toes',
      'toe_3': 'toes',
      'toe_4': 'toes',
      'toe_5': 'toes',
      'forefoot': 'forefoot',
      'ball': 'forefoot',
      'meta_1': 'forefoot',
      'meta_2': 'forefoot',
      'meta_3': 'forefoot',
      'meta_5': 'forefoot',
      'midfoot': 'midfoot',
      'arch': 'midfoot',
      'arch_medial': 'midfoot',
      'arch_lateral': 'midfoot',
      'midfoot_center': 'midfoot',
      'heel': 'heel',
      'heel_center': 'heel',
      'heel_medial': 'heel',
      'heel_lateral': 'heel'
    };
    return aliases[clean] || null;
  }

  // Initialize sensors state
  SENSOR_LOCATIONS.forEach((loc) => {
    state.sensors[loc.id] = {
      ...loc,
      targetValue: 0.0,  // normalized target 0..1
      currentValue: 0.0, // smoothed rendering value 0..1
      rawReading: null,  // integer or null
      peakValue: 0.0,    // highest normalized 0..1
      source: 'Simulated',
      hasSignal: true    // whether valid data is available
    };
  });

  // Load saved calibration from localStorage
  try {
    const saved = localStorage.getItem('velostat_calib');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.calibMin === 'number') state.calibMin = parsed.calibMin;
      if (typeof parsed.calibMax === 'number') state.calibMax = parsed.calibMax;
      if (typeof parsed.invertADC === 'boolean') state.invertADC = parsed.invertADC;
      if (parsed.hwMappedSensorId) {
        const resolved = resolveSensorId(parsed.hwMappedSensorId);
        if (resolved && state.sensors[resolved]) {
          state.hwMappedSensorId = resolved;
        }
      }
    }
  } catch (_) {}

  function saveCalibration() {
    try {
      localStorage.setItem('velostat_calib', JSON.stringify({
        calibMin: state.calibMin,
        calibMax: state.calibMax,
        invertADC: state.invertADC,
        hwMappedSensorId: state.hwMappedSensorId
      }));
    } catch (_) {}
  }

  /* ==========================================================================
   * 3. Color Scale (Blue -> Cyan -> Green -> Yellow -> Orange -> Red)
   * ========================================================================== */

  const COLOR_STOPS = [
    { pos: 0.00, r: 24,  g: 36,  b: 60  }, // Idle / Neutral
    { pos: 0.08, r: 30,  g: 90,  b: 220 }, // Light Touch: Blue
    { pos: 0.25, r: 0,   g: 170, b: 255 }, // Cyan
    { pos: 0.45, r: 34,  g: 200, b: 94  }, // Green
    { pos: 0.70, r: 245, g: 190, b: 20  }, // Yellow
    { pos: 0.88, r: 245, g: 90,  b: 24  }, // Orange-Red
    { pos: 1.00, r: 235, g: 25,  b: 25  }  // Max Pressure: Red
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
      Math.round(lo.b + factor * (hi.b - lo.b))
    ];
  }

  /* ==========================================================================
   * 4. Foot Anatomy & Canvas Renderer
   * ========================================================================== */

  class FootRenderer {
    constructor(canvas, footContainer) {
      this.canvas = canvas;
      this.container = footContainer;
      this.ctx = canvas.getContext('2d');
      this.width = 460;
      this.height = 840;
      this.dpr = window.devicePixelRatio || 1;

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      // Expanded foot canvas dimensions: width up to 480px, height w * 1.82
      const availableWidth = rect.width ? Math.max(340, rect.width - 24) : 480;
      const w = Math.min(availableWidth, 480);
      const h = Math.round(w * 1.82);

      this.width = w;
      this.height = h;
      this.dpr = window.devicePixelRatio || 1;

      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;

      this.ctx.resetTransform();
      this.ctx.scale(this.dpr, this.dpr);
    }

    /**
     * Draw the complete plantar foot visualization with 4 regions:
     * 1. All 5 toes as 1 unified digital pad part
     * 2. Forefoot (Metatarsal ball)
     * 3. Midfoot (Plantar arch)
     * 4. Heel (Calcaneus)
     */
    render() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;

      ctx.clearRect(0, 0, w, h);

      // 1. Draw foot sole outline with integrated 5-toes unified part, forefoot, midfoot, heel
      this.drawSoleBackground(ctx, w, h);

      // 2. Render localized pressure heatmap for each sensor (clipped to sole)
      this.drawPressureHeatmap(ctx, w, h);

      // 3. Draw anatomical zone boundary lines and region titles
      this.drawZoneDividers(ctx, w, h);

      // 4. Draw sensor location nodes and labels
      this.drawSensorNodes(ctx, w, h);
    }

    /**
     * Plantar sole path for a right foot with unified 5-toes digital pad at the top
     */
    traceSolePath(ctx, w, h) {
      ctx.beginPath();
      // Start at Medial Heel
      ctx.moveTo(w * 0.36, h * 0.70);

      // Medial Arch: sweeps inward gracefully
      ctx.bezierCurveTo(w * 0.36, h * 0.60, w * 0.28, h * 0.48, w * 0.25, h * 0.38);

      // Medial Forefoot / 1st Metatarsal head bulge
      ctx.bezierCurveTo(w * 0.22, h * 0.32, w * 0.22, h * 0.24, w * 0.24, h * 0.20);

      // Medial Hallux (Big Toe) edge curving up
      ctx.bezierCurveTo(w * 0.25, h * 0.14, w * 0.28, h * 0.08, w * 0.36, h * 0.06);

      // Unified 5-Toe Crest across all 5 toes (Big toe to 5th toe cascade)
      ctx.bezierCurveTo(w * 0.44, h * 0.05, w * 0.52, h * 0.07, w * 0.60, h * 0.10);
      ctx.bezierCurveTo(w * 0.68, h * 0.13, w * 0.76, h * 0.17, w * 0.81, h * 0.22);

      // Lateral 5th toe & Lateral Forefoot bulge (5th Metatarsal head)
      ctx.bezierCurveTo(w * 0.84, h * 0.26, w * 0.84, h * 0.32, w * 0.82, h * 0.38);

      // Lateral Midfoot / Arch border
      ctx.bezierCurveTo(w * 0.80, h * 0.48, w * 0.77, h * 0.58, w * 0.74, h * 0.68);

      // Lateral Heel
      ctx.bezierCurveTo(w * 0.72, h * 0.78, w * 0.68, h * 0.86, w * 0.62, h * 0.90);

      // Rounded Heel bottom
      ctx.bezierCurveTo(w * 0.56, h * 0.93, w * 0.46, h * 0.93, w * 0.40, h * 0.90);

      // Medial Heel curve back to start
      ctx.bezierCurveTo(w * 0.35, h * 0.85, w * 0.34, h * 0.78, w * 0.36, h * 0.70);
      ctx.closePath();
    }

    drawSoleBackground(ctx, w, h) {
      ctx.save();

      // Draw Main Insole Silhouette
      this.traceSolePath(ctx, w, h);
      ctx.fillStyle = '#0b1329';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.0;
      ctx.stroke();

      // Highlight the Unified 5-Toes Part as 1 Contoured Region at the top
      ctx.beginPath();
      ctx.moveTo(w * 0.24, h * 0.21);
      ctx.bezierCurveTo(w * 0.24, h * 0.14, w * 0.27, h * 0.08, w * 0.36, h * 0.06);
      ctx.bezierCurveTo(w * 0.44, h * 0.05, w * 0.52, h * 0.07, w * 0.60, h * 0.10);
      ctx.bezierCurveTo(w * 0.68, h * 0.13, w * 0.76, h * 0.17, w * 0.81, h * 0.22);
      ctx.bezierCurveTo(w * 0.83, h * 0.24, w * 0.81, h * 0.25, w * 0.78, h * 0.25);
      // Metatarsal sulcus / crease boundary
      ctx.bezierCurveTo(w * 0.64, h * 0.24, w * 0.44, h * 0.22, w * 0.24, h * 0.21);
      ctx.closePath();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();
    }

    drawZoneDividers(ctx, w, h) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);

      // 1. Dividing line: Toes / Forefoot (Metatarsal Crease)
      ctx.beginPath();
      ctx.moveTo(w * 0.24, h * 0.21);
      ctx.bezierCurveTo(w * 0.44, h * 0.22, w * 0.64, h * 0.24, w * 0.81, h * 0.24);
      ctx.stroke();

      // 2. Dividing line: Forefoot / Midfoot
      ctx.beginPath();
      ctx.moveTo(w * 0.26, h * 0.46);
      ctx.bezierCurveTo(w * 0.44, h * 0.47, w * 0.62, h * 0.47, w * 0.78, h * 0.46);
      ctx.stroke();

      // 3. Dividing line: Midfoot / Heel
      ctx.beginPath();
      ctx.moveTo(w * 0.35, h * 0.68);
      ctx.bezierCurveTo(w * 0.48, h * 0.69, w * 0.62, h * 0.69, w * 0.74, h * 0.68);
      ctx.stroke();

      ctx.setLineDash([]);

      // Anatomical Region Watermark Badges
      ctx.font = '700 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.38)';

      ctx.fillText('TOES (ALL 5 DIGITS)', w * 0.50, h * 0.08);
      ctx.fillText('FOREFOOT (BALL)', w * 0.50, h * 0.44);
      ctx.fillText('MIDFOOT (ARCH)', w * 0.54, h * 0.66);
      ctx.fillText('HEEL (CALCANEUS)', w * 0.53, h * 0.89);

      ctx.restore();
    }

    drawPressureHeatmap(ctx, w, h) {
      ctx.save();

      // Clip heatmap strictly inside anatomical foot contour
      this.traceSolePath(ctx, w, h);
      ctx.clip();

      // Render radial pressure diffusion for each active sensor
      SENSOR_LOCATIONS.forEach((loc) => {
        const s = state.sensors[loc.id];
        const val = s.currentValue;

        if (val <= 0.005) return;

        const cx = loc.x * w;
        const cy = loc.y * h;
        const baseRadius = loc.radius * w;
        const radius = baseRadius * (1.1 + val * 1.6);
        const rgb = pressureToRGB(val);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        const alphaCore = Math.min(0.92, 0.30 + val * 0.65);
        const alphaMid = Math.min(0.65, val * 0.50);

        grad.addColorStop(0.0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alphaCore})`);
        const midRGB = pressureToRGB(val * 0.6);
        grad.addColorStop(0.5, `rgba(${midRGB[0]}, ${midRGB[1]}, ${midRGB[2]}, ${alphaMid})`);
        grad.addColorStop(1.0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        // Subtle concentric pressure contour ring
        if (val > 0.15) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${val * 0.5})`;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
      });

      ctx.restore();
    }

    drawSensorNodes(ctx, w, h) {
      ctx.save();

      SENSOR_LOCATIONS.forEach((loc, idx) => {
        const s = state.sensors[loc.id];
        const cx = loc.x * w;
        const cy = loc.y * h;
        const val = s.currentValue;
        const isSelected = (loc.id === state.selectedSensorId);
        const isFocused = (idx === state.focusedSensorIndex);
        const isHwMapped = (state.mode === 'hardware' && loc.id === state.hwMappedSensorId);

        const nodeRadius = 14;

        // Selection ring
        if (isSelected || isFocused) {
          ctx.beginPath();
          ctx.arc(cx, cy, nodeRadius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? '#38bdf8' : '#94a3b8';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // Hardware active badge indicator ring
        if (isHwMapped) {
          ctx.beginPath();
          ctx.arc(cx, cy, nodeRadius + 10, 0, Math.PI * 2);
          ctx.strokeStyle = state.hwConnected ? '#22c55e' : '#eab308';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Node center circle
        ctx.beginPath();
        ctx.arc(cx, cy, nodeRadius, 0, Math.PI * 2);

        if (val > 0.01) {
          const rgb = pressureToRGB(val);
          ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
        } else {
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = '#475569';
          ctx.lineWidth = 1.5;
        }
        ctx.fill();
        ctx.stroke();

        // Node letter label
        ctx.font = '700 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = (val > 0.35) ? '#050a14' : '#f8fafc';

        const nodeLetter = ['T', 'F', 'M', 'H'][idx] || loc.region[0];
        ctx.fillText(nodeLetter, cx, cy);

        // Value / region pill badge below node
        const pctText = `${Math.round(val * 100)}%`;
        ctx.font = '600 10px Inter, sans-serif';
        const textWidth = ctx.measureText(pctText).width;
        const badgeW = textWidth + 14;
        const badgeH = 18;
        const badgeY = cy + nodeRadius + 8;

        ctx.fillStyle = isSelected ? '#111827' : 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx - badgeW / 2, badgeY, badgeW, badgeH, 9);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isSelected ? '#38bdf8' : (val > 0.05 ? '#22c55e' : '#94a3b8');
        ctx.fillText(pctText, cx, badgeY + badgeH / 2);
      });

      ctx.restore();
    }

    /**
     * Find sensor closest to (clientX, clientY) on the canvas
     */
    hitTest(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;

      let closest = null;
      let minDistance = Infinity;

      SENSOR_LOCATIONS.forEach((loc) => {
        const dx = (loc.x - x);
        const dy = (loc.y - y);
        const d = Math.sqrt(dx * dx + dy * dy);

        // Generous touch/click radius threshold for 4 regions
        if (d < 0.16 && d < minDistance) {
          minDistance = d;
          closest = loc;
        }
      });

      return closest;
    }
  }

  /* ==========================================================================
   * 5. Serial Adapter (Web Serial API & Extensible Data Parsing)
   * ========================================================================== */

  class SerialAdapter {
    constructor(onLineReceived, onStatusChanged) {
      this.onLineReceived = onLineReceived;
      this.onStatusChanged = onStatusChanged;
      this.port = null;
      this.reader = null;
      this.isReading = false;
    }

    isSupported() {
      return 'serial' in navigator;
    }

    async connect(baudRate = 115200) {
      if (!this.isSupported()) {
        this.onStatusChanged('error', 'Web Serial not supported in this browser.');
        return false;
      }

      try {
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate });
        this.isReading = true;
        this.onStatusChanged('connected');
        this.startReading();
        return true;
      } catch (err) {
        if (err.name === 'NotFoundError') {
          this.onStatusChanged('disconnected');
        } else {
          console.error('Serial connection error:', err);
          this.onStatusChanged('error', err.message || 'Connection failed');
        }
        return false;
      }
    }

    async disconnect() {
      this.isReading = false;
      if (this.reader) {
        try { await this.reader.cancel(); } catch (_) {}
        this.reader = null;
      }
      if (this.port) {
        try { await this.port.close(); } catch (_) {}
        this.port = null;
      }
      this.onStatusChanged('disconnected');
    }

    async startReading() {
      const decoder = new TextDecoderStream();
      this.port.readable.pipeTo(decoder.writable);
      this.reader = decoder.readable.getReader();

      let buffer = '';

      try {
        while (this.isReading) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (!value) continue;

          buffer += value;

          let newlineIdx;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.substring(0, newlineIdx).trim();
            buffer = buffer.substring(newlineIdx + 1);
            if (line.length > 0) {
              this.parseLine(line);
            }
          }

          if (buffer.length > 2048) {
            buffer = buffer.substring(buffer.length - 256);
          }
        }
      } catch (err) {
        if (this.isReading) {
          console.error('Serial read error:', err);
          this.onStatusChanged('error', 'Serial read error');
        }
      }
      if (this.reader) this.reader.releaseLock();
    }

    /**
     * Clean line parser with built-in multi-channel extensibility:
     * Format A: Single integer (current ESP32 firmware) -> "2450"
     * Format B: Multi-value CSV (future firmware) -> "2450,1120,400,..."
     * Format C: Key-Value pairs -> "heel_center:2450,toe_1:1200"
     */
    parseLine(line) {
      state.lastSerialTimestamp = performance.now();
      state.serialTimestamps.push(state.lastSerialTimestamp);

      // Check if line contains key-value pairs (Format C)
      if (line.includes(':')) {
        const pairs = line.split(',');
        const updates = {};
        pairs.forEach(p => {
          const [k, v] = p.split(':');
          const resolved = resolveSensorId(k);
          const num = parseInt(v, 10);
          if (resolved && !isNaN(num)) updates[resolved] = num;
        });
        this.onLineReceived({ type: 'multichannel_named', data: updates });
        return;
      }

      // Check if CSV multi-channel (Format B)
      if (line.includes(',')) {
        const parts = line.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        this.onLineReceived({ type: 'multichannel_indexed', data: parts });
        return;
      }

      // Default: Single integer ADC value (Format A)
      const val = parseInt(line, 10);
      if (!isNaN(val)) {
        this.onLineReceived({ type: 'single_channel', raw: val });
      }
    }
  }

  /* ==========================================================================
   * 6. Application Logic & UI Integration
   * ========================================================================== */

  let renderer;
  let serialAdapter;

  function init() {
    const canvas = document.getElementById('foot-canvas');
    const container = document.getElementById('foot-container');
    renderer = new FootRenderer(canvas, container);

    serialAdapter = new SerialAdapter(handleSerialData, updateConnectionStatus);

    populateSensorDropdowns();
    renderLegend();
    bindEvents();
    updateUI();

    // Start animation render loop
    requestAnimationFrame(renderLoop);

    // Refresh rate & stats ticker
    setInterval(updateStatsTicker, 400);
  }

  /* --- Render Loop with Lerp Smoothing --- */
  const LERP_FACTOR = 0.18;

  function renderLoop() {
    requestAnimationFrame(renderLoop);

    // Lerp smooth each sensor's rendering value towards target
    SENSOR_LOCATIONS.forEach((loc) => {
      const s = state.sensors[loc.id];
      s.currentValue += LERP_FACTOR * (s.targetValue - s.currentValue);
      if (Math.abs(s.currentValue - s.targetValue) < 0.0005) {
        s.currentValue = s.targetValue;
      }
    });

    renderer.render();
  }

  /* --- Serial Data Ingestion --- */
  function handleSerialData(packet) {
    if (state.mode !== 'hardware') return;

    if (packet.type === 'single_channel') {
      applyHardwareReading(state.hwMappedSensorId, packet.raw);
    } else if (packet.type === 'multichannel_named') {
      Object.keys(packet.data).forEach(id => {
        if (state.sensors[id]) applyHardwareReading(id, packet.data[id]);
      });
    } else if (packet.type === 'multichannel_indexed') {
      packet.data.forEach((val, idx) => {
        if (SENSOR_LOCATIONS[idx]) {
          applyHardwareReading(SENSOR_LOCATIONS[idx].id, val);
        }
      });
    }
  }

  function applyHardwareReading(sensorId, rawVal) {
    const s = state.sensors[sensorId];
    if (!s) return;

    state.rawADC = rawVal;
    s.rawReading = rawVal;
    s.hasSignal = true;
    s.source = 'ESP32 GPIO32 (USB Serial)';

    // Normalization using calibration bounds
    const min = Math.min(state.calibMin, state.calibMax);
    const max = Math.max(state.calibMin, state.calibMax);
    const span = Math.max(50, max - min);

    let normalized;
    if (state.invertADC) {
      normalized = (max - rawVal) / span;
    } else {
      normalized = (rawVal - min) / span;
    }
    normalized = Math.max(0, Math.min(1.0, normalized));

    s.targetValue = normalized;
    if (normalized > s.peakValue) {
      s.peakValue = normalized;
    }

    if (state.selectedSensorId === sensorId) {
      updateSelectedSensorPanel();
    }
  }

  /* --- Populate Dropdowns --- */
  function populateSensorDropdowns() {
    const simSelect = document.getElementById('sim-sensor-select');
    const hwSelect = document.getElementById('hw-channel-sensor');

    simSelect.innerHTML = '<option value="">— Select a sensor —</option>';
    hwSelect.innerHTML = '';

    SENSOR_LOCATIONS.forEach((loc) => {
      // Sim select
      const opt1 = document.createElement('option');
      opt1.value = loc.id;
      opt1.textContent = `${loc.label} (${loc.region})`;
      simSelect.appendChild(opt1);

      // HW select
      const opt2 = document.createElement('option');
      opt2.value = loc.id;
      opt2.textContent = `${loc.label} (${loc.region})`;
      if (loc.id === state.hwMappedSensorId) opt2.selected = true;
      hwSelect.appendChild(opt2);
    });

    simSelect.value = state.selectedSensorId;
  }

  /* --- Update Mode (Simulation vs Hardware) --- */
  function setMode(newMode) {
    state.mode = newMode;

    const btnSim = document.getElementById('mode-simulation');
    const btnHw = document.getElementById('mode-hardware');
    const panelSim = document.getElementById('panel-simulation');
    const panelHw = document.getElementById('panel-hardware');
    const vizNote = document.getElementById('viz-note');

    if (newMode === 'simulation') {
      btnSim.classList.add('active');
      btnSim.setAttribute('aria-selected', 'true');
      btnHw.classList.remove('active');
      btnHw.setAttribute('aria-selected', 'false');

      panelSim.hidden = false;
      panelHw.hidden = true;
      vizNote.textContent = 'Simulation Mode — Values are simulated, not from hardware sensors';

      // Mark all sensors as simulated
      SENSOR_LOCATIONS.forEach(loc => {
        const s = state.sensors[loc.id];
        s.source = 'Simulated';
        s.hasSignal = true;
      });
    } else {
      btnHw.classList.add('active');
      btnHw.setAttribute('aria-selected', 'true');
      btnSim.classList.remove('active');
      btnSim.setAttribute('aria-selected', 'false');

      panelHw.hidden = false;
      panelSim.hidden = true;
      vizNote.textContent = 'Hardware Mode — Live reading mapped to designated sensor only; remaining locations have no physical sensor.';

      // In single-channel HW mode, zero out unmapped locations
      SENSOR_LOCATIONS.forEach(loc => {
        const s = state.sensors[loc.id];
        if (loc.id !== state.hwMappedSensorId) {
          s.targetValue = 0;
          s.rawReading = null;
          s.source = 'No Signal (Unmapped in single-channel mode)';
          s.hasSignal = false;
        } else {
          s.source = 'ESP32 GPIO32 (USB Serial)';
          s.hasSignal = state.hwConnected;
        }
      });
    }

    updateUI();
  }

  /* --- Select Sensor --- */
  function selectSensor(sensorId) {
    if (!state.sensors[sensorId]) return;
    state.selectedSensorId = sensorId;
    state.focusedSensorIndex = SENSOR_LOCATIONS.findIndex(l => l.id === sensorId);

    const simSelect = document.getElementById('sim-sensor-select');
    if (simSelect) simSelect.value = sensorId;

    const slider = document.getElementById('sim-pressure-slider');
    const sliderVal = document.getElementById('sim-pressure-value');
    if (slider) {
      slider.disabled = (state.mode === 'hardware');
      const pct = Math.round(state.sensors[sensorId].targetValue * 100);
      slider.value = pct;
      sliderVal.textContent = `${pct}%`;
    }

    updateSelectedSensorPanel();
  }

  /* --- Update Details in Side Panel --- */
  function updateSelectedSensorPanel() {
    const details = document.getElementById('sensor-details');
    const placeholder = document.getElementById('no-selection');

    if (!state.selectedSensorId) {
      details.hidden = true;
      placeholder.hidden = false;
      return;
    }

    details.hidden = false;
    placeholder.hidden = true;

    const s = state.sensors[state.selectedSensorId];
    document.getElementById('info-id').textContent = s.id;
    document.getElementById('info-label').textContent = s.label;
    document.getElementById('info-region').textContent = s.region;

    if (state.mode === 'hardware') {
      if (s.id === state.hwMappedSensorId) {
        document.getElementById('info-raw').textContent = (s.rawReading !== null) ? `${s.rawReading} / 4095` : 'Awaiting data';
        document.getElementById('info-normalized').textContent = `${(s.targetValue * 100).toFixed(1)}%`;
        document.getElementById('info-peak').textContent = `${(s.peakValue * 100).toFixed(1)}%`;
        document.getElementById('info-source').textContent = s.source;
      } else {
        document.getElementById('info-raw').textContent = 'N/A';
        document.getElementById('info-normalized').textContent = '0.0%';
        document.getElementById('info-peak').textContent = `${(s.peakValue * 100).toFixed(1)}%`;
        document.getElementById('info-source').textContent = s.source;
      }
    } else {
      document.getElementById('info-raw').textContent = 'Simulated';
      document.getElementById('info-normalized').textContent = `${(s.targetValue * 100).toFixed(1)}%`;
      document.getElementById('info-peak').textContent = `${(s.peakValue * 100).toFixed(1)}%`;
      document.getElementById('info-source').textContent = s.source;
    }
  }

  /* --- Update Live Statistics Ticker --- */
  function updateStatsTicker() {
    const now = performance.now();

    // Calculate refresh rate (Hz)
    while (state.serialTimestamps.length > 0 && state.serialTimestamps[0] < now - 2000) {
      state.serialTimestamps.shift();
    }
    const hz = state.serialTimestamps.length > 1 ? Math.round(state.serialTimestamps.length / 2) : 0;

    // Count active locations
    let activeCount = 0;
    let maxPressure = 0;
    let maxLocation = '—';

    SENSOR_LOCATIONS.forEach(loc => {
      const s = state.sensors[loc.id];
      if (s.currentValue > 0.03) activeCount++;
      if (s.currentValue > maxPressure) {
        maxPressure = s.currentValue;
        maxLocation = s.label;
      }
    });

    document.getElementById('stat-active').textContent = `${activeCount} / ${SENSOR_LOCATIONS.length}`;
    document.getElementById('stat-hw-channels').textContent = (state.mode === 'hardware' && state.hwConnected) ? '1 (GPIO32)' : '0';
    document.getElementById('stat-max-pressure').textContent = `${(maxPressure * 100).toFixed(1)}%`;
    document.getElementById('stat-max-location').textContent = maxPressure > 0.03 ? maxLocation : '—';

    // Data freshness
    const freshnessEl = document.getElementById('stat-freshness');
    if (state.mode === 'hardware') {
      if (!state.hwConnected) {
        freshnessEl.textContent = 'Disconnected';
      } else if (now - state.lastSerialTimestamp > 2500) {
        freshnessEl.textContent = 'Stale (> 2s)';
        freshnessEl.style.color = '#eab308';
      } else {
        freshnessEl.textContent = `Live (${hz} Hz)`;
        freshnessEl.style.color = '#22c55e';
      }
    } else {
      freshnessEl.textContent = 'Interactive (Sim)';
      freshnessEl.style.color = 'var(--text-dim)';
    }

    // Refresh selected sensor panel values
    updateSelectedSensorPanel();
  }

  /* --- Connection Status UI Helper --- */
  function updateConnectionStatus(status, detail) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('stat-connection-label');
    const btn = document.getElementById('btn-connect');

    dot.className = 'status-dot';

    if (status === 'connected') {
      state.hwConnected = true;
      dot.classList.add('connected');
      label.textContent = 'Connected';
      btn.textContent = 'Disconnect';
    } else if (status === 'error') {
      state.hwConnected = false;
      dot.classList.add('error');
      label.textContent = detail || 'Error';
      btn.textContent = 'Connect';
    } else {
      state.hwConnected = false;
      label.textContent = 'Disconnected';
      btn.textContent = 'Connect';
    }

    updateUI();
  }

  /* --- Presets (Simulation Mode) --- */
  function applyPreset(presetName) {
    // Reset all targets
    SENSOR_LOCATIONS.forEach(loc => {
      state.sensors[loc.id].targetValue = 0;
    });

    const setVal = (id, val) => {
      const resolved = resolveSensorId(id);
      if (resolved && state.sensors[resolved]) {
        state.sensors[resolved].targetValue = val;
        if (val > state.sensors[resolved].peakValue) state.sensors[resolved].peakValue = val;
      }
    };

    switch (presetName) {
      case 'heel': // Heel strike
        setVal('heel', 0.90);
        setVal('midfoot', 0.05);
        setVal('forefoot', 0.00);
        setVal('toes', 0.00);
        break;

      case 'mid': // Midstance
        setVal('heel', 0.40);
        setVal('midfoot', 0.35);
        setVal('forefoot', 0.70);
        setVal('toes', 0.30);
        break;

      case 'toe': // Toe off
        setVal('heel', 0.00);
        setVal('midfoot', 0.05);
        setVal('forefoot', 0.80);
        setVal('toes', 0.95);
        break;

      case 'full': // Full contact
        setVal('heel', 0.65);
        setVal('midfoot', 0.25);
        setVal('forefoot', 0.70);
        setVal('toes', 0.50);
        break;
    }

    if (state.selectedSensorId) {
      selectSensor(state.selectedSensorId);
    }
  }

  /* --- Auto-Calibration Wizard --- */
  function startCalibration() {
    if (state.isCalibrating) return;
    state.isCalibrating = true;

    const desc = document.getElementById('pressure-desc');
    const rangeEl = document.getElementById('calib-range');
    const btn = document.getElementById('btn-calibrate');
    btn.disabled = true;

    let restingSamples = [];
    let pressedSamples = [];

    desc.textContent = 'RELEASE SENSOR (1.5s)...';
    desc.style.color = '#38bdf8';

    const restInterval = setInterval(() => {
      restingSamples.push(state.rawADC);
    }, 50);

    setTimeout(() => {
      clearInterval(restInterval);

      desc.textContent = 'PRESS HARD NOW (2s)!';
      desc.style.color = '#f87171';

      const pressInterval = setInterval(() => {
        pressedSamples.push(state.rawADC);
      }, 50);

      setTimeout(() => {
        clearInterval(pressInterval);

        const avgRest = restingSamples.reduce((a, b) => a + b, 0) / (restingSamples.length || 1);
        const maxPress = Math.max(...pressedSamples);
        const minPress = Math.min(...pressedSamples);

        // Detect inversion: if pressing dropped the value, invert!
        if (minPress < avgRest - 100) {
          state.invertADC = true;
          state.calibMax = Math.round(avgRest);
          state.calibMin = Math.round(minPress);
          document.getElementById('toggle-invert').checked = true;
        } else {
          state.invertADC = false;
          state.calibMin = Math.round(avgRest);
          state.calibMax = Math.round(maxPress);
          document.getElementById('toggle-invert').checked = false;
        }

        rangeEl.textContent = `${state.calibMin} — ${state.calibMax} ${state.invertADC ? '(Inverted)' : ''}`;
        desc.textContent = 'CALIBRATION COMPLETE!';
        desc.style.color = '#4ade80';
        btn.disabled = false;
        state.isCalibrating = false;

        saveCalibration();

        setTimeout(() => {
          desc.textContent = '';
        }, 2500);
      }, 2000);
    }, 1500);
  }

  /* --- Legend Rendering --- */
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

  /* --- General UI State Sync --- */
  function updateUI() {
    document.getElementById('toggle-invert').checked = state.invertADC;
    document.getElementById('calib-range').textContent = `${state.calibMin} — ${state.calibMax} ${state.invertADC ? '(Inverted)' : ''}`;
    selectSensor(state.selectedSensorId);
  }

  /* ==========================================================================
   * 7. Event Handlers & User Interaction
   * ========================================================================== */

  function bindEvents() {
    // Mode switcher
    document.getElementById('mode-simulation').addEventListener('click', () => setMode('simulation'));
    document.getElementById('mode-hardware').addEventListener('click', () => setMode('hardware'));

    // Canvas click & touch hit-testing
    const canvas = document.getElementById('foot-canvas');
    let isCanvasDragging = false;

    function handlePointer(e) {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const hit = renderer.hitTest(clientX, clientY);

      if (hit) {
        selectSensor(hit.id);
        if (state.mode === 'simulation' && isCanvasDragging) {
          // Increase pressure dynamically while pressing/dragging
          const s = state.sensors[hit.id];
          s.targetValue = Math.min(1.0, s.targetValue + 0.15);
          if (s.targetValue > s.peakValue) s.peakValue = s.targetValue;
          const slider = document.getElementById('sim-pressure-slider');
          if (slider) {
            slider.value = Math.round(s.targetValue * 100);
            document.getElementById('sim-pressure-value').textContent = `${slider.value}%`;
          }
        }
      }
    }

    canvas.addEventListener('mousedown', (e) => {
      isCanvasDragging = true;
      handlePointer(e);
    });

    canvas.addEventListener('mousemove', (e) => {
      if (isCanvasDragging) handlePointer(e);
    });

    window.addEventListener('mouseup', () => {
      isCanvasDragging = false;
    });

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isCanvasDragging = true;
      handlePointer(e);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      handlePointer(e);
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
      isCanvasDragging = false;
    });

    // Keyboard accessibility for canvas
    canvas.addEventListener('keydown', (e) => {
      let idx = state.focusedSensorIndex;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        idx = (idx + 1) % SENSOR_LOCATIONS.length;
        selectSensor(SENSOR_LOCATIONS[idx].id);
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        idx = (idx - 1 + SENSOR_LOCATIONS.length) % SENSOR_LOCATIONS.length;
        selectSensor(SENSOR_LOCATIONS[idx].id);
        e.preventDefault();
      } else if (e.key === 'Enter' || e.key === ' ') {
        selectSensor(SENSOR_LOCATIONS[idx].id);
        e.preventDefault();
      }
    });

    // Simulation controls
    document.getElementById('sim-sensor-select').addEventListener('change', (e) => {
      if (e.target.value) selectSensor(e.target.value);
    });

    const simSlider = document.getElementById('sim-pressure-slider');
    simSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) / 100;
      document.getElementById('sim-pressure-value').textContent = `${e.target.value}%`;

      if (state.selectedSensorId && state.sensors[state.selectedSensorId]) {
        const s = state.sensors[state.selectedSensorId];
        s.targetValue = val;
        if (val > s.peakValue) s.peakValue = val;
        updateSelectedSensorPanel();
      }
    });

    document.getElementById('btn-sim-clear').addEventListener('click', () => {
      SENSOR_LOCATIONS.forEach(loc => {
        state.sensors[loc.id].targetValue = 0;
      });
      if (state.selectedSensorId) selectSensor(state.selectedSensorId);
    });

    document.getElementById('btn-reset-peak').addEventListener('click', () => {
      SENSOR_LOCATIONS.forEach(loc => {
        state.sensors[loc.id].peakValue = state.sensors[loc.id].targetValue;
      });
      updateSelectedSensorPanel();
    });

    document.getElementById('btn-reset-peak-hw').addEventListener('click', () => {
      SENSOR_LOCATIONS.forEach(loc => {
        state.sensors[loc.id].peakValue = state.sensors[loc.id].targetValue;
      });
      updateSelectedSensorPanel();
    });

    // Presets
    document.getElementById('btn-preset-heel').addEventListener('click', () => applyPreset('heel'));
    document.getElementById('btn-preset-mid').addEventListener('click', () => applyPreset('mid'));
    document.getElementById('btn-preset-toe').addEventListener('click', () => applyPreset('toe'));
    document.getElementById('btn-preset-full').addEventListener('click', () => applyPreset('full'));

    // Hardware Controls
    document.getElementById('hw-channel-sensor').addEventListener('change', (e) => {
      state.hwMappedSensorId = e.target.value;
      saveCalibration();
      if (state.mode === 'hardware') setMode('hardware');
    });

    document.getElementById('btn-connect').addEventListener('click', async () => {
      if (state.hwConnected) {
        await serialAdapter.disconnect();
      } else {
        const baud = parseInt(document.getElementById('baud-rate').value, 10);
        await serialAdapter.connect(baud);
      }
    });

    document.getElementById('toggle-invert').addEventListener('change', (e) => {
      state.invertADC = e.target.checked;
      saveCalibration();
      document.getElementById('calib-range').textContent = `${state.calibMin} — ${state.calibMax} ${state.invertADC ? '(Inverted)' : ''}`;
    });

    document.getElementById('btn-calibrate').addEventListener('click', startCalibration);

    document.getElementById('btn-zero').addEventListener('click', () => {
      if (state.invertADC) {
        state.calibMax = state.rawADC;
      } else {
        state.calibMin = state.rawADC;
      }
      saveCalibration();
      document.getElementById('calib-range').textContent = `${state.calibMin} — ${state.calibMax} ${state.invertADC ? '(Inverted)' : ''}`;
    });
  }

  // Boot on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
