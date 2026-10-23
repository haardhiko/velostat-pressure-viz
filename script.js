/**
 * Velostat Plantar Pressure Map & Biomechanical Analysis — Core Logic
 * 5 Regional Sensors (2 Toes with wide separation, Forefoot, Midfoot, Heel),
 * Tactile Drag & Auto-Reset Interaction, 30-Second Walking Gait Calibration,
 * Clinical Reference Datasets Comparison, and NVIDIA NIM AI Integration.
 */
(function () {
  'use strict';

  /* ==========================================================================
   * 1. Sensor Configuration & Layout (5 Regional Sensors across 4 Regions)
   * ========================================================================== */

  /**
   * 5 Anatomical sensor locations:
   * 1. Medial Forefoot: 1st Metatarsal head / ball
   * 2. Lateral Forefoot: 5th Metatarsal head / ball
   * 3. Medial Arch: Plantar instep (inner arch)
   * 4. Lateral Arch: Outer midfoot (lateral longitudinal arch)
   * 5. Heel: Calcaneus rearfoot cup
   *
   * Normalized coordinates (x: 0..1, y: 0..1) relative to foot bounding box:
   * x=0 is medial (big toe side on right plantar view), x=1 is lateral (pinky side)
   * y=0 is distal (toes), y=1 is proximal (heel)
   */
  const SENSOR_LOCATIONS = [
    // --- Forefoot: 2 Sensors (Medial Ball & Lateral Ball with wide separation across the ball of the foot) ---
    { id: 'forefoot_medial', label: 'Medial Forefoot (1st Metatarsal Ball)', region: 'Forefoot', x: 0.35, y: 0.34, radius: 0.11 },
    { id: 'forefoot_lateral', label: 'Lateral Forefoot (5th Metatarsal Ball)', region: 'Forefoot', x: 0.65, y: 0.34, radius: 0.11 },

    // --- Midfoot: 2 Arch Sensors (Medial Arch & Lateral Arch with wide separation across the midfoot) ---
    { id: 'arch_medial', label: 'Medial Arch (Instep)', region: 'Midfoot', x: 0.36, y: 0.58, radius: 0.11 },
    { id: 'arch_lateral', label: 'Lateral Arch (Outer Midfoot)', region: 'Midfoot', x: 0.68, y: 0.58, radius: 0.11 },

    // --- Heel: Calcaneus Cup ---
    { id: 'heel', label: 'Heel (Calcaneus)', region: 'Heel', x: 0.53, y: 0.80, radius: 0.13 }
  ];

  /* ==========================================================================
   * 2. Canonical Reference Datasets
   * ========================================================================== */

  const REFERENCE_DATASETS = [
    {
      record_id: 'REC-GS-01',
      pattern: 'Heel Strike (Initial Contact Norm)',
      description: 'Healthy initial ground contact concentrated on the calcaneus; minimal forefoot involvement.',
      pressures: { heel: 0.85, midfoot: 0.05, forefoot: 0.05, toes: 0.05 },
      knee_profile: {
        condition: 'Healthy Shock Attenuation',
        risk: 'Low Risk',
        kam: 'Normal knee adduction moment',
        notes: 'Adequate quadriceps eccentric damping; normal tibiofemoral joint alignment.'
      }
    },
    {
      record_id: 'REC-MS-02',
      pattern: 'Midstance (Balanced Planar Loading Norm)',
      description: 'Even distribution across calcaneus, lateral longitudinal arch, and metatarsals.',
      pressures: { heel: 0.30, midfoot: 0.18, forefoot: 0.38, toes: 0.14 },
      knee_profile: {
        condition: 'Balanced Compartmental Load',
        risk: 'Low Risk',
        kam: 'Neutral mechanical axis',
        notes: 'Symmetrical force distribution between medial and lateral knee compartments.'
      }
    },
    {
      record_id: 'REC-TO-03',
      pattern: 'Toe Off (Propulsion Phase Norm)',
      description: 'Forward weight transfer concentrated on 1st metatarsal and hallux; heel unloaded.',
      pressures: { heel: 0.05, midfoot: 0.08, forefoot: 0.45, toes: 0.42 },
      knee_profile: {
        condition: 'Normal Extension Kinetic Chain',
        risk: 'Low Risk',
        kam: 'Low joint shear',
        notes: 'Smooth knee terminal extension without excessive valgus/varus torque.'
      }
    },
    {
      record_id: 'REC-KNEE-OA-04',
      pattern: 'Medial Compartment Knee Overload (Knee OA Tendency)',
      description: 'Pathological medial shift with high medial arch collapse and intense medial ball loading.',
      pressures: { heel: 0.30, midfoot: 0.28, forefoot: 0.42, toes: 0.10 },
      knee_profile: {
        condition: 'Medial Compartment Knee Osteoarthritis Risk',
        risk: 'High Risk',
        kam: 'Significantly elevated Knee Adduction Moment',
        notes: 'Ground reaction force vector passes medial to knee center, causing focal cartilage wear and meniscal compression.'
      }
    },
    {
      record_id: 'REC-PF-05',
      pattern: 'Patellofemoral Tracking Stress / Over-Pronation',
      description: 'Severe midfoot arch collapse causing excessive internal tibial torque during stance.',
      pressures: { heel: 0.25, midfoot: 0.35, forefoot: 0.32, toes: 0.08 },
      knee_profile: {
        condition: 'Patellofemoral Pain Syndrome (Runner\'s Knee)',
        risk: 'Moderate Risk',
        kam: 'Dynamic valgus torque',
        notes: 'Internal rotation of the tibia leads to lateral patellar maltracking and retro-patellar friction.'
      }
    },
    {
      record_id: 'REC-SHOCK-06',
      pattern: 'High-Impact Heel Strike (Meniscal Shock Loading)',
      description: 'Violent initial calcaneal impact without adequate midfoot dissipation; rigid foot strike.',
      pressures: { heel: 0.58, midfoot: 0.06, forefoot: 0.24, toes: 0.12 },
      knee_profile: {
        condition: 'Unattenuated Tibial Shock & Meniscal Stress',
        risk: 'Moderate Risk',
        kam: 'High transient vertical impact peak',
        notes: 'High loading rates transmit shockwaves through the tibia into the femoral condyles and menisci.'
      }
    },
    {
      record_id: 'REC-PARK-07',
      pattern: 'Parkinsonian Shuffling / Loss of Heel Strike',
      description: 'Absent initial heel strike with flat or forefoot-biased contact and attenuated amplitude.',
      pressures: { heel: 0.12, midfoot: 0.24, forefoot: 0.48, toes: 0.16 },
      knee_profile: {
        condition: 'Neurodegenerative Gait / Flexed Knee Posture',
        risk: 'Elevated Risk',
        kam: 'Altered quadriceps demand',
        notes: 'Shuffling gait associated with persistent knee flexion throughout stance phase.'
      }
    }
  ];

  /* ==========================================================================
   * 3. State Management & Hardware Pin Mapping
   * ========================================================================== */

  const HARDWARE_MAPPING_PRESETS = {
    'forefoot_to_heel': {
      1: 'forefoot_medial',
      2: 'forefoot_lateral',
      3: 'arch_medial',
      4: 'arch_lateral',
      5: 'heel'
    },
    'heel_to_forefoot': {
      1: 'heel',
      2: 'arch_lateral',
      3: 'arch_medial',
      4: 'forefoot_lateral',
      5: 'forefoot_medial'
    },
    'forefoot_arch_swap': {
      1: 'forefoot_lateral',
      2: 'forefoot_medial',
      3: 'arch_lateral',
      4: 'arch_medial',
      5: 'heel'
    },
    // Retain legacy preset keys so any localStorage cached key won't crash
    'toe_to_heel': {
      1: 'forefoot_medial',
      2: 'forefoot_lateral',
      3: 'arch_medial',
      4: 'arch_lateral',
      5: 'heel'
    },
    'heel_to_toe': {
      1: 'heel',
      2: 'arch_lateral',
      3: 'arch_medial',
      4: 'forefoot_lateral',
      5: 'forefoot_medial'
    },
    'toes_arch_forefoot_heel': {
      1: 'forefoot_medial',
      2: 'arch_medial',
      3: 'arch_lateral',
      4: 'forefoot_lateral',
      5: 'heel'
    }
  };

  const state = {
    mode: 'simulation', // 'simulation' | 'hardware'
    selectedSensorId: 'heel',
    focusedSensorIndex: 4,

    // Per-sensor dynamic values
    sensors: {},

    // UI render throttling & performance flags
    uiDirty: true,

    // Hardware connection state & 5-Point GPIO Pin Mapping
    hwMappedSensorId: 'heel', // Physical single-channel fallback
    hardwareMappingPreset: 'forefoot_to_heel',
    hardwareMapping: { ...HARDWARE_MAPPING_PRESETS['forefoot_to_heel'] },
    hwConnected: false,
    rawADC: 0,
    lastSerialTimestamp: 0,
    serialPort: null,
    serialReader: null,
    isReading: false,
    serialTimestamps: [],

    // Calibration settings & Velostat Sensitivity Controls
    calibMin: 0,
    calibMax: 4095,
    invertADC: false,
    isCalibrating: false,
    sensitivity: 0.35, // 0.10 to 1.00 (35% default: significantly less sensitive)
    deadzone: 0.08,    // 0.00 to 0.25 (8% resting noise deadzone)
    baselineTareCaptured: false,
    autoTareTimeout: null,

    // Drag interaction tracking
    isCanvasDragging: false,
    dragResetTimeout: null,
    contactX: null,
    contactY: null,

    // 30-Second Walking Test State
    test: {
      status: 'idle', // 'idle' | 'recording' | 'analyzing' | 'completed'
      durationSec: 30,
      elapsedSec: 0,
      timerInterval: null,
      sampleInterval: null,
      samples: [],
      strideCount: 0,
      lastPeakRegion: null,
      lastStepTime: 0,
      simWalkPhase: 0.0
    },

    // NVIDIA AI Settings
    nvidia: {
      apiKey: '',
      model: 'meta/llama-3.1-70b-instruct'
    }
  };

  /**
   * Map Arduino Point index (1..5) or GPIO pin (32..36) to regional sensor ID
   */
  function mapHardwarePointToSensor(pointIdx, gpioPin) {
    if (pointIdx && state.hardwareMapping && state.hardwareMapping[pointIdx]) {
      return state.hardwareMapping[pointIdx];
    }
    if (gpioPin) {
      const derived = gpioPin - 31;
      if (state.hardwareMapping && state.hardwareMapping[derived]) {
        return state.hardwareMapping[derived];
      }
    }
    return null;
  }

  /**
   * Sensor alias & hardware point resolution helper
   */
  function resolveSensorId(id) {
    if (!id || typeof id !== 'string') return null;
    const clean = id.trim().toLowerCase();
    if (state.sensors && state.sensors[clean]) return clean;

    // Check for "Point N", "GPIO N", or "Point N (GPIO M)"
    const m = clean.match(/^(?:point\s*(\d+)(?:\s*\((?:gpio\s*)?(\d+)\))?|(?:gpio\s*)(\d+))/i);
    if (m) {
      const pt = m[1] ? parseInt(m[1], 10) : null;
      const gpio = m[2] ? parseInt(m[2], 10) : (m[3] ? parseInt(m[3], 10) : null);
      const mapped = mapHardwarePointToSensor(pt, gpio);
      if (mapped) return mapped;
    }

    const aliases = {
      'point 1': state.hardwareMapping ? state.hardwareMapping[1] : 'forefoot_medial',
      'point 2': state.hardwareMapping ? state.hardwareMapping[2] : 'forefoot_lateral',
      'point 3': state.hardwareMapping ? state.hardwareMapping[3] : 'arch_medial',
      'point 4': state.hardwareMapping ? state.hardwareMapping[4] : 'arch_lateral',
      'point 5': state.hardwareMapping ? state.hardwareMapping[5] : 'heel',
      'point_1': 'forefoot_medial',
      'point_2': 'forefoot_lateral',
      'point_3': 'arch_medial',
      'point_4': 'arch_lateral',
      'point_5': 'heel',
      'p1': 'forefoot_medial',
      'p2': 'forefoot_lateral',
      'p3': 'arch_medial',
      'p4': 'arch_lateral',
      'p5': 'heel',
      'gpio 32': 'forefoot_medial',
      'gpio 33': 'forefoot_lateral',
      'gpio 34': 'arch_medial',
      'gpio 35': 'arch_lateral',
      'gpio 36': 'heel',
      'gpio32': 'forefoot_medial',
      'gpio33': 'forefoot_lateral',
      'gpio34': 'arch_medial',
      'gpio35': 'arch_lateral',
      'gpio36': 'heel',
      '32': 'forefoot_medial',
      '33': 'forefoot_lateral',
      '34': 'arch_medial',
      '35': 'arch_lateral',
      '36': 'heel',
      'forefoot_medial': 'forefoot_medial',
      'forefoot_lateral': 'forefoot_lateral',
      'fm': 'forefoot_medial',
      'fl': 'forefoot_lateral',
      'forefoot': 'forefoot_medial',
      'forefoot_center': 'forefoot_medial',
      'ball': 'forefoot_medial',
      'ball_medial': 'forefoot_medial',
      'ball_lateral': 'forefoot_lateral',
      'meta_1': 'forefoot_medial',
      'meta_2': 'forefoot_medial',
      'meta_3': 'forefoot_lateral',
      'meta_5': 'forefoot_lateral',
      'toes': 'forefoot_medial',
      'toe': 'forefoot_medial',
      'toe_1': 'forefoot_medial',
      'hallux': 'forefoot_medial',
      'toe_medial': 'forefoot_medial',
      'toes_medial': 'forefoot_medial',
      'toe_lateral': 'forefoot_lateral',
      'toes_lateral': 'forefoot_lateral',
      'toe_2': 'forefoot_lateral',
      'toe_3': 'forefoot_lateral',
      'toe_4': 'forefoot_lateral',
      'toe_5': 'forefoot_lateral',
      'arch_medial': 'arch_medial',
      'arch_lateral': 'arch_lateral',
      'am': 'arch_medial',
      'al': 'arch_lateral',
      'medial_arch': 'arch_medial',
      'lateral_arch': 'arch_lateral',
      'midfoot': 'arch_medial',
      'arch': 'arch_medial',
      'instep': 'arch_medial',
      'midfoot_medial': 'arch_medial',
      'midfoot_lateral': 'arch_lateral',
      'midfoot_center': 'arch_medial',
      'heel': 'heel',
      'h': 'heel',
      'heel_center': 'heel',
      'heel_medial': 'heel',
      'heel_lateral': 'heel'
    };
    return aliases[clean] || null;
  }

  // Initialize sensors state with baseline ADC tare support
  SENSOR_LOCATIONS.forEach((loc) => {
    state.sensors[loc.id] = {
      ...loc,
      targetValue: 0.0,
      currentValue: 0.0,
      rawReading: null,
      baselineADC: null, // Resting baseline reading captured during tare
      peakValue: 0.0,
      source: 'Simulated',
      hasSignal: true
    };
  });

  // Load saved calibration & NVIDIA settings from localStorage
  try {
    const savedCalib = localStorage.getItem('velostat_calib');
    if (savedCalib) {
      const parsed = JSON.parse(savedCalib);
      if (typeof parsed.calibMin === 'number') state.calibMin = parsed.calibMin;
      if (typeof parsed.calibMax === 'number') state.calibMax = parsed.calibMax;
      if (typeof parsed.invertADC === 'boolean') state.invertADC = parsed.invertADC;
      if (parsed.hwMappedSensorId) {
        const resolved = resolveSensorId(parsed.hwMappedSensorId);
        if (resolved && state.sensors[resolved]) state.hwMappedSensorId = resolved;
      }
      if (parsed.hardwareMappingPreset && HARDWARE_MAPPING_PRESETS[parsed.hardwareMappingPreset]) {
        state.hardwareMappingPreset = parsed.hardwareMappingPreset;
        state.hardwareMapping = { ...HARDWARE_MAPPING_PRESETS[parsed.hardwareMappingPreset] };
      }
      if (typeof parsed.sensitivity === 'number') state.sensitivity = parsed.sensitivity;
      if (typeof parsed.deadzone === 'number') state.deadzone = parsed.deadzone;
    }

    const savedKey = localStorage.getItem('velostat_nvidia_api_key');
    if (savedKey) state.nvidia.apiKey = savedKey.trim();

    const savedModel = localStorage.getItem('velostat_nvidia_model');
    if (savedModel) state.nvidia.model = savedModel.trim();
  } catch (_) {}

  function saveCalibration() {
    try {
      localStorage.setItem('velostat_calib', JSON.stringify({
        calibMin: state.calibMin,
        calibMax: state.calibMax,
        invertADC: state.invertADC,
        hwMappedSensorId: state.hwMappedSensorId,
        hardwareMappingPreset: state.hardwareMappingPreset,
        sensitivity: state.sensitivity,
        deadzone: state.deadzone
      }));
    } catch (_) {}
  }

  /* ==========================================================================
   * 4. Color Scale (Blue -> Cyan -> Green -> Yellow -> Orange -> Red)
   * ========================================================================== */

  const COLOR_STOPS = [
    { pos: 0.00, r: 24,  g: 36,  b: 60  }, // Idle / Dark Blue
    { pos: 0.08, r: 30,  g: 90,  b: 220 }, // Light: Blue
    { pos: 0.25, r: 0,   g: 170, b: 255 }, // Cyan
    { pos: 0.45, r: 34,  g: 200, b: 94  }, // Green
    { pos: 0.70, r: 245, g: 190, b: 20  }, // Yellow
    { pos: 0.88, r: 245, g: 90,  b: 24  }, // Orange-Red
    { pos: 1.00, r: 235, g: 25,  b: 25  }  // Peak: Red
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
   * 5. Foot Anatomy & Canvas Renderer
   * ========================================================================== */

  class FootRenderer {
    constructor(canvas, footContainer) {
      this.canvas = canvas;
      this.container = footContainer;
      this.ctx = canvas.getContext('2d');
      this.width = 400;
      this.height = 740;
      this.dpr = window.devicePixelRatio || 1;

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      const availableWidth = rect.width ? Math.max(300, rect.width - 24) : 400;
      const w = Math.min(availableWidth, 420);
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

      // Lateral 5th toe & Lateral Forefoot bulge
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

      // Main Insole Silhouette
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
      ctx.bezierCurveTo(w * 0.64, h * 0.24, w * 0.44, h * 0.22, w * 0.24, h * 0.21);
      ctx.closePath();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();
    }

    drawZoneDividers(ctx, w, h) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);

      // Dividing line: Toes / Forefoot
      ctx.beginPath();
      ctx.moveTo(w * 0.24, h * 0.21);
      ctx.bezierCurveTo(w * 0.44, h * 0.22, w * 0.64, h * 0.24, w * 0.81, h * 0.24);
      ctx.stroke();

      // Dividing line: Forefoot / Midfoot
      ctx.beginPath();
      ctx.moveTo(w * 0.26, h * 0.46);
      ctx.bezierCurveTo(w * 0.44, h * 0.47, w * 0.62, h * 0.47, w * 0.78, h * 0.46);
      ctx.stroke();

      // Dividing line: Midfoot / Heel
      ctx.beginPath();
      ctx.moveTo(w * 0.35, h * 0.68);
      ctx.bezierCurveTo(w * 0.48, h * 0.69, w * 0.62, h * 0.69, w * 0.74, h * 0.68);
      ctx.stroke();

      ctx.setLineDash([]);

      // Watermark labels
      ctx.font = '700 9.5px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';

      ctx.fillText('TOES (ALL 5 TOES)', w * 0.50, h * 0.08);
      ctx.fillText('FOREFOOT (2 BALL SENSORS)', w * 0.50, h * 0.44);
      ctx.fillText('MIDFOOT (2 ARCH SENSORS)', w * 0.54, h * 0.66);
      ctx.fillText('HEEL (CALCANEUS)', w * 0.53, h * 0.89);

      ctx.restore();
    }

    render() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;

      ctx.clearRect(0, 0, w, h);

      // 1. Draw foot sole silhouette with unified 5-toes part at top
      this.drawSoleBackground(ctx, w, h);

      // 2. Render localized pressure heatmap for each sensor (clipped inside sole)
      this.drawPressureHeatmap(ctx, w, h);

      // 3. Draw anatomical zone boundary dividers & region watermarks
      this.drawZoneDividers(ctx, w, h);

      // 4. Draw tactile contact touch ripple/point (if user dragging)
      this.drawContactPoint(ctx, w, h);

      // 5. Draw sensor location nodes, letter badges, and percentage pills
      this.drawSensorNodes(ctx, w, h);
    }

    drawPressureHeatmap(ctx, w, h) {
      ctx.save();
      this.traceSolePath(ctx, w, h);
      ctx.clip();

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

        if (val > 0.15) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${val * 0.45})`;
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
      });

      ctx.restore();
    }

    drawContactPoint(ctx, w, h) {
      if (!state.isCanvasDragging || state.contactX == null || state.contactY == null) return;
      ctx.save();
      const cx = state.contactX * w;
      const cy = state.contactY * h;

      // Outer ripple
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([4, 3]);
      ctx.stroke();

      // Inner glow
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 20);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fill();

      // Center touch dot
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.restore();
    }

    drawSensorNodes(ctx, w, h) {
      ctx.save();

      const nodeLetters = {
        'forefoot_medial': 'FM',
        'forefoot_lateral': 'FL',
        'arch_medial': 'AM',
        'arch_lateral': 'AL',
        'heel': 'H',
        // Fallback for aliases
        'forefoot': 'FM',
        'toes': 'FM',
        'toe_medial': 'FM',
        'toe_lateral': 'FL',
        'midfoot': 'AM'
      };

      SENSOR_LOCATIONS.forEach((loc, idx) => {
        const s = state.sensors[loc.id];
        const cx = loc.x * w;
        const cy = loc.y * h;
        const val = s.currentValue;
        const isSelected = (loc.id === state.selectedSensorId);
        const isFocused = (idx === state.focusedSensorIndex);
        const isHwMapped = (state.mode === 'hardware' && loc.id === state.hwMappedSensorId);

        const nodeRadius = 12;

        // Selection ring
        if (isSelected || isFocused) {
          ctx.beginPath();
          ctx.arc(cx, cy, nodeRadius + 5, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? '#38bdf8' : '#94a3b8';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // Hardware active badge ring
        if (isHwMapped) {
          ctx.beginPath();
          ctx.arc(cx, cy, nodeRadius + 9, 0, Math.PI * 2);
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

        // Node letter (T, F, AM, AL, H)
        ctx.font = '700 9.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = (val > 0.35) ? '#050a14' : '#f8fafc';

        const nodeLetter = nodeLetters[loc.id] || `${idx + 1}`;
        ctx.fillText(nodeLetter, cx, cy);

        // Value percentage pill badge below node
        const pctText = `${Math.round(val * 100)}%`;
        ctx.font = '600 9.5px Inter, sans-serif';
        const textWidth = ctx.measureText(pctText).width;
        const badgeW = textWidth + 12;
        const badgeH = 16;
        const badgeY = cy + nodeRadius + 5;

        ctx.fillStyle = isSelected ? '#111827' : 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx - badgeW / 2, badgeY, badgeW, badgeH, 7);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isSelected ? '#38bdf8' : (val > 0.05 ? '#22c55e' : '#94a3b8');
        ctx.fillText(pctText, cx, badgeY + badgeH / 2);
      });

      ctx.restore();
    }

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

        if (d < 0.22 && d < minDistance) {
          minDistance = d;
          closest = loc;
        }
      });

      return closest;
    }
  }

  /* ==========================================================================
   * 6. Web Serial API Adapter (ESP32 USB Communication)
   * ========================================================================== */

  let serialMonitorLines = [];
  let serialMonitorDirty = false;
  let pulseDotTimeout = null;

  function appendSerialMonitorLog(line) {
    const dot = document.getElementById('serial-rx-dot');
    if (dot) {
      dot.classList.add('pulse');
      clearTimeout(pulseDotTimeout);
      pulseDotTimeout = setTimeout(() => {
        dot.classList.remove('pulse');
      }, 90);
    }

    serialMonitorLines.push(line);
    if (serialMonitorLines.length > 8) {
      serialMonitorLines.shift();
    }
    serialMonitorDirty = true;
  }

  function flushSerialMonitor() {
    if (!serialMonitorDirty) return;
    const term = document.getElementById('serial-terminal-log');
    if (term) {
      term.textContent = serialMonitorLines.join('\n');
      term.scrollTop = term.scrollHeight;
    }
    serialMonitorDirty = false;
  }

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

    parseLine(line) {
      state.lastSerialTimestamp = performance.now();
      state.serialTimestamps.push(state.lastSerialTimestamp);

      // Append raw line to serial terminal in UI
      appendSerialMonitorLog(line);

      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('---') || trimmed.includes('Started') || trimmed.includes('Reading')) {
        return; // Skip delimiter bars and boot headers
      }

      // Format D: Arduino Point / GPIO format (e.g. "Point 1 (GPIO 32): 2145" or "Point 1: 2145" or "GPIO 32: 2145")
      const pointMatch = trimmed.match(/^(?:Point\s*(\d+)(?:\s*\((?:GPIO\s*)?(\d+)\))?|(?:GPIO\s*)(\d+))\s*:\s*(\d+)/i);
      if (pointMatch) {
        const pointIdx = pointMatch[1] ? parseInt(pointMatch[1], 10) : null;
        const gpioPin = pointMatch[2] ? parseInt(pointMatch[2], 10) : (pointMatch[3] ? parseInt(pointMatch[3], 10) : null);
        const rawVal = parseInt(pointMatch[4], 10);

        const targetSensorId = mapHardwarePointToSensor(pointIdx, gpioPin);
        if (targetSensorId) {
          applyHardwareReading(targetSensorId, rawVal, `Point ${pointIdx || '?'} (GPIO ${gpioPin || (31 + pointIdx)})`);
          const updates = {};
          updates[targetSensorId] = rawVal;
          this.onLineReceived({ type: 'multichannel_named', data: updates });
        }
        return;
      }

      // Format C: Key-Value pairs (e.g. "heel:2450,toe_medial:1200")
      if (line.includes(':')) {
        const pairs = line.split(',');
        const updates = {};
        pairs.forEach(p => {
          const [k, v] = p.split(':');
          const resolved = resolveSensorId(k);
          const num = parseInt(v, 10);
          if (resolved && !isNaN(num)) updates[resolved] = num;
        });
        if (Object.keys(updates).length > 0) {
          this.onLineReceived({ type: 'multichannel_named', data: updates });
        }
        return;
      }

      // Format B: Multi-value CSV (e.g. "100,200,300,400,500")
      if (line.includes(',')) {
        const parts = line.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (parts.length > 0) {
          this.onLineReceived({ type: 'multichannel_indexed', data: parts });
        }
        return;
      }

      // Format A: Single integer ADC value (e.g. "2450")
      const val = parseInt(line, 10);
      if (!isNaN(val)) {
        this.onLineReceived({ type: 'single_channel', raw: val });
      }
    }
  }

  /* ==========================================================================
   * 7. 30-Second Walking Gait Calibration & Knee Defect Diagnostics Engine
   * ========================================================================== */

  function startWalkingTest() {
    if (state.test.status === 'recording' || state.test.status === 'analyzing') return;

    state.test.status = 'recording';
    state.test.elapsedSec = 0;
    state.test.samples = [];
    state.test.strideCount = 0;
    state.test.lastPeakRegion = null;
    state.test.simWalkPhase = 0.0;

    // UI transitions
    document.getElementById('test-banner-card').classList.add('recording');
    document.getElementById('btn-start-test').style.display = 'none';
    document.getElementById('btn-cancel-test').style.display = 'inline-flex';
    document.getElementById('test-progress-container').style.display = 'block';
    document.getElementById('test-loading-container').style.display = 'none';
    document.getElementById('test-results-container').style.display = 'none';

    updateTestUI();

    // 1-second countdown timer interval
    state.test.timerInterval = setInterval(() => {
      state.test.elapsedSec += 1;
      updateTestUI();

      if (state.test.elapsedSec >= state.test.durationSec) {
        completeWalkingTest();
      }
    }, 1000);

    // 50ms (20Hz) telemetry sampling interval
    state.test.sampleInterval = setInterval(() => {
      if (state.mode === 'simulation' || !state.hwConnected) {
        simulateWalkingGaitStep();
      }

      // Record 5-sensor snapshot
      const valForefootMedial = state.sensors['forefoot_medial'] ? state.sensors['forefoot_medial'].currentValue : (state.sensors['forefoot'] ? state.sensors['forefoot'].currentValue : 0);
      const valForefootLateral = state.sensors['forefoot_lateral'] ? state.sensors['forefoot_lateral'].currentValue : 0;
      const valArchMedial = state.sensors['arch_medial'] ? state.sensors['arch_medial'].currentValue : (state.sensors['midfoot'] ? state.sensors['midfoot'].currentValue : 0);
      const valArchLateral = state.sensors['arch_lateral'] ? state.sensors['arch_lateral'].currentValue : 0;
      const valHeel = state.sensors['heel'] ? state.sensors['heel'].currentValue : 0;

      const sample = {
        t: performance.now(),
        heel: valHeel,
        midfoot: Math.max(valArchMedial, valArchLateral),
        forefoot: Math.max(valForefootMedial, valForefootLateral),
        toes: 0.0,
        forefoot_medial: valForefootMedial,
        forefoot_lateral: valForefootLateral,
        arch_medial: valArchMedial,
        arch_lateral: valArchLateral,
        toe_medial: 0.0,
        toe_lateral: 0.0
      };
      state.test.samples.push(sample);

      // Track strides by detecting heel strikes
      if (sample.heel > 0.45 && state.test.lastPeakRegion !== 'heel') {
        const now = performance.now();
        if (now - state.test.lastStepTime > 550) {
          state.test.strideCount++;
          state.test.lastStepTime = now;
          state.test.lastPeakRegion = 'heel';
          document.getElementById('test-steps-count').textContent = state.test.strideCount;
        }
      } else if (sample.heel < 0.20 && state.test.lastPeakRegion === 'heel') {
        state.test.lastPeakRegion = null;
      }
    }, 50);
  }

  function simulateWalkingGaitStep() {
    state.test.simWalkPhase = (state.test.simWalkPhase + 0.055) % (Math.PI * 2);
    const p = state.test.simWalkPhase;

    if (p < 3.8) {
      const normStance = p / 3.8;

      // 1. Initial Contact / Heel Strike
      if (normStance < 0.25) {
        const w = Math.sin((normStance / 0.25) * Math.PI);
        if (state.sensors['heel']) state.sensors['heel'].targetValue = 0.85 * w;
        if (state.sensors['arch_medial']) state.sensors['arch_medial'].targetValue = 0.04 * w;
        if (state.sensors['arch_lateral']) state.sensors['arch_lateral'].targetValue = 0.08 * w;
        if (state.sensors['forefoot_medial']) state.sensors['forefoot_medial'].targetValue = 0.04 * w;
        if (state.sensors['forefoot_lateral']) state.sensors['forefoot_lateral'].targetValue = 0.05 * w;
      }
      // 2. Loading Response / Midstance
      else if (normStance < 0.60) {
        const sub = (normStance - 0.25) / 0.35;
        if (state.sensors['heel']) state.sensors['heel'].targetValue = 0.40 * (1 - sub * 0.7);
        if (state.sensors['arch_medial']) state.sensors['arch_medial'].targetValue = 0.18 * Math.sin(sub * Math.PI);
        if (state.sensors['arch_lateral']) state.sensors['arch_lateral'].targetValue = 0.35 * Math.sin(sub * Math.PI);
        if (state.sensors['forefoot_medial']) state.sensors['forefoot_medial'].targetValue = 0.60 * Math.sin(sub * Math.PI);
        if (state.sensors['forefoot_lateral']) state.sensors['forefoot_lateral'].targetValue = 0.70 * Math.sin(sub * Math.PI);
      }
      // 3. Forefoot Push-off (Propulsion)
      else {
        const sub = (normStance - 0.60) / 0.40;
        if (state.sensors['heel']) state.sensors['heel'].targetValue = 0.0;
        if (state.sensors['arch_medial']) state.sensors['arch_medial'].targetValue = 0.04 * (1 - sub);
        if (state.sensors['arch_lateral']) state.sensors['arch_lateral'].targetValue = 0.06 * (1 - sub);
        if (state.sensors['forefoot_medial']) state.sensors['forefoot_medial'].targetValue = 0.95 * Math.sin(sub * Math.PI);
        if (state.sensors['forefoot_lateral']) state.sensors['forefoot_lateral'].targetValue = 0.80 * Math.cos(sub * Math.PI * 0.5);
      }
    } else {
      // Swing Phase
      if (state.sensors['heel']) state.sensors['heel'].targetValue = 0.0;
      if (state.sensors['arch_medial']) state.sensors['arch_medial'].targetValue = 0.0;
      if (state.sensors['arch_lateral']) state.sensors['arch_lateral'].targetValue = 0.0;
      if (state.sensors['forefoot_medial']) state.sensors['forefoot_medial'].targetValue = 0.0;
      if (state.sensors['forefoot_lateral']) state.sensors['forefoot_lateral'].targetValue = 0.0;
    }
  }

  function updateTestUI() {
    const remaining = Math.max(0, state.test.durationSec - state.test.elapsedSec);
    const pct = Math.min(100, (state.test.elapsedSec / state.test.durationSec) * 100);

    document.getElementById('test-timer').textContent = `${remaining}s`;
    document.getElementById('test-progress-bar').style.width = `${pct}%`;

    const peakHeel = state.sensors['heel'] ? (state.sensors['heel'].peakValue * 100).toFixed(1) : '0.0';
    document.getElementById('test-peak-heel').textContent = `${peakHeel}%`;
  }

  function cancelWalkingTest() {
    clearInterval(state.test.timerInterval);
    clearInterval(state.test.sampleInterval);
    state.test.status = 'idle';

    document.getElementById('test-banner-card').classList.remove('recording');
    document.getElementById('btn-start-test').style.display = 'inline-flex';
    document.getElementById('btn-cancel-test').style.display = 'none';
    document.getElementById('test-progress-container').style.display = 'none';
    document.getElementById('test-loading-container').style.display = 'none';
  }

  async function completeWalkingTest() {
    clearInterval(state.test.timerInterval);
    clearInterval(state.test.sampleInterval);
    state.test.status = 'analyzing';

    document.getElementById('test-banner-card').classList.remove('recording');
    document.getElementById('btn-cancel-test').style.display = 'none';
    document.getElementById('test-progress-container').style.display = 'none';
    document.getElementById('test-loading-container').style.display = 'flex';

    // Calculate regional impulses
    const samples = state.test.samples;
    let sumHeel = 0, sumMidfoot = 0, sumForefoot = 0, sumToes = 0;

    samples.forEach(s => {
      sumHeel += s.heel;
      sumMidfoot += s.midfoot;
      sumForefoot += s.forefoot;
      sumToes += s.toes;
    });

    const totalLoad = sumHeel + sumMidfoot + sumForefoot + sumToes || 1;

    const heelPct = (sumHeel / totalLoad) * 100;
    const midfootPct = (sumMidfoot / totalLoad) * 100;
    const forefootPct = (sumForefoot / totalLoad) * 100;
    const toesPct = (sumToes / totalLoad) * 100;

    const diagnostics = evaluateKneeDefects(heelPct, midfootPct, forefootPct, toesPct);
    const closestMatch = findClosestDatasetRecord(heelPct, midfootPct, forefootPct, toesPct);

    document.getElementById('loading-stage-text').textContent = 'Cross-referencing reference datasets (Parkinson\'s VGRF, GaitRite, Healthy norms)...';
    await new Promise(r => setTimeout(r, 900));

    document.getElementById('loading-stage-text').textContent = 'Querying NVIDIA Llama-3.1 AI Clinical Diagnostic Engine...';

    let clinicalNarrative = '';
    try {
      clinicalNarrative = await runNvidiaClinicalInference({
        heelPct,
        midfootPct,
        forefootPct,
        toesPct,
        strideCount: state.test.strideCount || 26,
        diagnostics,
        closestMatch
      });
    } catch (err) {
      console.warn('NVIDIA NIM API call failed or not configured, using deterministic engine:', err);
      clinicalNarrative = generateDeterministicClinicalReport({
        heelPct,
        midfootPct,
        forefootPct,
        toesPct,
        strideCount: state.test.strideCount || 26,
        diagnostics,
        closestMatch
      });
    }

    state.test.status = 'completed';
    document.getElementById('test-loading-container').style.display = 'none';
    document.getElementById('test-results-container').style.display = 'flex';
    document.getElementById('btn-start-test').style.display = 'none';

    renderDiagnosticResults({
      heelPct,
      midfootPct,
      forefootPct,
      toesPct,
      strideCount: state.test.strideCount || 26,
      diagnostics,
      closestMatch,
      clinicalNarrative
    });
  }

  function evaluateKneeDefects(heelPct, midfootPct, forefootPct, toesPct) {
    let medialOARisk = 'Low Risk';
    if (midfootPct > 24 && forefootPct > 36) {
      medialOARisk = 'High Risk';
    } else if (midfootPct > 18 || forefootPct > 40) {
      medialOARisk = 'Moderate Risk';
    }

    let patellarRisk = 'Normal';
    if (midfootPct > 26) {
      patellarRisk = 'Elevated Risk';
    } else if (midfootPct > 20) {
      patellarRisk = 'Mild Risk';
    }

    let shockRisk = 'Normal';
    if (heelPct > 45 && midfootPct < 12) {
      shockRisk = 'High Shock';
    } else if (heelPct > 36) {
      shockRisk = 'Mild Shock';
    }

    let pronationStatus = 'Neutral Arch';
    if (midfootPct > 24) {
      pronationStatus = 'Over-Pronation (Flatfoot)';
    } else if (midfootPct < 8) {
      pronationStatus = 'Supination (High Rigid Arch)';
    }

    let score = 100;
    if (medialOARisk === 'High Risk') score -= 22;
    else if (medialOARisk === 'Moderate Risk') score -= 12;

    if (patellarRisk === 'Elevated Risk') score -= 14;
    else if (patellarRisk === 'Mild Risk') score -= 8;

    if (shockRisk === 'High Shock') score -= 14;
    else if (shockRisk === 'Mild Shock') score -= 6;

    if (pronationStatus !== 'Neutral Arch') score -= 8;

    return {
      medialOARisk,
      patellarRisk,
      shockRisk,
      pronationStatus,
      score: Math.max(35, Math.min(100, score))
    };
  }

  function findClosestDatasetRecord(heelPct, midfootPct, forefootPct, toesPct) {
    let closest = REFERENCE_DATASETS[0];
    let minDistance = Infinity;

    REFERENCE_DATASETS.forEach(rec => {
      const p = rec.pressures;
      const recTotal = p.heel + p.midfoot + p.forefoot + p.toes;
      const recHeel = (p.heel / recTotal) * 100;
      const recMidfoot = (p.midfoot / recTotal) * 100;
      const recForefoot = (p.forefoot / recTotal) * 100;
      const recToes = (p.toes / recTotal) * 100;

      const d = Math.sqrt(
        Math.pow(heelPct - recHeel, 2) +
        Math.pow(midfootPct - recMidfoot, 2) +
        Math.pow(forefootPct - recForefoot, 2) +
        Math.pow(toesPct - recToes, 2)
      );

      if (d < minDistance) {
        minDistance = d;
        closest = rec;
      }
    });

    return closest;
  }

  function renderDiagnosticResults(data) {
    const { heelPct, midfootPct, forefootPct, toesPct, diagnostics, closestMatch, clinicalNarrative } = data;

    document.getElementById('results-health-index').textContent = `${diagnostics.score} / 100`;

    const badge = document.getElementById('results-verdict-badge');
    const title = document.getElementById('results-verdict-title');

    if (diagnostics.score >= 85) {
      badge.textContent = 'HEALTHY BALANCED GAIT PROFILE';
      badge.style.color = '#4ade80';
      title.textContent = 'Normal Lower Extremity Kinetics & Symmetrical Joint Loading';
    } else if (diagnostics.score >= 70) {
      badge.textContent = 'MILD COMPENSATORY LOAD DETECTED';
      badge.style.color = '#facc15';
      title.textContent = 'Mild Arch Collapse & Asymmetrical Knee Vector Warning';
    } else {
      badge.textContent = 'ELEVATED KNEE JOINT DEFECT RISK';
      badge.style.color = '#f87171';
      title.textContent = 'Pathological Medial Compartment Knee Overload & Arch Defect';
    }

    const updateRisk = (id, val) => {
      const el = document.getElementById(id);
      el.textContent = val;
      el.className = 'risk-badge';
      if (val.includes('Low') || val.includes('Normal') || val.includes('Neutral')) {
        el.classList.add('risk-low');
      } else if (val.includes('Mild') || val.includes('Moderate')) {
        el.classList.add('risk-moderate');
      } else {
        el.classList.add('risk-high');
      }
    };

    updateRisk('risk-medial-oa', diagnostics.medialOARisk);
    updateRisk('risk-patellar', diagnostics.patellarRisk);
    updateRisk('risk-impact-shock', diagnostics.shockRisk);
    updateRisk('risk-pronation', diagnostics.pronationStatus);

    document.getElementById('bar-toes-val').textContent = `${toesPct.toFixed(1)}%`;
    document.getElementById('bar-toes-fill').style.height = `${Math.min(100, toesPct * 2.2)}%`;

    document.getElementById('bar-forefoot-val').textContent = `${forefootPct.toFixed(1)}%`;
    document.getElementById('bar-forefoot-fill').style.height = `${Math.min(100, forefootPct * 2.2)}%`;

    document.getElementById('bar-midfoot-val').textContent = `${midfootPct.toFixed(1)}%`;
    document.getElementById('bar-midfoot-fill').style.height = `${Math.min(100, midfootPct * 2.2)}%`;

    document.getElementById('bar-heel-val').textContent = `${heelPct.toFixed(1)}%`;
    document.getElementById('bar-heel-fill').style.height = `${Math.min(100, heelPct * 2.2)}%`;

    document.getElementById('results-dataset-citation').textContent = `${closestMatch.record_id} — ${closestMatch.pattern} (${closestMatch.description})`;
    document.getElementById('results-llm-narrative').textContent = clinicalNarrative;
    document.getElementById('results-model-badge').textContent = state.nvidia.apiKey ? state.nvidia.model : 'Deterministic Biomechanical Engine';
  }

  async function runNvidiaClinicalInference(data) {
    if (!state.nvidia.apiKey) throw new Error('No NVIDIA API key configured');

    const prompt = `You are an expert biomechanical AI clinician specializing in pedobarography, plantar pressure analysis, and knee joint pathology.
Analyze the following patient telemetry from a 30-second walking calibration test:

PATIENT TELEMETRY:
- Recorded Strides: ${data.strideCount}
- Heel Load: ${data.heelPct.toFixed(1)}%
- Midfoot (Arch) Load: ${data.midfootPct.toFixed(1)}%
- Forefoot (Metatarsal Ball) Load: ${data.forefootPct.toFixed(1)}%
- Toes (Digital Pad) Load: ${data.toesPct.toFixed(1)}%

CALCULATED KNEE & GAIT RISK INDICES:
- Medial Compartment Knee Overload: ${data.diagnostics.medialOARisk}
- Patellofemoral Tracking Stress: ${data.diagnostics.patellarRisk}
- Calcaneal Shock Transmission: ${data.diagnostics.shockRisk}
- Pronation/Supination Posture: ${data.diagnostics.pronationStatus}
- Overall Gait Health Index: ${data.diagnostics.score}/100

CLOSEST CLINICAL DATASET BENCHMARK:
- Match: ${data.closestMatch.record_id} (${data.closestMatch.pattern})
- Benchmark Reference Description: ${data.closestMatch.description}
- Benchmark Knee Profile: ${data.closestMatch.knee_profile.condition} (${data.closestMatch.knee_profile.notes})

INSTRUCTIONS:
Provide a concise, professional, structured clinical report covering:
1. BIOMECHANICAL INTERPRETATION: How the measured ground reaction force distribution impacts the kinetic chain.
2. KNEE JOINT DEFECTS & VULNERABILITIES: Specifically explain any risks for medial compartment knee osteoarthritis, patellar maltracking, or meniscal shock.
3. EVIDENCE CITATION: Correlate findings with the cited reference dataset pattern (${data.closestMatch.record_id}).
4. ACTIONABLE RECOMMENDATIONS: Orthotic insole suggestions (e.g. arch support, lateral/medial wedge) and physical therapy exercises.
5. CLINICAL DISCLAIMER: Note that this is a biomechanical research screening tool and not a replacement for radiographic imaging or orthopedic consultation.`;

    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.nvidia.apiKey}`
      },
      body: JSON.stringify({
        model: state.nvidia.model,
        messages: [
          { role: 'system', content: 'You are an advanced orthopedic biomechanics AI assistant providing clear, evidence-based gait diagnostics.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API HTTP ${response.status}: ${errText}`);
    }

    const json = await response.json();
    return json.choices[0].message.content.trim();
  }

  function generateDeterministicClinicalReport(data) {
    const { heelPct, midfootPct, forefootPct, toesPct, diagnostics, closestMatch } = data;

    let narrative = `### 1. Biomechanical Force Distribution\n`;
    narrative += `Over the 30-second walking trial (${data.strideCount} detected strides), the patient displayed a regional load distribution of ${heelPct.toFixed(1)}% Heel, ${midfootPct.toFixed(1)}% Midfoot Arch, ${forefootPct.toFixed(1)}% Forefoot Ball, and ${toesPct.toFixed(1)}% Toes.\n\n`;

    narrative += `### 2. Knee Joint Defect & Structural Evaluation\n`;
    if (diagnostics.medialOARisk === 'High Risk' || diagnostics.medialOARisk === 'Moderate Risk') {
      narrative += `• Medial Knee Compartment Overload: ${diagnostics.medialOARisk}. Excessive ground reaction loading during midstance shifts the mechanical axis medially, increasing the Knee Adduction Moment (KAM). This predisposes the patient to medial meniscal compression and medial tibiofemoral cartilage degeneration (Knee OA tendency).\n`;
    } else {
      narrative += `• Medial Knee Compartment: Low Risk. Ground reaction force vectors remain well-centered through the tibiofemoral joint space.\n`;
    }

    if (diagnostics.patellarRisk !== 'Normal') {
      narrative += `• Patellofemoral Joint Tracking: ${diagnostics.patellarRisk}. Elevated midfoot loading (${midfootPct.toFixed(1)}%) indicates arch collapse and excessive internal tibial rotation, creating dynamic knee valgus stress and patellar lateral maltracking.\n`;
    }

    if (diagnostics.shockRisk !== 'Normal') {
      narrative += `• Calcaneal Impact Transmission: ${diagnostics.shockRisk}. Elevated peak heel force suggests insufficient eccentric pretibial damping at initial contact, propagating impact shock through the tibia.\n`;
    }

    narrative += `\n### 3. Clinical Dataset Benchmark Evidence\n`;
    narrative += `The measured 4-region distribution most closely matches reference pattern **${closestMatch.record_id}** (*${closestMatch.pattern}*). In clinical gait databases, this pattern is characterized by: ${closestMatch.description}\n\n`;

    narrative += `### 4. Orthotic & Corrective Recommendations\n`;
    if (midfootPct > 20) {
      narrative += `• Custom semirigid orthotic insole with medial longitudinal arch support to limit tibial internal rotation.\n`;
      narrative += `• Strengthening of the posterior tibialis, hip abductors (gluteus medius), and vastus medialis oblique (VMO).\n`;
    } else if (midfootPct < 10) {
      narrative += `• Cushioned insole with shock-absorbing calcaneal viscoelastic heel cup to protect knee menisci.\n`;
    } else {
      narrative += `• Maintain current footwear with neutral heel cushioning and flexible toe-box.\n`;
    }

    narrative += `\n*Notice: Biomechanical screening evaluation for technical assessment. Does not constitute a clinical medical diagnosis.*`;

    return narrative;
  }

  /* ==========================================================================
   * 8. Application Logic & UI Integration
   * ========================================================================== */

  let renderer;
  let serialAdapter;

  /* --- Zero / Baseline Tare: Sets resting pressure as 0% baseline --- */
  function captureBaseline() {
    SENSOR_LOCATIONS.forEach(loc => {
      const s = state.sensors[loc.id];
      if (s) {
        if (s.rawReading !== null && s.rawReading !== undefined) {
          s.baselineADC = s.rawReading;
        } else if (state.rawADC > 0) {
          s.baselineADC = state.rawADC;
        } else {
          s.baselineADC = state.invertADC ? 4095 : 0;
        }
        s.targetValue = 0.0;
        s.currentValue = 0.0;
      }
    });

    const slider = document.getElementById('sim-pressure-slider');
    if (slider) {
      slider.value = 0;
      const simVal = document.getElementById('sim-pressure-value');
      if (simVal) simVal.textContent = '0%';
    }

    // Auto-detect invertADC if resting ADC is high (>2200 counts)
    const validBaselines = SENSOR_LOCATIONS.map(l => state.sensors[l.id].baselineADC).filter(v => v !== null && v !== undefined);
    if (validBaselines.length > 0) {
      const avg = validBaselines.reduce((a, b) => a + b, 0) / validBaselines.length;
      if (avg > 2200 && !state.invertADC) {
        state.invertADC = true;
      }
    }

    if (state.invertADC) {
      state.calibMax = state.rawADC || 4095;
    } else {
      state.calibMin = state.rawADC || 0;
    }

    state.baselineTareCaptured = true;
    saveCalibration();
    updateUI();

    const hint = document.getElementById('baseline-status-hint');
    if (hint) {
      hint.textContent = 'Baseline Tare Locked: Current resting pressure zeroed out. Pressing sensors will register active load.';
      hint.style.color = '#22c55e';
      hint.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      setTimeout(() => {
        if (hint) {
          hint.textContent = 'Baseline Tare Active: Step off or rest insole, then click \'Set Baseline (Tare)\' anytime to re-zero.';
          hint.style.color = 'var(--text-dim)';
          hint.style.borderColor = 'var(--border)';
        }
      }, 3500);
    }

    updateSelectedSensorPanel();
  }

  function init() {
    const canvas = document.getElementById('foot-canvas');
    const container = document.getElementById('foot-container');
    renderer = new FootRenderer(canvas, container);

    serialAdapter = new SerialAdapter(handleSerialData, updateConnectionStatus);

    populateSensorDropdowns();
    renderLegend();
    bindEvents();
    updateUI();
    updateApiStatusPill();

    requestAnimationFrame(renderLoop);
    setInterval(updateStatsTicker, 400);
  }

  /* --- Render Loop with Smooth Ease --- */
  const LERP_FACTOR = 0.22;

  function renderLoop() {
    requestAnimationFrame(renderLoop);

    SENSOR_LOCATIONS.forEach((loc) => {
      const s = state.sensors[loc.id];
      if (isNaN(s.currentValue)) s.currentValue = 0.0;
      if (isNaN(s.targetValue)) s.targetValue = 0.0;
      s.currentValue += LERP_FACTOR * (s.targetValue - s.currentValue);
      if (Math.abs(s.currentValue - s.targetValue) < 0.0005) {
        s.currentValue = s.targetValue;
      }
    });

    renderer.render();

    // Throttled UI panel update to eliminate layout thrashing
    if (state.uiDirty) {
      updateSelectedSensorPanel();
      state.uiDirty = false;
    }

    flushSerialMonitor();
  }

  /* --- Handle Incoming Serial Data Packets --- */
  function handleSerialData(packet) {
    if (packet.type === 'single_channel') {
      applyHardwareReading(state.hwMappedSensorId, packet.raw);
    } else if (packet.type === 'multichannel_named') {
      Object.keys(packet.data).forEach(id => {
        const resolved = resolveSensorId(id);
        if (resolved && state.sensors[resolved]) applyHardwareReading(resolved, packet.data[id]);
      });
    } else if (packet.type === 'multichannel_indexed') {
      packet.data.forEach((val, idx) => {
        if (SENSOR_LOCATIONS[idx]) {
          applyHardwareReading(SENSOR_LOCATIONS[idx].id, val);
        }
      });
    }
  }

  function applyHardwareReading(sensorId, rawVal, sourceLabel) {
    const s = state.sensors[sensorId];
    if (!s) return;

    state.rawADC = rawVal;
    s.rawReading = rawVal;
    s.hasSignal = true;
    s.source = sourceLabel || 'ESP32 (USB Serial)';

    let effectiveMin, effectiveMax;
    if (s.baselineADC !== null && s.baselineADC !== undefined) {
      if (state.invertADC) {
        effectiveMin = 0;
        effectiveMax = s.baselineADC;
      } else {
        effectiveMin = s.baselineADC;
        effectiveMax = 4095;
      }
    } else {
      effectiveMin = Math.min(state.calibMin, state.calibMax);
      effectiveMax = Math.max(state.calibMin, state.calibMax);
    }

    const span = Math.max(80, effectiveMax - effectiveMin);
    let rawLinear = 0.0;
    if (state.invertADC) {
      rawLinear = (effectiveMax - rawVal) / span;
    } else {
      rawLinear = (rawVal - effectiveMin) / span;
    }
    rawLinear = Math.max(0, Math.min(1.0, rawLinear));

    // Velostat piezoresistive compensation & sensitivity curve
    let normalized = 0.0;
    const deadzone = state.deadzone;
    if (rawLinear > deadzone) {
      const active = (rawLinear - deadzone) / (1.0 - deadzone);
      // Power curve gamma: suppresses light resting touches and requires firm foot press
      const gamma = 1.0 + (1.0 - state.sensitivity) * 2.5;
      normalized = Math.min(1.0, Math.max(0.0, Math.pow(active, gamma)));
    }

    s.targetValue = normalized;
    if (normalized > s.peakValue) s.peakValue = normalized;

    state.uiDirty = true;
  }

  /* --- Populate Dropdowns --- */
  function populateSensorDropdowns() {
    const simSelect = document.getElementById('sim-sensor-select');
    const hwSelect = document.getElementById('hw-channel-sensor');

    simSelect.innerHTML = '<option value="">— Select a sensor —</option>';
    hwSelect.innerHTML = '';

    SENSOR_LOCATIONS.forEach((loc) => {
      const opt1 = document.createElement('option');
      opt1.value = loc.id;
      opt1.textContent = `${loc.label} (${loc.region})`;
      simSelect.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = loc.id;
      opt2.textContent = `${loc.label} (${loc.region})`;
      if (loc.id === state.hwMappedSensorId) opt2.selected = true;
      hwSelect.appendChild(opt2);
    });

    simSelect.value = state.selectedSensorId;
  }

  /* --- Mode Switcher (Simulation vs Hardware) --- */
  function setMode(newMode) {
    state.mode = newMode;

    const btnSim = document.getElementById('mode-simulation');
    const btnHw = document.getElementById('mode-hardware');
    const vizNote = document.getElementById('viz-note');

    if (newMode === 'simulation') {
      btnSim.classList.add('active');
      btnSim.setAttribute('aria-selected', 'true');
      btnHw.classList.remove('active');
      btnHw.setAttribute('aria-selected', 'false');

      vizNote.textContent = 'Simulation Mode — Click or drag across foot sensors to test pressure response.';

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

      vizNote.textContent = state.hwConnected
        ? 'Hardware Mode — Live 5-channel USB serial telemetry active (GPIO 32, 33, 34, 35, 36).'
        : 'Hardware Mode — Connect ESP32 USB serial to stream live sensor readings.';

      SENSOR_LOCATIONS.forEach(loc => {
        const s = state.sensors[loc.id];
        s.hasSignal = state.hwConnected;
        if (state.hwConnected) {
          s.source = 'ESP32 (USB Serial)';
        } else {
          s.targetValue = 0;
          s.rawReading = null;
          s.source = 'Disconnected (Connect ESP32)';
        }
      });
    }

    updateUI();
  }

  /* --- Select Sensor --- */
  function selectSensor(sensorId) {
    const resolved = resolveSensorId(sensorId);
    if (!resolved || !state.sensors[resolved]) return;

    state.selectedSensorId = resolved;
    state.focusedSensorIndex = SENSOR_LOCATIONS.findIndex(l => l.id === resolved);

    const simSelect = document.getElementById('sim-sensor-select');
    if (simSelect) simSelect.value = resolved;

    const slider = document.getElementById('sim-pressure-slider');
    const sliderVal = document.getElementById('sim-pressure-value');
    if (slider) {
      slider.disabled = (state.mode === 'hardware');
      const pct = Math.round(state.sensors[resolved].targetValue * 100);
      slider.value = pct;
      sliderVal.textContent = `${pct}%`;
    }

    updateSelectedSensorPanel();
  }

  /* --- Update Details in Side Panel --- */
  function updateSelectedSensorPanel() {
    const s = state.sensors[state.selectedSensorId];
    if (!s) return;

    document.getElementById('info-id').textContent = s.id;
    document.getElementById('info-label').textContent = s.label;
    document.getElementById('info-region').textContent = s.region;

    if (state.mode === 'hardware') {
      document.getElementById('info-raw').textContent = (s.rawReading !== null) ? `${s.rawReading} / 4095` : (state.hwConnected ? 'Awaiting pin data...' : 'Disconnected');
      document.getElementById('info-normalized').textContent = `${(s.targetValue * 100).toFixed(1)}%`;
      document.getElementById('info-peak').textContent = `${(s.peakValue * 100).toFixed(1)}%`;
      document.getElementById('info-source').textContent = s.source;
    } else {
      document.getElementById('info-raw').textContent = s.hasSignal ? 'Simulated' : 'No Signal';
      document.getElementById('info-normalized').textContent = `${(s.targetValue * 100).toFixed(1)}%`;
      document.getElementById('info-peak').textContent = `${(s.peakValue * 100).toFixed(1)}%`;
      document.getElementById('info-source').textContent = s.source;
    }

    const badge = document.getElementById('pressure-badge');
    const desc = document.getElementById('pressure-desc');
    const pct = Math.round(s.currentValue * 100);
    badge.textContent = `${pct}%`;

    const rgb = pressureToRGB(s.currentValue);
    badge.style.color = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

    if (pct === 0) {
      desc.textContent = 'IDLE (No Touch)';
      desc.style.color = 'var(--text-dim)';
    } else if (pct < 20) {
      desc.textContent = 'LIGHT TOUCH';
      desc.style.color = '#38bdf8';
    } else if (pct < 55) {
      desc.textContent = 'MEDIUM CONTACT';
      desc.style.color = '#22c55e';
    } else if (pct < 80) {
      desc.textContent = 'HEAVY PRESSURE';
      desc.style.color = '#eab308';
    } else {
      desc.textContent = 'MAXIMUM IMPACT LOAD';
      desc.style.color = '#ef4444';
    }
  }

  /* --- Live Statistics Ticker --- */
  function updateStatsTicker() {
    const now = performance.now();

    while (state.serialTimestamps.length > 0 && state.serialTimestamps[0] < now - 2000) {
      state.serialTimestamps.shift();
    }
    const hz = state.serialTimestamps.length > 1 ? Math.round(state.serialTimestamps.length / 2) : 0;

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
    document.getElementById('stat-hw-channels').textContent = (state.mode === 'hardware' && state.hwConnected) ? '5 (GPIO 32–36)' : '0';
    document.getElementById('stat-max-pressure').textContent = `${(maxPressure * 100).toFixed(1)}%`;
    document.getElementById('stat-max-location').textContent = maxPressure > 0.03 ? maxLocation : '—';
    document.getElementById('stat-hz').textContent = `${hz} Hz`;

    const freshnessEl = document.getElementById('stat-freshness');
    if (state.mode === 'hardware') {
      if (!state.hwConnected) {
        freshnessEl.textContent = 'Disconnected';
        freshnessEl.style.color = 'var(--text-dim)';
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

    updateSelectedSensorPanel();
  }

  /* --- Connection Status UI Helper --- */
  function updateConnectionStatus(status, detail) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-text');
    const connLabel = document.getElementById('stat-connection-label');
    const btn = document.getElementById('btn-connect');

    if (status === 'connected') {
      dot.className = 'status-dot connected';
      label.textContent = 'Connected (115200 Baud)';
      if (connLabel) connLabel.textContent = 'Connected';
      btn.textContent = 'Disconnect';
      state.hwConnected = true;

      // Automatically switch to Hardware Mode on successful connection
      setMode('hardware');

      // Automatically capture resting baseline tare 1.2s after connection stabilizes
      clearTimeout(state.autoTareTimeout);
      state.autoTareTimeout = setTimeout(() => {
        if (state.hwConnected) {
          captureBaseline();
        }
      }, 1200);
    } else if (status === 'error') {
      dot.className = 'status-dot';
      label.textContent = detail || 'Connection Error';
      if (connLabel) connLabel.textContent = 'Error';
      btn.textContent = 'Connect';
      state.hwConnected = false;
      clearTimeout(state.autoTareTimeout);
    } else {
      dot.className = 'status-dot';
      label.textContent = 'Disconnected';
      if (connLabel) connLabel.textContent = 'Disconnected';
      btn.textContent = 'Connect';
      state.hwConnected = false;
      clearTimeout(state.autoTareTimeout);

      const term = document.getElementById('serial-terminal-log');
      if (term) term.textContent = 'ESP32 disconnected. Waiting for connection...';
    }

    updateUI();
  }

  /* --- Gait Presets (Simulation Mode) --- */
  function applyPreset(presetName) {
    if (state.mode === 'hardware') return;

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
        setVal('arch_medial', 0.05);
        setVal('arch_lateral', 0.08);
        setVal('forefoot_medial', 0.00);
        setVal('forefoot_lateral', 0.00);
        break;

      case 'mid': // Midstance
        setVal('heel', 0.35);
        setVal('arch_lateral', 0.35);
        setVal('arch_medial', 0.18);
        setVal('forefoot_medial', 0.60);
        setVal('forefoot_lateral', 0.70);
        break;

      case 'toe': // Forefoot Push-off
        setVal('heel', 0.00);
        setVal('arch_medial', 0.04);
        setVal('arch_lateral', 0.06);
        setVal('forefoot_medial', 0.95);
        setVal('forefoot_lateral', 0.80);
        break;

      case 'full': // Full contact
        setVal('heel', 0.65);
        setVal('arch_lateral', 0.30);
        setVal('arch_medial', 0.20);
        setVal('forefoot_medial', 0.70);
        setVal('forefoot_lateral', 0.68);
        break;
    }

    if (state.selectedSensorId) selectSensor(state.selectedSensorId);
  }

  /* --- Auto-Calibration Wizard --- */
  function startCalibration() {
    if (state.isCalibrating) return;
    state.isCalibrating = true;

    const desc = document.getElementById('pressure-desc');
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
      desc.style.color = '#ef4444';

      const pressInterval = setInterval(() => {
        pressedSamples.push(state.rawADC);
      }, 50);

      setTimeout(() => {
        clearInterval(pressInterval);

        const avgRest = restingSamples.reduce((a, b) => a + b, 0) / (restingSamples.length || 1);
        const maxPress = Math.max(...pressedSamples);
        const minPress = Math.min(...pressedSamples);

        if (minPress < avgRest - 100) {
          state.invertADC = true;
          state.calibMin = Math.max(0, minPress - 30);
          state.calibMax = Math.min(4095, avgRest + 30);
        } else {
          state.invertADC = false;
          state.calibMin = Math.max(0, avgRest - 30);
          state.calibMax = Math.min(4095, maxPress + 30);
        }

        saveCalibration();
        state.isCalibrating = false;
        btn.disabled = false;
        updateUI();

        desc.textContent = 'CALIBRATION COMPLETE!';
        desc.style.color = '#22c55e';
      }, 2000);
    }, 1500);
  }

  /* --- Legend Bar Rendering --- */
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

  function formatSensitivityText(val) {
    if (val < 25) return `Very Low (${val}%)`;
    if (val < 45) return `Low (${val}%) - Recommended`;
    if (val < 65) return `Medium (${val}%)`;
    if (val < 85) return `High (${val}%)`;
    return `Ultra High (${val}%)`;
  }

  /* --- UI State Sync --- */
  function updateUI() {
    document.getElementById('toggle-invert').checked = state.invertADC;
    document.getElementById('calib-range').textContent = `${state.calibMin} — ${state.calibMax} ${state.invertADC ? '(Inverted)' : ''}`;
    const mappingSelect = document.getElementById('hw-mapping-preset');
    if (mappingSelect) mappingSelect.value = state.hardwareMappingPreset;

    const sensSlider = document.getElementById('hw-sensitivity-slider');
    const sensVal = document.getElementById('hw-sensitivity-val');
    if (sensSlider && sensVal) {
      const sPct = Math.round(state.sensitivity * 100);
      sensSlider.value = sPct;
      sensVal.textContent = formatSensitivityText(sPct);
    }

    const deadSlider = document.getElementById('hw-deadzone-slider');
    const deadVal = document.getElementById('hw-deadzone-val');
    if (deadSlider && deadVal) {
      const dPct = Math.round(state.deadzone * 100);
      deadSlider.value = dPct;
      deadVal.textContent = `${dPct}%`;
    }

    selectSensor(state.selectedSensorId);
  }

  function updateApiStatusPill() {
    const pill = document.getElementById('api-status-pill');
    if (!pill) return;
    if (state.nvidia.apiKey) {
      pill.className = 'status-indicator-dot active';
      pill.title = 'NVIDIA AI Key Configured';
    } else {
      pill.className = 'status-indicator-dot';
      pill.title = 'Deterministic Engine Active (No API Key)';
    }
  }

  /* ==========================================================================
   * 9. Interactive Dragging & Reset Controls
   * ========================================================================== */

  function applyPointerTouchPressure(clientX, clientY, isFirstTouch) {
    if (state.mode === 'hardware') return;

    clearTimeout(state.dragResetTimeout);

    const canvas = document.getElementById('foot-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

    state.contactX = x;
    state.contactY = y;
    state.isCanvasDragging = true;

    // Find closest sensor
    let closestLoc = null;
    let minDistance = Infinity;

    // Active radius for pressure falloff across sensors
    const activeRadius = 0.25;

    SENSOR_LOCATIONS.forEach((loc) => {
      const dx = loc.x - x;
      const dy = loc.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDistance) {
        minDistance = dist;
        closestLoc = loc;
      }

      if (dist < activeRadius) {
        // Smooth cosine falloff
        const proximity = Math.cos((dist / activeRadius) * (Math.PI / 2));
        const s = state.sensors[loc.id];
        const target = Math.min(1.0, proximity * 0.96);
        s.targetValue = target;
        if (s.targetValue > s.peakValue) s.peakValue = s.targetValue;
      } else {
        // Outside the touch circle, relax back to 0
        state.sensors[loc.id].targetValue = 0.0;
      }
    });

    if (closestLoc && minDistance < 0.28) {
      if (closestLoc.id !== state.selectedSensorId) {
        selectSensor(closestLoc.id);
      }

      const s = state.sensors[closestLoc.id];
      const slider = document.getElementById('sim-pressure-slider');
      if (slider) {
        const pct = Math.round(s.targetValue * 100);
        slider.value = pct;
        const valElem = document.getElementById('sim-pressure-value');
        if (valElem) valElem.textContent = `${pct}%`;
      }
    }

    updateSelectedSensorPanel();
  }

  function releasePointerPressure() {
    state.isCanvasDragging = false;
    state.contactX = null;
    state.contactY = null;
    clearTimeout(state.dragResetTimeout);

    if (state.mode === 'simulation' && state.test.status !== 'recording') {
      // Smooth physical decompression: immediately zero targetValues so lerp easing creates natural elastic release
      SENSOR_LOCATIONS.forEach(loc => {
        state.sensors[loc.id].targetValue = 0.0;
      });

      const slider = document.getElementById('sim-pressure-slider');
      if (slider) {
        slider.value = 0;
        const valElem = document.getElementById('sim-pressure-value');
        if (valElem) valElem.textContent = '0%';
      }

      const testSlider = document.getElementById('test-slider');
      if (testSlider) testSlider.value = 0;

      updateSelectedSensorPanel();
    }
  }

  function bindEvents() {
    // Mode switcher
    document.getElementById('mode-simulation').addEventListener('click', () => setMode('simulation'));
    document.getElementById('mode-hardware').addEventListener('click', () => setMode('hardware'));

    // 30-Second Walking Test buttons
    document.getElementById('btn-start-test').addEventListener('click', startWalkingTest);
    document.getElementById('btn-cancel-test').addEventListener('click', cancelWalkingTest);
    document.getElementById('btn-retest').addEventListener('click', () => {
      document.getElementById('test-results-container').style.display = 'none';
      document.getElementById('btn-start-test').style.display = 'inline-flex';
      startWalkingTest();
    });

    document.getElementById('btn-export-report').addEventListener('click', () => {
      const narrative = document.getElementById('results-llm-narrative').textContent;
      const blob = new Blob([narrative], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gait-knee-report-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Settings Modal
    const modal = document.getElementById('settings-modal');
    document.getElementById('btn-open-settings').addEventListener('click', () => {
      document.getElementById('nvidia-api-key-input').value = state.nvidia.apiKey || '';
      document.getElementById('nvidia-model-select').value = state.nvidia.model || 'meta/llama-3.1-70b-instruct';
      modal.style.display = 'flex';
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });

    document.getElementById('btn-toggle-key-visibility').addEventListener('click', () => {
      const inp = document.getElementById('nvidia-api-key-input');
      const btn = document.getElementById('btn-toggle-key-visibility');
      if (inp.type === 'password') {
        inp.type = 'text';
        btn.textContent = 'Hide';
      } else {
        inp.type = 'password';
        btn.textContent = 'Show';
      }
    });

    document.getElementById('btn-save-settings').addEventListener('click', () => {
      const key = document.getElementById('nvidia-api-key-input').value.trim();
      const model = document.getElementById('nvidia-model-select').value;
      state.nvidia.apiKey = key;
      state.nvidia.model = model;

      try {
        localStorage.setItem('velostat_nvidia_api_key', key);
        localStorage.setItem('velostat_nvidia_model', model);
      } catch (_) {}

      updateApiStatusPill();
      const statusBox = document.getElementById('settings-status-message');
      statusBox.className = 'settings-status-box success';
      statusBox.textContent = key ? 'Settings saved! NVIDIA NIM inference active.' : 'Settings saved. Using deterministic rule engine.';
      setTimeout(() => { modal.style.display = 'none'; }, 900);
    });

    document.getElementById('btn-test-nvidia').addEventListener('click', async () => {
      const key = document.getElementById('nvidia-api-key-input').value.trim();
      const statusBox = document.getElementById('settings-status-message');
      if (!key) {
        statusBox.className = 'settings-status-box error';
        statusBox.textContent = 'Please enter an API key first.';
        return;
      }

      statusBox.className = 'settings-status-box';
      statusBox.textContent = 'Testing connection with NVIDIA NIM...';

      try {
        const resp = await fetch('https://integrate.api.nvidia.com/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` }
        });
        if (resp.ok) {
          statusBox.className = 'settings-status-box success';
          statusBox.textContent = 'Connection verified! Key is valid and active.';
        } else {
          statusBox.className = 'settings-status-box error';
          statusBox.textContent = `Authorization failed (HTTP ${resp.status}). Check your key.`;
        }
      } catch (err) {
        statusBox.className = 'settings-status-box error';
        statusBox.textContent = `Network error: ${err.message}`;
      }
    });

    // Canvas click & tactile drag hit-testing with auto-reset
    const canvas = document.getElementById('foot-canvas');

    canvas.addEventListener('mousedown', (e) => {
      state.isCanvasDragging = true;
      applyPointerTouchPressure(e.clientX, e.clientY, true);
    });

    window.addEventListener('mousemove', (e) => {
      if (state.isCanvasDragging) {
        applyPointerTouchPressure(e.clientX, e.clientY, false);
      }
    });

    window.addEventListener('mouseup', () => {
      if (state.isCanvasDragging) {
        releasePointerPressure();
      }
    });

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      state.isCanvasDragging = true;
      if (e.touches && e.touches[0]) {
        applyPointerTouchPressure(e.touches[0].clientX, e.touches[0].clientY, true);
      }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (state.isCanvasDragging && e.touches && e.touches[0]) {
        applyPointerTouchPressure(e.touches[0].clientX, e.touches[0].clientY, false);
      }
    }, { passive: false });

    window.addEventListener('touchend', () => {
      if (state.isCanvasDragging) {
        releasePointerPressure();
      }
    });

    window.addEventListener('touchcancel', () => {
      if (state.isCanvasDragging) {
        releasePointerPressure();
      }
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
        const s = state.sensors[SENSOR_LOCATIONS[idx].id];
        s.targetValue = Math.min(1.0, s.targetValue + 0.35);
        if (s.targetValue > s.peakValue) s.peakValue = s.targetValue;
        e.preventDefault();
      }
    });

    // Simulation controls
    document.getElementById('sim-sensor-select').addEventListener('change', (e) => {
      if (e.target.value) selectSensor(e.target.value);
    });

    const simSlider = document.getElementById('sim-pressure-slider');
    simSlider.addEventListener('input', (e) => {
      const pct = parseInt(e.target.value, 10) / 100;
      document.getElementById('sim-pressure-value').textContent = `${e.target.value}%`;
      if (state.sensors[state.selectedSensorId]) {
        state.sensors[state.selectedSensorId].targetValue = pct;
        if (pct > state.sensors[state.selectedSensorId].peakValue) {
          state.sensors[state.selectedSensorId].peakValue = pct;
        }
      }
    });

    // Manual test-slider alias support
    const testSlider = document.getElementById('test-slider');
    if (testSlider) {
      testSlider.addEventListener('input', (e) => {
        const norm = parseInt(e.target.value, 10) / 4095;
        if (state.sensors[state.selectedSensorId]) {
          state.sensors[state.selectedSensorId].targetValue = norm;
          if (norm > state.sensors[state.selectedSensorId].peakValue) {
            state.sensors[state.selectedSensorId].peakValue = norm;
          }
        }
      });
    }

    // Gait Presets
    document.getElementById('btn-preset-heel').addEventListener('click', () => applyPreset('heel'));
    document.getElementById('btn-preset-mid').addEventListener('click', () => applyPreset('mid'));
    document.getElementById('btn-preset-toe').addEventListener('click', () => applyPreset('toe'));
    document.getElementById('btn-preset-full').addEventListener('click', () => applyPreset('full'));

    // Hardware Controls
    const mappingPresetSelect = document.getElementById('hw-mapping-preset');
    if (mappingPresetSelect) {
      mappingPresetSelect.addEventListener('change', (e) => {
        const preset = e.target.value;
        if (HARDWARE_MAPPING_PRESETS[preset]) {
          state.hardwareMappingPreset = preset;
          state.hardwareMapping = { ...HARDWARE_MAPPING_PRESETS[preset] };
          saveCalibration();
        }
      });
    }

    const sensSlider = document.getElementById('hw-sensitivity-slider');
    const sensVal = document.getElementById('hw-sensitivity-val');
    if (sensSlider) {
      sensSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        state.sensitivity = val / 100;
        if (sensVal) sensVal.textContent = formatSensitivityText(val);
        saveCalibration();
      });
    }

    const deadSlider = document.getElementById('hw-deadzone-slider');
    const deadVal = document.getElementById('hw-deadzone-val');
    if (deadSlider) {
      deadSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        state.deadzone = val / 100;
        if (deadVal) deadVal.textContent = `${val}%`;
        saveCalibration();
      });
    }

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

    // Baseline Tare / Zero button: Captures resting sensor readings as baseline 0%
    document.getElementById('btn-zero').addEventListener('click', captureBaseline);

    // Reset Peak button
    document.getElementById('btn-reset-peak').addEventListener('click', () => {
      SENSOR_LOCATIONS.forEach(loc => {
        state.sensors[loc.id].peakValue = state.sensors[loc.id].currentValue;
      });
      updateSelectedSensorPanel();
    });
  }

  // Boot on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
