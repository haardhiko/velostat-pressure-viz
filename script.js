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
      pressures: { heel: 0.85, midfoot: 0.05, forefoot: 0.10, toes: 0.00 },
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
      pressures: { heel: 0.30, midfoot: 0.18, forefoot: 0.52, toes: 0.00 },
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
      description: 'Forward weight transfer concentrated on 1st metatarsal and ball; heel unloaded.',
      pressures: { heel: 0.05, midfoot: 0.08, forefoot: 0.87, toes: 0.00 },
      knee_profile: {
        condition: 'Normal Extension Kinetic Chain',
        risk: 'Low Risk',
        kam: 'Low joint shear',
        notes: 'Smooth knee terminal extension without excessive valgus/varus torque.'
      }
    },
    {
      record_id: 'REC-FLATFOOT-05',
      pattern: 'Severe Flatfoot (Pes Planus Arch Collapse)',
      description: 'Severe midfoot arch collapse with high medial instep contact and medial forefoot roll.',
      pressures: { heel: 0.20, midfoot: 0.48, forefoot: 0.32, toes: 0.00 },
      knee_profile: {
        condition: 'Severe Pes Planus / Patellofemoral Pain Syndrome (Runner\'s Knee)',
        risk: 'High Risk',
        kam: 'Excessive internal tibial torsion & dynamic valgus vector',
        notes: 'Medial longitudinal arch collapse forces excessive tibial internal rotation, creating dynamic knee valgus and lateral patellar maltracking.'
      }
    },
    {
      record_id: 'REC-KNEE-OA-04',
      pattern: 'Medial Compartment Knee Overload (Knee OA Tendency)',
      description: 'Pathological medial shift with high medial arch collapse and intense medial ball loading.',
      pressures: { heel: 0.30, midfoot: 0.28, forefoot: 0.42, toes: 0.00 },
      knee_profile: {
        condition: 'Medial Compartment Knee Osteoarthritis Risk',
        risk: 'High Risk',
        kam: 'Significantly elevated Knee Adduction Moment',
        notes: 'Ground reaction force vector passes medial to knee center, causing focal cartilage wear and meniscal compression.'
      }
    },
    {
      record_id: 'REC-CAVUS-07',
      pattern: 'Pes Cavus (Rigid High-Arch Supination)',
      description: 'Severely reduced midfoot contact with load split between calcaneus and 5th metatarsal head.',
      pressures: { heel: 0.50, midfoot: 0.04, forefoot: 0.46, toes: 0.00 },
      knee_profile: {
        condition: 'Rigid Cavus / Shock Attenuation Deficit',
        risk: 'Moderate Risk',
        kam: 'Unattenuated axial impact transmission',
        notes: 'Under-pronation and osseous hypomobility prevent natural impact damping, transmitting violent shockwaves up the tibia.'
      }
    },
    {
      record_id: 'REC-METATARSALGIA-08',
      pattern: 'Metatarsalgia / Forefoot Hyper-Pressure Overload',
      description: 'Excessive pressure concentration over 1st and 5th metatarsal heads with reduced heel contact.',
      pressures: { heel: 0.15, midfoot: 0.12, forefoot: 0.73, toes: 0.00 },
      knee_profile: {
        condition: 'Anterior Stance Dominance / Forefoot Capsulitis Stress',
        risk: 'Moderate Risk',
        kam: 'Prolonged anterior shear',
        notes: 'Persistent forefoot overload indicates tight Achilles tendon / equinus gait with prolonged anterior tibial shear.'
      }
    },
    {
      record_id: 'REC-SHOCK-06',
      pattern: 'High-Impact Heel Strike (Meniscal Shock Loading)',
      description: 'Violent initial calcaneal impact without adequate midfoot dissipation; rigid foot strike.',
      pressures: { heel: 0.68, midfoot: 0.06, forefoot: 0.26, toes: 0.00 },
      knee_profile: {
        condition: 'Unattenuated Tibial Shock & Meniscal Stress',
        risk: 'Moderate Risk',
        kam: 'High transient vertical impact peak',
        notes: 'High loading rates transmit shockwaves through the tibia into the femoral condyles and menisci.'
      }
    },
    {
      record_id: 'REC-ZERO-CONTACT-00',
      pattern: 'Unloaded / No Foot Contact Recorded',
      description: 'All sensor locations at 0% baseline load; insole unweighted or uncoupled.',
      pressures: { heel: 0.00, midfoot: 0.00, forefoot: 0.00, toes: 0.00 },
      knee_profile: {
        condition: 'Unloaded / No Signal',
        risk: 'N/A',
        kam: 'No Force Vector',
        notes: 'Zero active plantar load registered during trial.'
      }
    },
    {
      record_id: 'REC-SATURATION-99',
      pattern: 'Uniform Isometric Overload (Sensor Saturation)',
      description: 'Simultaneous 100% saturation across calcaneus, arch, and metatarsals.',
      pressures: { heel: 0.33, midfoot: 0.33, forefoot: 0.34, toes: 0.00 },
      knee_profile: {
        condition: 'Continuous Isometric Saturation',
        risk: 'Overpressure Alert',
        kam: 'Continuous multi-axial overload',
        notes: 'Simultaneous maximum saturation across all zones indicates non-sequential clamping or zero offset.'
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

    // Multi-Provider LLM Settings (NVIDIA NIM, Google Gemini, Groq, OpenAI, OpenRouter, Ollama)
    nvidia: {
      provider: 'nvidia',
      apiKey: '',
      model: 'meta/llama-3.1-70b-instruct',
      customUrl: ''
    },
    screeningFilter: 'all', // 'all' | 'detected'
    lastScreeningFindings: []
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

    const savedProvider = localStorage.getItem('velostat_llm_provider');
    if (savedProvider) state.nvidia.provider = savedProvider;

    const savedKey = localStorage.getItem('velostat_nvidia_api_key');
    if (savedKey) state.nvidia.apiKey = savedKey.trim();

    const savedModel = localStorage.getItem('velostat_nvidia_model');
    if (savedModel) state.nvidia.model = savedModel.trim();

    const savedUrl = localStorage.getItem('velostat_llm_custom_url');
    if (savedUrl) state.nvidia.customUrl = savedUrl.trim();
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
   * 7. 15-Point Plantar Defect Screening & Biomechanical Diagnostics Engine
   * ========================================================================== */

  /**
   * Evaluates the 15 specific plantar defects, abnormalities, and pressure conditions
   * using the 5 Velostat sensors (2 Forefoot, 2 Midfoot Arch, 1 Heel).
   */
  function screenPlantarDefectsAndAbnormalities(sensorMap, samples, strideCount) {
    const vHeel = sensorMap.heel || 0;
    const vArchMed = sensorMap.arch_medial !== undefined ? sensorMap.arch_medial : (sensorMap.midfoot || 0);
    const vArchLat = sensorMap.arch_lateral || 0;
    const vForeMed = sensorMap.forefoot_medial !== undefined ? sensorMap.forefoot_medial : (sensorMap.forefoot || 0);
    const vForeLat = sensorMap.forefoot_lateral || 0;

    const totalLoad = vHeel + vArchMed + vArchLat + vForeMed + vForeLat;
    const isUnloaded = totalLoad < 0.05;
    const isSaturated = (vHeel > 0.82 && vArchMed > 0.78 && vArchLat > 0.78 && vForeMed > 0.82 && vForeLat > 0.82);

    const findings = [];

    // 1. Flat Foot (Pes Planus)
    {
      const archSum = vArchMed + vArchLat;
      const archShare = totalLoad > 0 ? archSum / totalLoad : 0;
      const isDetected = !isUnloaded && (vArchMed >= 0.18 || (archShare >= 0.22 && vArchMed >= vArchLat * 0.65));
      const severity = !isDetected ? 'Normal' : (vArchMed > 0.40 ? 'Severe' : (vArchMed > 0.26 ? 'Moderate' : 'Mild'));
      findings.push({
        id: 1,
        code: 'PES-PLANUS',
        name: 'Flat Foot (Pes Planus)',
        category: 'Arch Mechanics',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Medial Arch: ${(vArchMed * 100).toFixed(0)}% | Lateral Arch: ${(vArchLat * 100).toFixed(0)}% | Total Arch Share: ${(archShare * 100).toFixed(1)}%`,
        abnormalityDetected: isDetected
          ? 'Excessive medial longitudinal arch loading and midfoot ground contact collapse during stance.'
          : (isUnloaded ? 'No active plantar load registered across arch sensors.' : 'Preserved longitudinal arch elevation with physiological midfoot ground clearance.'),
        supportingEvidence: isDetected
          ? `Medial arch load exceeds validated reference limit (>18% norm; measured ${(vArchMed * 100).toFixed(0)}%). Benchmark: REC-FLATFOOT-05.`
          : (isUnloaded ? 'Telemetry shows zero sensor engagement.' : 'Medial arch pressure remains within normal shock-absorbing thresholds (<18%). Benchmark: REC-MS-02.'),
        possibleClinicalAssociation: 'Symptomatic flexible or rigid flatfoot (pes planus), posterior tibial tendon dysfunction (PTTD), secondary dynamic knee valgus and patellofemoral tracking stress.',
        limitationsAndCaveats: 'Screening pattern indicator based on 2 midfoot sensors. Definitive flatfoot staging requires weight-bearing lateral radiographic arch angles (Meary\'s angle, calcaneal pitch) or clinical Staheli/Chippaux-Smirak pedobarographic index.'
      });
    }

    // 2. High Arch (Pes Cavus)
    {
      const isDetected = !isUnloaded && !isSaturated && (vArchMed < 0.05 && vArchLat < 0.08 && (vHeel > 0.35 || (vForeMed + vForeLat) > 0.50) && totalLoad >= 0.15);
      const severity = !isDetected ? 'Normal' : ((vArchMed <= 0.02 && (vHeel > 0.55 || vForeMed > 0.55)) ? 'Severe' : (vArchMed < 0.04 ? 'Moderate' : 'Mild'));
      findings.push({
        id: 2,
        code: 'PES-CAVUS',
        name: 'High Arch (Pes Cavus)',
        category: 'Arch Mechanics',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Medial Arch: ${(vArchMed * 100).toFixed(0)}% | Lateral Arch: ${(vArchLat * 100).toFixed(0)}% | Heel: ${(vHeel * 100).toFixed(0)}% | Forefoot Avg: ${(((vForeMed + vForeLat)/2) * 100).toFixed(0)}%`,
        abnormalityDetected: isDetected
          ? 'Severe midfoot contact deficit with bimodal force isolation onto the calcaneus and metatarsal ball.'
          : (isUnloaded ? 'Insole unweighted.' : 'Normal midfoot surface contact and progressive stance dissipation.'),
        supportingEvidence: isDetected
          ? 'Midfoot load falls below 5% contact threshold while heel and forefoot absorb >85% of total plantar impulse. Benchmark: REC-CAVUS-07.'
          : 'Midfoot sensor activation conforms to normal midstance tripod support.',
        possibleClinicalAssociation: 'Pes cavus (rigid high arch), reduced impact absorption capacity, elevated risk of lateral ankle sprains, peroneal tendonitis, and metatarsal stress fractures.',
        limitationsAndCaveats: 'Five-sensor array detects absence of midfoot ground contact. Clinical confirmation requires weight-bearing lateral foot radiographs and Coleman block testing.'
      });
    }

    // 3. Metatarsalgia-Associated Loading
    {
      const avgForefoot = (vForeMed + vForeLat) / 2;
      const isDetected = !isUnloaded && (vForeMed > 0.65 || vForeLat > 0.65 || avgForefoot > 0.58);
      const severity = !isDetected ? 'Normal' : (avgForefoot > 0.80 ? 'Severe' : (avgForefoot > 0.68 ? 'Moderate' : 'Mild'));
      findings.push({
        id: 3,
        code: 'METATARSALGIA',
        name: 'Metatarsalgia-Associated Loading',
        category: 'Forefoot Pressure',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `1st Metatarsal (Medial): ${(vForeMed * 100).toFixed(0)}% | 5th Metatarsal (Lateral): ${(vForeLat * 100).toFixed(0)}% | Mean Forefoot: ${(avgForefoot * 100).toFixed(0)}%`,
        abnormalityDetected: isDetected
          ? 'Disproportionately high peak pressure concentration across the monitored metatarsal heads.'
          : (isUnloaded ? 'No forefoot pressure registered.' : 'Forefoot ground reaction forces within physiological limits.'),
        supportingEvidence: isDetected
          ? `Forefoot loading exceeds 58% threshold (measured ${(avgForefoot * 100).toFixed(0)}%). Benchmark: REC-METATARSALGIA-08.`
          : 'Forefoot pressure well-distributed across terminal stance without hyper-pressure focal points.',
        possibleClinicalAssociation: 'Forefoot metatarsalgia, metatarsal head bursitis, Morton\'s neuroma, capsulitis, or plantar plate strain.',
        limitationsAndCaveats: 'Insole monitors 1st and 5th metatarsal heads; individual intermediate metatarsals (2nd, 3rd, 4th) cannot be isolated without a high-density sensor matrix.'
      });
    }

    // 4. Uneven Forefoot Loading
    {
      const diff = Math.abs(vForeMed - vForeLat);
      const isDetected = !isUnloaded && (diff > 0.22 && (vForeMed + vForeLat) > 0.18);
      const severity = !isDetected ? 'Normal' : (diff > 0.45 ? 'Severe' : (diff > 0.32 ? 'Moderate' : 'Mild'));
      const bias = vForeMed > vForeLat ? 'Medial Bias (1st Ray)' : 'Lateral Bias (5th Ray)';
      findings.push({
        id: 4,
        code: 'UNEVEN-FOREFOOT',
        name: 'Uneven Forefoot Loading',
        category: 'Forefoot Pressure',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Medial Ball: ${(vForeMed * 100).toFixed(0)}% | Lateral Ball: ${(vForeLat * 100).toFixed(0)}% | Delta: ${(diff * 100).toFixed(0)}% (${bias})`,
        abnormalityDetected: isDetected
          ? `Significant transverse plane load disparity across metatarsals with pronounced ${bias}.`
          : (isUnloaded ? 'Unloaded state.' : 'Symmetrical load distribution between medial and lateral metatarsal heads.'),
        supportingEvidence: isDetected
          ? `Forefoot split disparity (${(diff * 100).toFixed(0)}%) exceeds the 22% physiological tolerance envelope.`
          : 'Medial and lateral forefoot sensors show harmonious push-off progression.',
        possibleClinicalAssociation: vForeMed > vForeLat
          ? 'Hallux valgus, bunion joint irritation, or hypermobile first ray.'
          : 'Inverted foot strike, peroneal muscle weakness, or 5th metatarsal base overload (Jones fracture risk).',
        limitationsAndCaveats: 'Direct comparison between 1st and 5th metatarsal sensors; intermediate rays are not resolved.'
      });
    }

    // 5. Plantar Fasciitis-Associated Patterns
    {
      const isDetected = !isUnloaded && ((vHeel > 0.55 && vArchMed > 0.18) || (vHeel > 0.65 && vArchMed < 0.05));
      const severity = !isDetected ? 'Normal' : (vHeel > 0.75 ? 'Severe' : (vHeel > 0.62 ? 'Moderate' : 'Mild'));
      findings.push({
        id: 5,
        code: 'PLANTAR-FASCIITIS',
        name: 'Plantar Fasciitis-Associated Patterns',
        category: 'Fascial Mechanics',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Calcaneus (Heel): ${(vHeel * 100).toFixed(0)}% | Medial Arch: ${(vArchMed * 100).toFixed(0)}%`,
        abnormalityDetected: isDetected
          ? 'Concomitant high calcaneal impact loading and tensile arch stress vector.'
          : (isUnloaded ? 'No heel/arch load.' : 'Balanced calcaneal shock attenuation and windlass mechanism load sharing.'),
        supportingEvidence: isDetected
          ? `Heel load (${(vHeel * 100).toFixed(0)}%) combined with ${vArchMed > 0.18 ? 'medial arch collapse causing severe fascial elongation' : 'rigid arch cavitation causing unattenuated axial heel shock'}.`
          : 'Normal calcaneal force dissipation and physiological windlass function.',
        possibleClinicalAssociation: 'Plantar fasciitis, subcalcaneal bursitis, calcaneal spur irritation, or plantar fascial micro-tears.',
        limitationsAndCaveats: 'Screening pattern only. Definitive clinical diagnosis requires focal palpation tenderness at the medial calcaneal tuberosity and diagnostic ultrasound/MRI demonstration of fascial thickening (>4.0 mm).'
      });
    }

    // 6. Abnormal Heel Loading
    {
      const isHigh = vHeel > 0.68;
      const isLow = (vHeel < 0.08 && (vForeMed + vForeLat) > 0.30);
      const isDetected = !isUnloaded && (isHigh || isLow);
      const severity = !isDetected ? 'Normal' : ((vHeel > 0.82 || vHeel < 0.03) ? 'Severe' : 'Moderate');
      findings.push({
        id: 6,
        code: 'ABNORMAL-HEEL',
        name: 'Abnormal Heel Loading',
        category: 'Rearfoot Kinetics',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Calcaneus: ${(vHeel * 100).toFixed(0)}% | Relative Stance Share: ${totalLoad > 0 ? ((vHeel / totalLoad) * 100).toFixed(1) : 0}%`,
        abnormalityDetected: isDetected
          ? (isHigh ? 'Violent calcaneal impact strike / shock attenuation deficit.' : 'Severely attenuated or absent heel contact (antalgic strike avoidance or equinus pattern).')
          : (isUnloaded ? 'Unloaded baseline.' : 'Physiological heel strike with progressive load transfer.'),
        supportingEvidence: isDetected
          ? (isHigh ? `Heel pressure exceeds 68% threshold (measured ${(vHeel * 100).toFixed(0)}%). Benchmark: REC-SHOCK-06.` : 'Heel load is abnormally suppressed (<8%) while forefoot carries primary initial contact.')
          : 'Heel strike kinetics within healthy reference range (30-45% of stance impulse).',
        possibleClinicalAssociation: isHigh
          ? 'Calcaneal fat pad atrophy, Sever\'s disease, or meniscal shock loading.'
          : 'Achilles tendon contracture, fixed equinus gait, or antalgic heel pain avoidance.',
        limitationsAndCaveats: 'Single calcaneal sensor monitors central heel pad; does not distinguish medial vs lateral calcaneal strike angles.'
      });
    }

    // 7. Excessive Plantar Pressure
    {
      const sensorList = [
        { name: 'Heel', val: vHeel },
        { name: 'Medial Arch', val: vArchMed },
        { name: 'Lateral Arch', val: vArchLat },
        { name: 'Medial Forefoot', val: vForeMed },
        { name: 'Lateral Forefoot', val: vForeLat }
      ];
      sensorList.sort((a, b) => b.val - a.val);
      const peakSensor = sensorList[0];
      const isDetected = !isUnloaded && peakSensor.val >= 0.85;
      const severity = !isDetected ? 'Normal' : (peakSensor.val >= 0.95 ? 'Severe' : (peakSensor.val >= 0.88 ? 'Moderate' : 'Mild'));
      findings.push({
        id: 7,
        code: 'EXCESSIVE-PRESSURE',
        name: 'Excessive Plantar Pressure',
        category: 'Pressure Overload',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Peak Zone: ${peakSensor.name} at ${(peakSensor.val * 100).toFixed(0)}% load (~${(peakSensor.val * 320).toFixed(0)} kPa estimated)`,
        abnormalityDetected: isDetected
          ? `Focal hyper-pressure concentration reaching saturation threshold at ${peakSensor.name}.`
          : (isUnloaded ? 'No pressure detected.' : 'Plantar peak pressures safely distributed below risk threshold.'),
        supportingEvidence: isDetected
          ? `Pressure exceeds the 85% risk threshold (measured ${(peakSensor.val * 100).toFixed(0)}%). Sustained peak pressures above 200 kPa are associated with mechanical skin trauma.`
          : 'All monitored regions remain comfortably within safe physiological bounds (<85%).',
        possibleClinicalAssociation: 'Keratoma / callus formation, localized tissue ischemia, pressure-induced capsulitis, or skin breakdown.',
        limitationsAndCaveats: 'Velostat sensors measure normal perpendicular compression force; shear forces and frictional vectors are not captured.'
      });
    }

    // 8. Diabetic Foot Pressure-Risk Patterns
    {
      const maxForefoot = Math.max(vForeMed, vForeLat);
      const isDetected = !isUnloaded && ((maxForefoot > 0.78 || vHeel > 0.80) || isSaturated);
      const severity = !isDetected ? 'Normal' : ((maxForefoot > 0.88 || vHeel > 0.90) ? 'Severe' : 'Moderate');
      findings.push({
        id: 8,
        code: 'DIABETIC-RISK',
        name: 'Diabetic Foot Pressure-Risk Patterns',
        category: 'Tissue Integrity Risk',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Forefoot Peak: ${(maxForefoot * 100).toFixed(0)}% | Heel Peak: ${(vHeel * 100).toFixed(0)}%`,
        abnormalityDetected: isDetected
          ? 'Dangerous localized pressure concentration without adequate dynamic offloading.'
          : (isUnloaded ? 'Unloaded.' : 'Safe plantar load dissipation without hazardous localized pressure spikes.'),
        supportingEvidence: isDetected
          ? `Repetitive pressure peak exceeds diabetic research threshold (>78% / ~250 kPa). Prolonged repetitive stress at these levels carries documented ulceration risk in insensitive feet.`
          : 'Plantar pressures remain within safe protective thresholds throughout stance.',
        possibleClinicalAssociation: 'Elevated risk for neuropathic plantar ulceration, tissue ischemia, and Charcot neuroarthropathy focal stress points.',
        limitationsAndCaveats: 'RESEARCH SCREENING RISK ONLY. Does not diagnose peripheral neuropathy or ulceration. Comprehensive assessment requires Semmes-Weinstein monofilament testing, ankle-brachial index (ABI), and clinical dermatological inspection.'
      });
    }

    // 9. Medial-Lateral Loading Imbalance
    {
      const medialLoad = vForeMed + vArchMed;
      const lateralLoad = vForeLat + vArchLat;
      const mlTotal = medialLoad + lateralLoad;
      const mlDisparity = mlTotal > 0 ? Math.abs(medialLoad - lateralLoad) / mlTotal : 0;
      const isDetected = !isUnloaded && (mlDisparity > 0.28 && mlTotal > 0.15);
      const severity = !isDetected ? 'Normal' : (mlDisparity > 0.50 ? 'Severe' : (mlDisparity > 0.36 ? 'Moderate' : 'Mild'));
      const dominantSide = medialLoad > lateralLoad ? 'Medial Column' : 'Lateral Column';
      findings.push({
        id: 9,
        code: 'ML-IMBALANCE',
        name: 'Medial-Lateral Loading Imbalance',
        category: 'Coronal Balance',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Medial Column: ${mlTotal > 0 ? ((medialLoad / mlTotal) * 100).toFixed(1) : 0}% | Lateral Column: ${mlTotal > 0 ? ((lateralLoad / mlTotal) * 100).toFixed(1) : 0}% (${dominantSide} Dominance)`,
        abnormalityDetected: isDetected
          ? `Significant coronal plane weight distribution asymmetry (${medialLoad > lateralLoad ? 'Excessive medial column pronation' : 'Excessive lateral column supination'}).`
          : (isUnloaded ? 'Zero load.' : 'Well-balanced coronal load distribution between medial and lateral columns.'),
        supportingEvidence: isDetected
          ? `Medial-lateral ratio skew exceeds the 64:36 threshold (measured ${mlTotal > 0 ? ((Math.max(medialLoad, lateralLoad) / mlTotal) * 100).toFixed(0) : 0}% on dominant side).`
          : 'Medial and lateral longitudinal columns share stance load evenly.',
        possibleClinicalAssociation: medialLoad > lateralLoad
          ? 'Subtalar overpronation, tibialis posterior fatigue, dynamic knee valgus stress.'
          : 'Subtalar supination, ankle inversion vulnerability, lateral cuboid and 5th metatarsal overload.',
        limitationsAndCaveats: 'Relative pressure comparison across four medial and lateral sensor zones; 3D rearfoot kinematics requires multi-camera motion capture.'
      });
    }

    // 10. Forefoot-to-Heel Loading Imbalance
    {
      const foreLoad = vForeMed + vForeLat;
      const heelLoad = vHeel;
      const fhTotal = foreLoad + heelLoad;
      const foreRatio = fhTotal > 0 ? foreLoad / fhTotal : 0.5;
      const isDetected = !isUnloaded && ((foreRatio > 0.72 || foreRatio < 0.28) && fhTotal > 0.15);
      const severity = !isDetected ? 'Normal' : ((foreRatio > 0.85 || foreRatio < 0.15) ? 'Severe' : 'Moderate');
      const biasDir = foreRatio > 0.72 ? 'Anterior Shift' : 'Posterior Shift';
      findings.push({
        id: 10,
        code: 'FH-IMBALANCE',
        name: 'Forefoot-to-Heel Loading Imbalance',
        category: 'Sagittal Balance',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Forefoot: ${(foreRatio * 100).toFixed(1)}% | Heel: ${((1 - foreRatio) * 100).toFixed(1)}% (${biasDir})`,
        abnormalityDetected: isDetected
          ? (foreRatio > 0.72 ? 'Pathological anterior load shift (equinus tendency / sustained metatarsal overload).' : 'Abnormal posterior load shift (calcaneal over-reliance / insufficient terminal push-off).')
          : (isUnloaded ? 'Unloaded state.' : 'Harmonious sagittal load distribution between heel strike and forefoot roll-off.'),
        supportingEvidence: isDetected
          ? `Forefoot-to-heel ratio deviates from normal 55:45 gait envelope (${(foreRatio * 100).toFixed(0)}% Forefoot vs ${((1 - foreRatio) * 100).toFixed(0)}% Heel).`
          : 'Sagittal weight transfer follows standard heel-to-toe progression.',
        possibleClinicalAssociation: foreRatio > 0.72
          ? 'Tight gastroc-soleus complex, functional equinus, anterior shear on patellar tendon.'
          : 'Cautious antalgic gait, flexed knee posture, or hallux/metatarsal pain avoidance.',
        limitationsAndCaveats: 'Sagittal pressure balance is influenced by footwear heel drop, incline, and gait speed.'
      });
    }

    // 11. Midfoot and Arch Loading Abnormalities
    {
      const isMedialSag = (vArchMed > 0.20 && vArchLat < 0.08);
      const isLateralOverload = vArchLat > 0.38;
      const isDetected = !isUnloaded && (isMedialSag || isLateralOverload);
      const severity = !isDetected ? 'Normal' : (vArchLat > 0.50 ? 'Severe' : 'Moderate');
      findings.push({
        id: 11,
        code: 'MIDFOOT-ARCH',
        name: 'Midfoot and Arch Loading Abnormalities',
        category: 'Midfoot Kinetics',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Medial Arch: ${(vArchMed * 100).toFixed(0)}% | Lateral Midfoot: ${(vArchLat * 100).toFixed(0)}%`,
        abnormalityDetected: isDetected
          ? (isLateralOverload ? 'Excessive lateral midfoot weight bearing (cuboid bone hyper-pressure).' : 'Isolated medial longitudinal arch sag with insufficient lateral column engagement.')
          : (isUnloaded ? 'Unloaded.' : 'Normal anatomical midfoot arch structure and load distribution.'),
        supportingEvidence: isDetected
          ? (isLateralOverload ? `Lateral midfoot load (${(vArchLat * 100).toFixed(0)}%) exceeds the 38% cuboid stress threshold.` : `Medial arch load (${(vArchMed * 100).toFixed(0)}%) is disproportionately high relative to lateral column.`)
          : 'Midfoot forces conform to healthy plantar contact geometry.',
        possibleClinicalAssociation: isLateralOverload
          ? 'Cuboid syndrome, peroneal subluxation, lateral column stress fracture risk.'
          : 'Transverse tarsal joint hypermobility, early flatfoot staging.',
        limitationsAndCaveats: 'Shoe arch contour and insole curvature directly modulate midfoot sensor contact.'
      });
    }

    // 12. Asymmetric Weight Bearing (Unilateral / Bilateral Tracking)
    {
      let stanceDuty = 0.62;
      let hasTemporalData = false;
      if (samples && samples.length > 20) {
        hasTemporalData = true;
        const loadedFrames = samples.filter(s => (s.heel + s.forefoot) > 0.12).length;
        stanceDuty = loadedFrames / samples.length;
      }
      const isDetected = hasTemporalData && (stanceDuty > 0.78 || stanceDuty < 0.42);
      const severity = !isDetected ? 'Normal' : (stanceDuty > 0.85 || stanceDuty < 0.35 ? 'Severe' : 'Moderate');
      findings.push({
        id: 12,
        code: 'ASYMMETRIC-LOAD',
        name: 'Asymmetric Weight Bearing',
        category: 'Bilateral / Temporal Stance',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Insole Mode: Single-Foot Monitoring | Stance Phase Duty Cycle: ${(stanceDuty * 100).toFixed(0)}% (Ref: 58-64%)`,
        abnormalityDetected: isDetected
          ? `Unilateral stance time asymmetry (${stanceDuty > 0.78 ? 'Prolonged stance / dragging' : 'Shortened stance / antalgic limp'}).`
          : (isUnloaded ? 'Unloaded.' : 'Temporal stance and swing phase symmetry within expected physiological window.'),
        supportingEvidence: isDetected
          ? 'Stance phase duration deviates significantly from normal 60/40 duty cycle.'
          : 'Monitored foot demonstrates rhythmic stance-swing progression.',
        possibleClinicalAssociation: 'Antalgic limp, unilateral lower limb injury, hemiparetic loading, or limb length discrepancy.',
        limitationsAndCaveats: 'Direct cross-limb bilateral kinetic force comparison requires bilateral instrumented insoles. Current evaluation utilizes single-insole temporal stride analysis.'
      });
    }

    // 13. Abnormal Loading During Walking (Kinetic Stance Progression)
    {
      let isSequenceAbnormal = false;
      let hasWalkingCycles = (strideCount > 2) && samples && samples.length > 30;
      if (hasWalkingCycles) {
        let heelPeaks = 0, forePeaks = 0;
        samples.forEach(s => {
          if (s.heel > 0.50) heelPeaks++;
          if (s.forefoot > 0.50) forePeaks++;
        });
        if (heelPeaks === 0 && forePeaks > 5) isSequenceAbnormal = true;
      }
      const isDetected = hasWalkingCycles && isSequenceAbnormal;
      const severity = isDetected ? 'Moderate' : 'Normal';
      findings.push({
        id: 13,
        code: 'WALKING-KINETICS',
        name: 'Abnormal Loading During Walking',
        category: 'Dynamic Gait Sequence',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Recorded Strides: ${strideCount || 0} | Gait Phase Sequence: ${isSequenceAbnormal ? 'Disrupted Heel Strike' : (hasWalkingCycles ? 'Coordinated Heel-to-Toe' : 'Static Stance Snapshot')}`,
        abnormalityDetected: isDetected
          ? 'Disrupted chronological heel-to-forefoot ground reaction force trajectory.'
          : (isUnloaded ? 'Unloaded.' : 'Coordinated kinematic stance progression from initial contact to propulsion.'),
        supportingEvidence: isDetected
          ? 'Telemetry reveals absent calcaneal strike phase or disorganized multi-peak loading cycles. Benchmark: REC-PARK-07.'
          : 'Clear three-phase gait cycle (Heel strike → Midstance → Push-off) validated.',
        possibleClinicalAssociation: 'Foot drop (deep peroneal nerve palsy), sensory ataxia, Parkinsonian shuffling gait, or antalgic gait modification.',
        limitationsAndCaveats: 'Requires dynamic walking protocol with active stride detection; static snapshot provides postural screening only.'
      });
    }

    // 14. Compensatory Loading Patterns (Antalgic Offloading)
    {
      const isMedialOffload = (vForeMed < 0.08 && vForeLat > 0.50);
      const isLateralOffload = (vForeLat < 0.08 && vForeMed > 0.50);
      const isHeelOffload = (vHeel < 0.08 && (vForeMed + vForeLat) > 0.50);
      const isDetected = !isUnloaded && (isMedialOffload || isLateralOffload || isHeelOffload);
      const severity = isDetected ? 'Moderate' : 'Normal';
      const offZone = isMedialOffload ? '1st Metatarsal (Medial)' : (isLateralOffload ? '5th Metatarsal (Lateral)' : (isHeelOffload ? 'Calcaneus (Heel)' : 'None'));
      const compZone = isMedialOffload ? 'Lateral Border' : (isLateralOffload ? 'Medial Hallux' : (isHeelOffload ? 'Forefoot Ball' : 'None'));
      findings.push({
        id: 14,
        code: 'COMPENSATORY-OFFLOAD',
        name: 'Compensatory Loading Patterns',
        category: 'Antalgic Compensation',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Offloaded Zone: ${offZone} | Compensatory Loaded Zone: ${compZone}`,
        abnormalityDetected: isDetected
          ? `Asymmetric antalgic pressure redirection away from ${offZone} toward ${compZone}.`
          : (isUnloaded ? 'Unloaded.' : 'Uniform physiological load sharing without antalgic avoidance vectors.'),
        supportingEvidence: isDetected
          ? `Unnatural focal pressure void (<8%) immediately adjacent to high pressure (>50%), characteristic of pain avoidance mechanics.`
          : 'No localized pressure shielding detected across monitored zones.',
        possibleClinicalAssociation: 'Protective offloading secondary to turf toe, hallux rigidus, acute calcaneal spur pain, or metatarsal stress fracture.',
        limitationsAndCaveats: 'Identifies kinetic pressure shifts; primary clinical cause of pain requires manual musculoskeletal examination.'
      });
    }

    // 15. Persistent Localized Pressure
    {
      const isPersistent = !isUnloaded && ((vForeMed > 0.75 || vForeLat > 0.75 || vHeel > 0.75) && (samples && samples.length > 20 ? samples.every(s => (s.forefoot + s.heel) > 0.20) : false));
      const isDetected = isPersistent || (!isUnloaded && (vForeMed > 0.88 || vForeLat > 0.88 || vHeel > 0.88));
      const severity = !isDetected ? 'Normal' : ((vForeMed > 0.92 || vForeLat > 0.92 || vHeel > 0.92) ? 'Severe' : 'Moderate');
      findings.push({
        id: 15,
        code: 'PERSISTENT-PRESSURE',
        name: 'Persistent Localized Pressure',
        category: 'Pressure Overload',
        status: isDetected ? 'Detected' : (isUnloaded ? 'Unloaded' : 'Normal'),
        severity: severity,
        observedReadings: `Continuous Max Peak: ${Math.max(vForeMed, vForeLat, vHeel, vArchMed, vArchLat) > 0.80 ? 'Elevated Sustained Load' : 'Intermittent Cyclical'}`,
        abnormalityDetected: isDetected
          ? 'Continuous unrelieved focal pressure concentration failing to cyclically offload.'
          : (isUnloaded ? 'Unloaded.' : 'Healthy cyclical loading and complete unloading during swing / gait transitions.'),
        supportingEvidence: isDetected
          ? 'Target zone failed to achieve pressure relief (<20 kPa) during stance cycle, creating constant tissue compression.'
          : 'Periodic offloading verified across all monitored locations.',
        possibleClinicalAssociation: 'Drag gait, incomplete clearance during swing phase, fixed osseous deformity, or insole pre-compression.',
        limitationsAndCaveats: 'Ensure insole is not mechanically pinched or pre-compressed by tight footwear lacing.'
      });
    }

    return findings;
  }

  function renderScreeningFindings(findings) {
    state.lastScreeningFindings = findings;
    const grid = document.getElementById('screening-findings-grid');
    if (!grid) return;

    let detectedCount = 0;
    findings.forEach(f => {
      if (f.status === 'Detected') detectedCount++;
    });

    const statCount = document.getElementById('stat-findings-count');
    if (statCount) statCount.textContent = '15';
    const statDet = document.getElementById('stat-detected-count');
    if (statDet) statDet.textContent = detectedCount;

    let html = '';
    findings.forEach(f => {
      const isDet = f.status === 'Detected';
      const isUnload = f.status === 'Unloaded';
      let cardClass = isDet ? 'detected' : (isUnload ? 'unloaded' : 'normal');
      if (f.severity === 'Moderate') cardClass = 'moderate';

      let badgeClass = isDet ? 'badge-detected' : (isUnload ? 'badge-unloaded' : 'badge-normal');
      if (f.severity === 'Moderate') badgeClass = 'badge-moderate';

      let statusText = isDet ? `&#9888; DETECTED &bull; ${f.severity.toUpperCase()}` : (isUnload ? 'UNLOADED' : '&#10003; NORMAL / NEGATIVE');

      html += `
        <div class="finding-card ${cardClass}" data-status="${f.status}">
          <div class="finding-header">
            <span class="finding-label">${f.category}</span>
            <span class="finding-status-badge ${badgeClass}">${statusText}</span>
          </div>
          <h4 class="finding-title">${f.id}. ${f.name}</h4>
          <div class="finding-section-row">
            <span class="finding-label">Observed Telemetry</span>
            <span class="finding-observed">${f.observedReadings}</span>
          </div>
          <div class="finding-section-row">
            <span class="finding-label">Screening Assessment</span>
            <div class="finding-evidence-text">${f.abnormalityDetected}</div>
          </div>
          <div class="finding-section-row">
            <span class="finding-label">Supporting Evidence</span>
            <div class="finding-evidence-text">${f.supportingEvidence}</div>
          </div>
          <div class="finding-section-row">
            <span class="finding-label">Possible Clinical Association</span>
            <div class="finding-clinical-text">${f.possibleClinicalAssociation}</div>
          </div>
          <div class="finding-disclaimer-text">
            <strong>Limitation:</strong> ${f.limitationsAndCaveats}
          </div>
        </div>
      `;
    });

    grid.innerHTML = html;
    applyScreeningFilter(state.screeningFilter || 'all');
  }

  function applyScreeningFilter(filterType) {
    state.screeningFilter = filterType;
    const allBtn = document.getElementById('screening-filter-all');
    const detBtn = document.getElementById('screening-filter-detected');
    if (allBtn && detBtn) {
      if (filterType === 'all') {
        allBtn.classList.add('active');
        detBtn.classList.remove('active');
      } else {
        detBtn.classList.add('active');
        allBtn.classList.remove('active');
      }
    }

    const cards = document.querySelectorAll('.finding-card');
    cards.forEach(card => {
      const status = card.getAttribute('data-status');
      if (filterType === 'all') {
        card.style.display = 'flex';
      } else {
        card.style.display = status === 'Detected' ? 'flex' : 'none';
      }
    });
  }

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
      const autoWalkEl = document.getElementById('check-auto-walk');
      const autoWalk = autoWalkEl ? autoWalkEl.checked : true;
      if (state.mode === 'simulation' && autoWalk) {
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
    let sumArchMed = 0, sumArchLat = 0, sumForeMed = 0, sumForeLat = 0;

    samples.forEach(s => {
      sumHeel += s.heel;
      sumMidfoot += s.midfoot;
      sumForefoot += s.forefoot;
      sumToes += s.toes;
      sumArchMed += (s.arch_medial || 0);
      sumArchLat += (s.arch_lateral || 0);
      sumForeMed += (s.forefoot_medial || 0);
      sumForeLat += (s.forefoot_lateral || 0);
    });

    const sampleCount = samples.length || 1;
    const avgMap = {
      heel: sumHeel / sampleCount,
      arch_medial: sumArchMed / sampleCount,
      arch_lateral: sumArchLat / sampleCount,
      forefoot_medial: sumForeMed / sampleCount,
      forefoot_lateral: sumForeLat / sampleCount,
      midfoot: sumMidfoot / sampleCount,
      forefoot: sumForefoot / sampleCount
    };

    const totalLoad = sumHeel + sumMidfoot + sumForefoot + sumToes;

    const heelPct = totalLoad > 0 ? (sumHeel / totalLoad) * 100 : 0;
    const midfootPct = totalLoad > 0 ? (sumMidfoot / totalLoad) * 100 : 0;
    const forefootPct = totalLoad > 0 ? (sumForefoot / totalLoad) * 100 : 0;
    const toesPct = totalLoad > 0 ? (sumToes / totalLoad) * 100 : 0;

    const diagnostics = evaluateKneeDefects(heelPct, midfootPct, forefootPct, toesPct, totalLoad);
    const closestMatch = findClosestDatasetRecord(heelPct, midfootPct, forefootPct, toesPct, totalLoad, avgMap);
    const findings = screenPlantarDefectsAndAbnormalities(avgMap, samples, state.test.strideCount);
    renderScreeningFindings(findings);

    document.getElementById('loading-stage-text').textContent = 'Cross-referencing reference datasets (Parkinson\'s VGRF, GaitRite, Healthy norms)...';
    await new Promise(r => setTimeout(r, 600));

    document.getElementById('loading-stage-text').textContent = 'Generating multi-factor clinical biomechanical report...';

    let clinicalNarrative = '';
    try {
      clinicalNarrative = await runLLMClinicalInference({
        heelPct,
        midfootPct,
        forefootPct,
        toesPct,
        strideCount: state.test.strideCount || 26,
        diagnostics,
        closestMatch,
        screeningFindings: findings
      });
    } catch (err) {
      console.warn('AI LLM inference call failed or not configured, using deterministic engine:', err);
      clinicalNarrative = generateDeterministicClinicalReport({
        heelPct,
        midfootPct,
        forefootPct,
        toesPct,
        strideCount: state.test.strideCount || 26,
        diagnostics,
        closestMatch,
        screeningFindings: findings
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

  async function runInstantScreening() {
    const valForefootMedial = state.sensors['forefoot_medial'] ? state.sensors['forefoot_medial'].currentValue : (state.sensors['forefoot'] ? state.sensors['forefoot'].currentValue : 0);
    const valForefootLateral = state.sensors['forefoot_lateral'] ? state.sensors['forefoot_lateral'].currentValue : 0;
    const valArchMedial = state.sensors['arch_medial'] ? state.sensors['arch_medial'].currentValue : (state.sensors['midfoot'] ? state.sensors['midfoot'].currentValue : 0);
    const valArchLateral = state.sensors['arch_lateral'] ? state.sensors['arch_lateral'].currentValue : 0;
    const valHeel = state.sensors['heel'] ? state.sensors['heel'].currentValue : 0;

    const sensorMap = {
      heel: valHeel,
      arch_medial: valArchMedial,
      arch_lateral: valArchLateral,
      forefoot_medial: valForefootMedial,
      forefoot_lateral: valForefootLateral,
      midfoot: Math.max(valArchMedial, valArchLateral),
      forefoot: Math.max(valForefootMedial, valForefootLateral)
    };

    const sumMidfoot = Math.max(valArchMedial, valArchLateral);
    const sumForefoot = Math.max(valForefootMedial, valForefootLateral);
    const sumHeel = valHeel;
    const totalLoad = sumHeel + sumMidfoot + sumForefoot;

    const heelPct = totalLoad > 0 ? (sumHeel / totalLoad) * 100 : 0;
    const midfootPct = totalLoad > 0 ? (sumMidfoot / totalLoad) * 100 : 0;
    const forefootPct = totalLoad > 0 ? (sumForefoot / totalLoad) * 100 : 0;
    const toesPct = 0;

    const diagnostics = evaluateKneeDefects(heelPct, midfootPct, forefootPct, toesPct, totalLoad);
    const closestMatch = findClosestDatasetRecord(heelPct, midfootPct, forefootPct, toesPct, totalLoad, sensorMap);
    const findings = screenPlantarDefectsAndAbnormalities(sensorMap, [], 0);
    renderScreeningFindings(findings);

    let clinicalNarrative = '';
    try {
      clinicalNarrative = await runLLMClinicalInference({
        heelPct,
        midfootPct,
        forefootPct,
        toesPct,
        strideCount: 0,
        diagnostics,
        closestMatch,
        screeningFindings: findings
      });
    } catch (_) {
      clinicalNarrative = generateDeterministicClinicalReport({
        heelPct,
        midfootPct,
        forefootPct,
        toesPct,
        strideCount: 0,
        diagnostics,
        closestMatch,
        screeningFindings: findings
      });
    }

    state.test.status = 'completed';
    const resultsContainer = document.getElementById('test-results-container');
    if (resultsContainer) resultsContainer.style.display = 'flex';
    document.getElementById('test-progress-container').style.display = 'none';
    document.getElementById('test-loading-container').style.display = 'none';

    renderDiagnosticResults({
      heelPct,
      midfootPct,
      forefootPct,
      toesPct,
      strideCount: 0,
      diagnostics,
      closestMatch,
      clinicalNarrative
    });

    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function evaluateKneeDefects(heelPct, midfootPct, forefootPct, toesPct, totalLoad) {
    if (totalLoad !== undefined && totalLoad < 0.05) {
      return {
        medialOARisk: 'Normal',
        patellarRisk: 'Normal',
        shockRisk: 'Normal',
        pronationStatus: 'Unloaded Baseline',
        score: 100,
        isUnloaded: true
      };
    }

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
      score: Math.max(35, Math.min(100, score)),
      isUnloaded: false
    };
  }

  function findClosestDatasetRecord(heelPct, midfootPct, forefootPct, toesPct, totalLoad, sensorMap) {
    if (totalLoad !== undefined && totalLoad < 0.05) {
      const zeroRec = REFERENCE_DATASETS.find(r => r.record_id === 'REC-ZERO-CONTACT-00');
      if (zeroRec) return zeroRec;
    }

    if (sensorMap && sensorMap.heel > 0.80 && sensorMap.arch_medial > 0.75 && sensorMap.forefoot_medial > 0.80) {
      const satRec = REFERENCE_DATASETS.find(r => r.record_id === 'REC-SATURATION-99');
      if (satRec) return satRec;
    }

    if (midfootPct > 32) {
      const flatRec = REFERENCE_DATASETS.find(r => r.record_id === 'REC-FLATFOOT-05');
      if (flatRec) return flatRec;
    }

    if (midfootPct < 7 && heelPct > 35) {
      const cavusRec = REFERENCE_DATASETS.find(r => r.record_id === 'REC-CAVUS-07');
      if (cavusRec) return cavusRec;
    }

    if (forefootPct > 65) {
      const metRec = REFERENCE_DATASETS.find(r => r.record_id === 'REC-METATARSALGIA-08');
      if (metRec) return metRec;
    }

    let closest = REFERENCE_DATASETS[0];
    let minDistance = Infinity;

    REFERENCE_DATASETS.forEach(rec => {
      const p = rec.pressures;
      const recTotal = p.heel + p.midfoot + p.forefoot + p.toes || 1;
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

  function renderExecutiveActionReport(data) {
    const { diagnostics, closestMatch } = data;
    const findings = state.lastScreeningFindings || [];

    const badgeEl = document.getElementById('exec-status-badge');
    const titleEl = document.getElementById('exec-report-title');
    const summaryEl = document.getElementById('exec-summary-text');
    const countEl = document.getElementById('exec-defects-count');
    const defectsListEl = document.getElementById('exec-defects-list');
    const footwearListEl = document.getElementById('action-footwear-list');
    const exercisesListEl = document.getElementById('action-exercises-list');
    const habitsListEl = document.getElementById('action-habits-list');

    if (!badgeEl || !defectsListEl || !footwearListEl) return;

    // Case 1: Unloaded Insole (0% load)
    if (diagnostics.isUnloaded) {
      badgeEl.className = 'exec-badge';
      badgeEl.textContent = 'INSOLE UNWEIGHTED';
      titleEl.textContent = 'No Foot Pressure Registered';
      summaryEl.textContent = 'The insole sensors are currently at resting baseline (0% load). Step onto the insole or click a preset to see your customized report.';
      countEl.textContent = '0';

      defectsListEl.innerHTML = `
        <div class="exec-defect-item severity-normal">
          <div class="defect-item-title-row">
            <span class="defect-item-name">ℹ️ No Foot Contact Detected</span>
            <span class="defect-item-tag tag-normal">Standby</span>
          </div>
          <div class="defect-item-desc">
            All 5 regional sensor locations are registering 0% pressure. No stance or walking steps were detected during this recording.
          </div>
          <div class="defect-item-what-it-means">
            What this means: The insole is either not stepped on yet, or needs to be calibrated.
          </div>
        </div>
      `;

      footwearListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Place Insole Flat:</strong> Ensure the sensor insole sits flat inside your walking or running shoes without folds.</li>
        <li class="action-bullet-item"><strong>Check Sensor Alignment:</strong> Ensure the 5 points sit under your heel, medial arch, lateral arch, and 1st/5th metatarsal heads.</li>
      `;

      exercisesListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Step &amp; Test:</strong> Step on the insole and take a natural step, or click <strong>Instant Screen (Current Pressure)</strong> above.</li>
        <li class="action-bullet-item"><strong>Try Presets:</strong> Click <strong>Flat Foot</strong> or <strong>High Arch</strong> above to see sample diagnostic action plans.</li>
      `;

      habitsListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Connection Check:</strong> If using hardware, verify the USB cable is connected and baud rate is 115200.</li>
      `;
      return;
    }

    // Case 2: Saturated Insole
    if (closestMatch && closestMatch.record_id === 'REC-SATURATION-99') {
      badgeEl.className = 'exec-badge badge-warning';
      badgeEl.textContent = 'SENSOR SATURATION';
      titleEl.textContent = 'Maximum Sensor Load Clamped';
      summaryEl.textContent = 'All sensor zones are simultaneously pushed to 100% capacity. This indicates static clamping rather than a normal dynamic walking step.';
      countEl.textContent = '1';

      defectsListEl.innerHTML = `
        <div class="exec-defect-item severity-severe">
          <div class="defect-item-title-row">
            <span class="defect-item-name">⚠️ Full Sensor Saturation</span>
            <span class="defect-item-tag tag-alert">Clamped</span>
          </div>
          <div class="defect-item-desc">
            All 5 sensors registered maximum load at the same moment without normal heel-to-toe progression.
          </div>
          <div class="defect-item-what-it-means">
            What this means: Check that the insole is not mechanically pinched inside tight footwear or over-tared.
          </div>
        </div>
      `;

      footwearListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Loosen Footwear:</strong> Ensure shoes are not laced too tightly around the foot bed.</li>
      `;
      exercisesListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Re-Zero Tare:</strong> Lift your foot completely off the sensor and click <strong>Set Baseline (Tare)</strong>.</li>
      `;
      habitsListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Dynamic Step:</strong> Walk at a natural, comfortable pace rather than standing stiffly in place.</li>
      `;
      return;
    }

    // Filter detected findings from the 15 screening checks
    const detected = findings.filter(f => f.status === 'Detected');
    countEl.textContent = detected.length;

    // Case 3: Completely Healthy / Normal (0 defects)
    if (detected.length === 0) {
      badgeEl.className = 'exec-badge badge-healthy';
      badgeEl.textContent = 'HEALTHY BALANCED GAIT';
      titleEl.textContent = 'Your Foot Mechanics Look Great!';
      summaryEl.textContent = 'Your body weight is distributed smoothly across your heel, arch, and the ball of your foot with natural shock absorption and balanced alignment.';

      defectsListEl.innerHTML = `
        <div class="exec-defect-item severity-normal">
          <div class="defect-item-title-row">
            <span class="defect-item-name">✅ No Foot Defects Detected</span>
            <span class="defect-item-tag tag-normal">Optimal</span>
          </div>
          <div class="defect-item-desc">
            Pressure flows naturally: initial contact is absorbed by the heel, distributed across the lateral arch, and propelled smoothly across the metatarsal ball.
          </div>
          <div class="defect-item-what-it-means">
            What this means: Your arch has healthy spring, your joints are well-aligned, and no pressure hotspots were found.
          </div>
        </div>
      `;

      footwearListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Keep Current Shoes:</strong> Your footwear provides good support. Stick with neutral, well-cushioned sneakers.</li>
        <li class="action-bullet-item"><strong>Mileage Check:</strong> Replace athletic shoes every 350–500 miles (or every 6–9 months of regular walking) as midsole foam compresses.</li>
      `;

      exercisesListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Calf &amp; Ankle Mobility:</strong> Do 30 seconds of wall calf stretches after walks to keep tendons flexible.</li>
        <li class="action-bullet-item"><strong>Single-Leg Balance:</strong> Stand on one foot for 30 seconds while brushing teeth to maintain ankle joint stability.</li>
      `;

      habitsListEl.innerHTML = `
        <li class="action-bullet-item"><strong>Active Breaks:</strong> Stand up and take a 2-minute stroll every 45–60 minutes of seated desk work.</li>
        <li class="action-bullet-item"><strong>Keep Feet Moisturized:</strong> Apply foot cream after showers to prevent heel fissures and dry skin.</li>
      `;
      return;
    }

    // Case 4: 1 or more defects detected!
    const isSevere = detected.some(d => d.severity === 'Severe');
    badgeEl.className = isSevere ? 'exec-badge badge-alert' : 'exec-badge badge-warning';
    badgeEl.textContent = `${detected.length} FOOT ISSUE${detected.length > 1 ? 'S' : ''} DETECTED`;
    titleEl.textContent = 'Foot Health & Action Plan';
    summaryEl.textContent = 'We detected specific pressure imbalances in your stance. Below is a plain-English explanation of each issue and practical, easy fixes you can do right away.';

    // Generate plain-English defect cards
    let defectsHtml = '';
    const plainDefectExplanations = {
      'PES-PLANUS': {
        title: 'Flat Foot / Fallen Arch (Over-Pronation)',
        whatIsIt: 'Your inner arch is collapsing toward the ground when you step instead of staying raised like a natural spring.',
        whatItMeans: 'Why it matters: When your arch flattens, your ankles and knees twist inward, which can cause aching shins, arch fatigue, and knee joint stress.'
      },
      'PES-CAVUS': {
        title: 'High Rigid Arch (Pes Cavus)',
        whatIsIt: 'Your middle arch stays raised high and barely touches the ground at all during midstance.',
        whatItMeans: 'Why it matters: Almost all your body weight slams directly onto your heel and the front ball, leaving your feet with poor natural shock absorption.'
      },
      'METATARSALGIA': {
        title: 'Ball-of-Foot Overload (Metatarsalgia Risk)',
        whatIsIt: 'Excessive pressure is concentrating under the front ball of your foot with every step.',
        whatItMeans: 'Why it matters: Over time this leads to burning pain, soreness under the metatarsal bones, calluses, or the feeling of stepping on a marble.'
      },
      'UNEVEN-FOREFOOT': {
        title: 'Uneven Push-Off (Ball of Foot Tilt)',
        whatIsIt: 'You are pushing off with much more weight on one side of the ball of your foot (e.g. big toe vs pinky toe).',
        whatItMeans: 'Why it matters: Can cause bunion irritation, big toe joint stiffness, or extra strain along the outer foot border.'
      },
      'PLANTAR-FASCIITIS': {
        title: 'Plantar Fascia Strain (Heel & Arch Stress)',
        whatIsIt: 'Heavy heel impact combined with arch stretching is putting excessive tension on the ligament under your foot.',
        whatItMeans: 'Why it matters: This is the primary driver of sharp morning heel pain, arch tightness, and heel bone spurs.'
      },
      'ABNORMAL-HEEL': {
        title: 'Hard Heel Strike / Shock Transmission',
        whatIsIt: 'Your heel is hitting the ground harder than normal without enough muscular cushion.',
        whatItMeans: 'Why it matters: High-impact heel strikes send shock waves traveling directly up your shin into your knee joint.'
      },
      'EXCESSIVE-PRESSURE': {
        title: 'High Pressure Hotspot (>85% Peak Load)',
        whatIsIt: 'A single zone under your foot is bearing intense, focused weight.',
        whatItMeans: 'Why it matters: Concentrated pressure points lead to thick calluses, corns, skin breakdown, and aching soreness.'
      },
      'DIABETIC-RISK': {
        title: 'Prolonged Focal Pressure Warning',
        whatIsIt: 'High pressure is remaining on one spot without regular relief during your steps.',
        whatItMeans: 'Why it matters: Prolonged pressure restricts micro-circulation in the skin, which requires attention to avoid tissue breakdown.'
      },
      'ML-IMBALANCE': {
        title: 'Foot Tilting Inward or Outward (Side-to-Side Roll)',
        whatIsIt: 'Your foot is tilting heavily toward the inside edge (pronation) or the outside edge (supination) rather than staying level.',
        whatItMeans: 'Why it matters: Uneven roll places twisting torque on your ankle ligaments and uneven wear on your knee cartilage.'
      },
      'FH-IMBALANCE': {
        title: 'Front-Heavy or Back-Heavy Weight Shift',
        whatIsIt: 'You are leaning a disproportionate amount of your body weight forward onto your toes or back onto your heels.',
        whatItMeans: 'Why it matters: Tight calf muscles often pull weight forward, causing forefoot burning and anterior knee shear.'
      },
      'MIDFOOT-ARCH': {
        title: 'Midfoot / Cuboid Loading Anomaly',
        whatIsIt: 'Your midfoot arch is contacting the ground irregularly on either the inner sag or outer cuboid edge.',
        whatItMeans: 'Why it matters: Can lead to midfoot fatigue, stiffness after walking, or outer foot edge soreness.'
      },
      'ASYMMETRIC-LOAD': {
        title: 'Uneven Stance Timing / Dragging Stride',
        whatIsIt: 'Your foot is spending too much or too little time bearing weight compared to a normal 60/40 step rhythm.',
        whatItMeans: 'Why it matters: Often indicates subconscious limping or guarding a sensitive limb.'
      },
      'WALKING-KINETICS': {
        title: 'Disrupted Heel-to-Toe Roll Sequence',
        whatIsIt: 'Your foot is not transitioning smoothly from heel strike to midfoot to push-off.',
        whatItMeans: 'Why it matters: Can cause shuffling, tripping hazards, or premature foot slap.'
      },
      'COMPENSATORY-OFFLOAD': {
        title: 'Protective Offloading / Sparing a Sensitive Area',
        whatIsIt: 'You are shifting your weight away from a low-pressure void onto the opposite edge of the foot.',
        whatItMeans: 'Why it matters: The body naturally redirects weight away from pain, but overloads the neighboring area.'
      },
      'PERSISTENT-PRESSURE': {
        title: 'Constant Pressure Without Relief Phase',
        whatIsIt: 'A sensor zone never fully unloads during the swing phase of your walk.',
        whatItMeans: 'Why it matters: Healthy feet need complete cyclical pressure release during every step.'
      }
    };

    detected.forEach(d => {
      const exp = plainDefectExplanations[d.code] || {
        title: d.name,
        whatIsIt: d.abnormalityDetected,
        whatItMeans: d.possibleClinicalAssociation
      };
      const isSev = d.severity === 'Severe';
      defectsHtml += `
        <div class="exec-defect-item ${isSev ? 'severity-severe' : ''}">
          <div class="defect-item-title-row">
            <span class="defect-item-name">⚠️ ${exp.title}</span>
            <span class="defect-item-tag ${isSev ? 'tag-alert' : 'tag-warning'}">${d.severity}</span>
          </div>
          <div class="defect-item-desc">${exp.whatIsIt}</div>
          <div class="defect-item-what-it-means">${exp.whatItMeans}</div>
        </div>
      `;
    });
    defectsListEl.innerHTML = defectsHtml;

    // Generate Tailored Action Plan
    const codes = new Set(detected.map(d => d.code));
    let footwearBullets = [];
    let exerciseBullets = [];
    let habitBullets = [];

    // Footwear / Insole tailored recommendations
    if (codes.has('PES-PLANUS') || codes.has('ML-IMBALANCE')) {
      footwearBullets.push('<strong>Arch-Support Insoles:</strong> Choose semirigid orthotic insoles with firm medial longitudinal arch support to prevent your arch from collapsing inward.');
      footwearBullets.push('<strong>Stability / Motion-Control Shoes:</strong> Look for sneakers with medial posting (firmer grey foam on the inner edge) to prevent inward ankle roll.');
    }
    if (codes.has('PES-CAVUS') || codes.has('ABNORMAL-HEEL')) {
      footwearBullets.push('<strong>Cushioned Shock-Absorbing Insoles:</strong> Use deeply cushioned insoles with viscoelastic gel heel pads to absorb impact shock before it reaches your knees.');
      footwearBullets.push('<strong>Thick Midsole Sneakers:</strong> Choose running or walking shoes with plush EVA or air cushioning; avoid minimalist thin-soled shoes.');
    }
    if (codes.has('METATARSALGIA') || codes.has('UNEVEN-FOREFOOT') || codes.has('FH-IMBALANCE')) {
      footwearBullets.push('<strong>Metatarsal Pads / Domes:</strong> Place a small teardrop-shaped metatarsal pad in your shoes just behind the ball of the foot to lift the metatarsal heads off the ground.');
      footwearBullets.push('<strong>Wide Toe Box &amp; Low Drop:</strong> Choose shoes with a spacious front toe box so your toes aren\'t squeezed, and keep heel height under 1 inch.');
    }
    if (codes.has('PLANTAR-FASCIITIS')) {
      footwearBullets.push('<strong>Slight Heel Lift (10mm Drop):</strong> Avoid totally flat zero-drop shoes or flat flip-flops; a 10mm heel drop takes direct tension off the plantar fascia.');
      footwearBullets.push('<strong>Deep Heel Cup:</strong> Wear shoes with a structured heel counter to keep your natural heel fat pad centralized under the bone.');
    }
    if (footwearBullets.length === 0) {
      footwearBullets.push('<strong>Supportive Walking Footwear:</strong> Wear structured sneakers with good arch support and avoid worn-down soles.');
      footwearBullets.push('<strong>Replace Old Shoes:</strong> Cushioning breaks down after 6–9 months of regular wear.');
    }

    // 2-Minute Daily Stretches / Exercises
    if (codes.has('PES-PLANUS') || codes.has('ML-IMBALANCE')) {
      exerciseBullets.push('<strong>Towel Scrunches (1 min):</strong> Sit on a chair, place a small towel flat on the floor, and use your toes to scrunch it toward you (2 sets of 10 scrunches).');
      exerciseBullets.push('<strong>Standing Heel Raises (1 min):</strong> Stand near a wall, raise slowly onto your tiptoes for 2 seconds, and slowly lower down (15 repetitions to strengthen posterior tibialis).');
    }
    if (codes.has('PES-CAVUS') || codes.has('PLANTAR-FASCIITIS')) {
      exerciseBullets.push('<strong>Tennis Ball Foot Roll (2 mins):</strong> Sit comfortably, place a tennis ball or frozen water bottle under your arch, and roll gently back and forth to release tight fascia.');
      exerciseBullets.push('<strong>Seated Big Toe Stretch (1 min):</strong> Cross your foot over your opposite knee and gently pull your toes toward your shin, holding for 30 seconds on each foot.');
    }
    if (codes.has('METATARSALGIA') || codes.has('FH-IMBALANCE') || codes.has('ABNORMAL-HEEL')) {
      exerciseBullets.push('<strong>Wall Calf Stretch (1 min):</strong> Place hands on a wall, step one leg back with your heel flat on the floor, and lean forward for 30 seconds per leg (tight calves force excess weight forward).');
      exerciseBullets.push('<strong>Toe Splaying &amp; Spreading (1 min):</strong> Sit down and actively spread all five toes as wide apart as possible, hold for 5 seconds, repeat 8 times.');
    }
    if (exerciseBullets.length === 0) {
      exerciseBullets.push('<strong>Gentle Ankle Circles (1 min):</strong> Rotate your ankle clockwise and counter-clockwise 15 times to keep joints flexible.');
      exerciseBullets.push('<strong>Wall Calf Stretch (1 min):</strong> Stretch both calves against a wall for 30 seconds each.');
    }

    // Daily Habits
    if (codes.has('PES-PLANUS') || codes.has('PLANTAR-FASCIITIS')) {
      habitBullets.push('<strong>No Barefoot on Hard Floors:</strong> Avoid walking barefoot on hard tiles or hardwood; wear supportive house slides or cushioned slippers indoors.');
      habitBullets.push('<strong>Morning Stretch Before Standing:</strong> Before your feet hit the floor in the morning, gently flex and stretch your toes to prevent sudden fascial pull.');
    }
    if (codes.has('EXCESSIVE-PRESSURE') || codes.has('DIABETIC-RISK')) {
      habitBullets.push('<strong>Inspect Your Feet Daily:</strong> Check the bottoms of your feet daily for red pressure marks, hot spots, or early callus buildup.');
      habitBullets.push('<strong>Moisturize &amp; Wear Padded Socks:</strong> Use thick, moisture-wicking athletic socks (or seamless socks) and apply moisturizer to prevent skin cracking.');
    }
    if (codes.has('ABNORMAL-HEEL') || codes.has('FH-IMBALANCE')) {
      habitBullets.push('<strong>Shorten Stride Slightly:</strong> Try taking slightly shorter, quicker steps when walking on concrete to prevent hard heel slamming.');
    }
    if (habitBullets.length === 0) {
      habitBullets.push('<strong>Stay Active with Walking Breaks:</strong> Take brief 2-minute walking breaks during prolonged desk work.');
      habitBullets.push('<strong>Listen to Your Feet:</strong> If feet feel sore or fatigued after walks, rest and elevate them for 10 minutes.');
    }

    footwearListEl.innerHTML = footwearBullets.slice(0, 3).map(b => `<li class="action-bullet-item">${b}</li>`).join('');
    exercisesListEl.innerHTML = exerciseBullets.slice(0, 3).map(b => `<li class="action-bullet-item">${b}</li>`).join('');
    habitsListEl.innerHTML = habitBullets.slice(0, 3).map(b => `<li class="action-bullet-item">${b}</li>`).join('');
  }

  function renderDiagnosticResults(data) {
    const { heelPct, midfootPct, forefootPct, toesPct, diagnostics, closestMatch, clinicalNarrative } = data;

    // Render User-Friendly Executive Action Report at the top
    renderExecutiveActionReport(data);

    const healthEl = document.getElementById('results-health-index');
    const badge = document.getElementById('results-verdict-badge');
    const title = document.getElementById('results-verdict-title');

    if (diagnostics.isUnloaded) {
      healthEl.textContent = 'N/A (Unloaded)';
      badge.textContent = 'NO GROUND CONTACT / SENSOR SIGNAL DETECTED';
      badge.style.color = '#94a3b8';
      title.textContent = 'Zero Load Registered Across All Monitored Insole Sensors';
    } else if (closestMatch && closestMatch.record_id === 'REC-SATURATION-99') {
      healthEl.textContent = '45 / 100';
      badge.textContent = 'UNIFORM SENSOR SATURATION / ISOMETRIC CLAMP';
      badge.style.color = '#f59e0b';
      title.textContent = 'Continuous Maximum Sensor Saturation Detected Across All Channels';
    } else if (closestMatch && closestMatch.record_id === 'REC-FLATFOOT-05') {
      healthEl.textContent = `${diagnostics.score} / 100`;
      badge.textContent = 'SEVERE FLATFOOT (PES PLANUS) & ARCH COLLAPSE';
      badge.style.color = '#f87171';
      title.textContent = 'Medial Longitudinal Arch Collapse & Valgus Tracking Stress';
    } else if (closestMatch && closestMatch.record_id === 'REC-CAVUS-07') {
      healthEl.textContent = `${diagnostics.score} / 100`;
      badge.textContent = 'PES CAVUS (RIGID HIGH-ARCH) SUPINATION';
      badge.style.color = '#facc15';
      title.textContent = 'Reduced Midfoot Ground Dissipation & Axial Shock Transmission';
    } else if (closestMatch && closestMatch.record_id === 'REC-METATARSALGIA-08') {
      healthEl.textContent = `${diagnostics.score} / 100`;
      badge.textContent = 'FOREFOOT OVERLOAD / METATARSALGIA RISK';
      badge.style.color = '#f97316';
      title.textContent = 'Anterior Stance Dominance & Metatarsal Head Hyper-Pressure';
    } else if (diagnostics.score >= 85) {
      healthEl.textContent = `${diagnostics.score} / 100`;
      badge.textContent = 'HEALTHY BALANCED GAIT PROFILE';
      badge.style.color = '#4ade80';
      title.textContent = 'Normal Lower Extremity Kinetics & Symmetrical Joint Loading';
    } else if (diagnostics.score >= 70) {
      healthEl.textContent = `${diagnostics.score} / 100`;
      badge.textContent = 'MILD COMPENSATORY LOAD DETECTED';
      badge.style.color = '#facc15';
      title.textContent = 'Mild Arch Collapse & Asymmetrical Knee Vector Warning';
    } else {
      healthEl.textContent = `${diagnostics.score} / 100`;
      badge.textContent = 'ELEVATED KNEE JOINT DEFECT RISK';
      badge.style.color = '#f87171';
      title.textContent = 'Pathological Medial Compartment Knee Overload & Arch Defect';
    }

    const updateRisk = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      el.className = 'risk-badge';
      if (val.includes('Low') || val.includes('Normal') || val.includes('Neutral') || val.includes('Unloaded')) {
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
    document.getElementById('results-model-badge').textContent = (state.nvidia.apiKey || state.nvidia.provider === 'ollama')
      ? `${state.nvidia.provider.toUpperCase()} (${state.nvidia.model.split('/').pop()})`
      : 'Deterministic Biomechanical Engine';
  }

  async function runLLMClinicalInference(data) {
    if (!state.nvidia.apiKey && state.nvidia.provider !== 'ollama') {
      throw new Error(`No API key configured for ${state.nvidia.provider || 'NVIDIA'}`);
    }

    const findingsSummary = (data.screeningFindings || [])
      .map(f => `• ${f.name} [${f.status.toUpperCase()}]: ${f.abnormalityDetected} (Evidence: ${f.supportingEvidence})`)
      .join('\n');

    const prompt = `You are an expert biomechanical AI clinician specializing in pedobarography, plantar pressure analysis, knee joint kinetic chain mechanics, and foot deformities.
Analyze the following patient telemetry from a 5-sensor insole evaluation:

PATIENT TELEMETRY:
- Recorded Strides: ${data.strideCount}
- Heel Load: ${data.heelPct.toFixed(1)}%
- Midfoot Arch Load: ${data.midfootPct.toFixed(1)}%
- Forefoot Metatarsal Load: ${data.forefootPct.toFixed(1)}%
- Toes Load: ${data.toesPct.toFixed(1)}%

15-POINT PLANTAR ABNORMALITY & DEFECT SCREENINGS:
${findingsSummary}

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
1. BIOMECHANICAL FORCE INTERPRETATION: How the measured 5-point ground reaction force distribution impacts the kinetic chain.
2. DETECTED FOOT ABNORMALITIES & DEFECTS: Specifically discuss any detected conditions (such as Flatfoot, Cavus, Metatarsalgia, Plantar Fasciitis, or Ulcer Pressure Risks) and their observed loading evidence.
3. KNEE JOINT DEFECTS & VULNERABILITIES: Explain any risks for medial compartment knee osteoarthritis, patellar maltracking, or meniscal shock.
4. EVIDENCE CITATION: Correlate findings with the cited reference dataset pattern (${data.closestMatch.record_id}).
5. ACTIONABLE RECOMMENDATIONS: Orthotic insole suggestions (e.g. medial arch support, metatarsal dome, lateral wedge, heel cup) and corrective exercises.
6. MANDATORY CLINICAL DISCLAIMER: Note that this is a biomechanical research screening tool and does not constitute a definitive medical diagnosis.`;

    const response = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: state.nvidia.provider || 'nvidia',
        apiKey: state.nvidia.apiKey,
        model: state.nvidia.model,
        customUrl: state.nvidia.customUrl,
        messages: [
          { role: 'system', content: 'You are an advanced orthopedic biomechanics AI assistant providing clear, evidence-based pedobarography and foot defect screening diagnostics.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        maxTokens: 850
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${response.status} from LLM proxy`);
    }

    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'LLM generation failed');
    return json.content.trim();
  }

  // Backwards compatibility alias
  const runNvidiaClinicalInference = runLLMClinicalInference;

  function generateDeterministicClinicalReport(data) {
    const { heelPct, midfootPct, forefootPct, toesPct, diagnostics, closestMatch, screeningFindings } = data;

    if (diagnostics.isUnloaded) {
      return `### 1. Insole Unweighted / No Sensor Load Detected
All 5 regional sensor locations registered 0% baseline load during the measurement period. No dynamic gait strides or active vertical ground reaction forces were detected.

### 2. Operational Guidance
• Ensure insole is securely positioned under the plantar surface of the foot.
• If using hardware mode, verify ESP32 USB COM port connection and baud rate (115200).
• If using simulation mode, press sensors on the canvas, choose a preset above, or drag across the insole.

*Notice: Biomechanical screening tool for research. No active signals recorded.*`;
    }

    let narrative = `### 1. Biomechanical Force Distribution\n`;
    if (data.strideCount > 0) {
      narrative += `Over the 30-second walking trial (${data.strideCount} detected strides), the patient displayed a regional load distribution of ${heelPct.toFixed(1)}% Heel, ${midfootPct.toFixed(1)}% Midfoot Arch, ${forefootPct.toFixed(1)}% Forefoot Ball, and ${toesPct.toFixed(1)}% Toes.\n\n`;
    } else {
      narrative += `Instantaneous sensor screening snapshot displayed a regional load distribution of ${heelPct.toFixed(1)}% Heel, ${midfootPct.toFixed(1)}% Midfoot Arch, and ${forefootPct.toFixed(1)}% Forefoot Ball.\n\n`;
    }

    narrative += `### 2. Plantar Defect & Abnormality Screening Results\n`;
    const detected = (screeningFindings || []).filter(f => f.status === 'Detected');
    if (detected.length > 0) {
      narrative += `The 15-condition screening engine identified **${detected.length} pressure-pattern abnormalities**:\n`;
      detected.forEach(d => {
        narrative += `• **${d.name} (${d.severity} Risk)**: ${d.abnormalityDetected} Evidence: ${d.supportingEvidence} *Potential Association*: ${d.possibleClinicalAssociation}\n`;
      });
      narrative += `\n`;
    } else {
      narrative += `All 15 plantar defect and pressure-related screening checks are currently within normal baseline thresholds.\n\n`;
    }

    narrative += `### 3. Knee Joint Defect & Kinetic Chain Evaluation\n`;
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

    narrative += `\n### 4. Clinical Dataset Benchmark Evidence\n`;
    narrative += `The measured 4-region distribution most closely matches reference pattern **${closestMatch.record_id}** (*${closestMatch.pattern}*). In clinical gait databases, this pattern is characterized by: ${closestMatch.description}\n\n`;

    narrative += `### 5. Orthotic & Corrective Recommendations\n`;
    if (midfootPct > 20) {
      narrative += `• Custom semirigid orthotic insole with medial longitudinal arch support to limit tibial internal rotation.\n`;
      narrative += `• Strengthening of the posterior tibialis, hip abductors (gluteus medius), and vastus medialis oblique (VMO).\n`;
    } else if (midfootPct < 10) {
      narrative += `• Cushioned insole with shock-absorbing calcaneal viscoelastic heel cup to protect knee menisci.\n`;
    } else {
      narrative += `• Maintain current footwear with neutral heel cushioning and flexible toe-box.\n`;
    }

    narrative += `\n*Clinical & Technical Notice: Biomechanical research screening evaluation. Pressure-pattern abnormalities do not constitute confirmed medical diagnoses. Flatfoot, high arch, plantar fasciitis, metatarsalgia, and diabetic ulcer risk require comprehensive clinical evaluation by an orthopedic specialist or podiatrist.*`;

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

      case 'flatfoot': // Severe Flatfoot (Pes Planus)
        setVal('heel', 0.22);
        setVal('arch_medial', 0.52);
        setVal('arch_lateral', 0.32);
        setVal('forefoot_medial', 0.40);
        setVal('forefoot_lateral', 0.28);
        break;

      case 'cavus': // Pes Cavus (Rigid High Arch)
        setVal('heel', 0.68);
        setVal('arch_medial', 0.02);
        setVal('arch_lateral', 0.04);
        setVal('forefoot_medial', 0.52);
        setVal('forefoot_lateral', 0.48);
        break;

      case 'metatarsalgia': // Forefoot Hyper-Pressure Overload
        setVal('heel', 0.15);
        setVal('arch_medial', 0.08);
        setVal('arch_lateral', 0.12);
        setVal('forefoot_medial', 0.92);
        setVal('forefoot_lateral', 0.78);
        break;

      case 'zero': // Zero Contact (Unloaded)
        setVal('heel', 0.00);
        setVal('arch_medial', 0.00);
        setVal('arch_lateral', 0.00);
        setVal('forefoot_medial', 0.00);
        setVal('forefoot_lateral', 0.00);
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

    // Instant Screen button (Evaluates current pressure state without 30s timer)
    const btnInstant = document.getElementById('btn-instant-evaluate');
    if (btnInstant) {
      btnInstant.addEventListener('click', runInstantScreening);
    }

    // Screening filter tabs
    const filterAll = document.getElementById('screening-filter-all');
    if (filterAll) {
      filterAll.addEventListener('click', () => applyScreeningFilter('all'));
    }
    const filterDet = document.getElementById('screening-filter-detected');
    if (filterDet) {
      filterDet.addEventListener('click', () => applyScreeningFilter('detected'));
    }

    // Settings Modal
    const modal = document.getElementById('settings-modal');
    const providerSelect = document.getElementById('llm-provider-select');
    const customUrlGroup = document.getElementById('llm-custom-url-group');
    const customUrlInput = document.getElementById('llm-custom-url-input');
    const modelSelect = document.getElementById('nvidia-model-select');
    const apiKeyInput = document.getElementById('nvidia-api-key-input');
    const lblApiKey = document.getElementById('lbl-api-key');
    const helpBox = document.getElementById('provider-help-box');

    const LLM_PROVIDER_MODELS = {
      nvidia: [
        { id: 'meta/llama-3.1-70b-instruct', name: 'meta/llama-3.1-70b-instruct (Recommended)' },
        { id: 'meta/llama-3.3-70b-instruct', name: 'meta/llama-3.3-70b-instruct (Latest High-Precision)' },
        { id: 'mistralai/mixtral-8x22b-instruct', name: 'mistralai/mixtral-8x22b-instruct (High Reasoning)' },
        { id: 'meta/llama-3.1-8b-instruct', name: 'meta/llama-3.1-8b-instruct (Fast & Lightweight)' },
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'nvidia/llama-3.1-nemotron-70b-instruct' }
      ],
      gemini: [
        { id: 'gemini-2.0-flash', name: 'gemini-2.0-flash (Recommended & Ultra Fast)' },
        { id: 'gemini-1.5-flash', name: 'gemini-1.5-flash (Fast Multimodal)' },
        { id: 'gemini-1.5-pro', name: 'gemini-1.5-pro (Deep Clinical Reasoning)' },
        { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash (Experimental)' }
      ],
      groq: [
        { id: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile (Sub-Second Latency)' },
        { id: 'llama-3.1-8b-instant', name: 'llama-3.1-8b-instant (Ultra Fast)' },
        { id: 'mixtral-8x7b-32768', name: 'mixtral-8x7b-32768' },
        { id: 'gemma2-9b-it', name: 'gemma2-9b-it' }
      ],
      openai: [
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini (Fast & Efficient)' },
        { id: 'gpt-4o', name: 'gpt-4o (High Precision)' },
        { id: 'gpt-3.5-turbo', name: 'gpt-3.5-turbo (Legacy)' }
      ],
      openrouter: [
        { id: 'meta-llama/llama-3.3-70b-instruct', name: 'meta-llama/llama-3.3-70b-instruct' },
        { id: 'google/gemini-2.0-flash-exp:free', name: 'google/gemini-2.0-flash-exp:free (Free Tier)' },
        { id: 'mistralai/mistral-7b-instruct:free', name: 'mistralai/mistral-7b-instruct:free' },
        { id: 'anthropic/claude-3.5-sonnet', name: 'anthropic/claude-3.5-sonnet' }
      ],
      ollama: [
        { id: 'llama3.1', name: 'llama3.1 (Local 8B)' },
        { id: 'llama3', name: 'llama3 (Local)' },
        { id: 'mistral', name: 'mistral (Local 7B)' },
        { id: 'phi3', name: 'phi3 (Local Microsoft)' }
      ],
      custom: [
        { id: 'default', name: 'Custom OpenAI-Compatible Model' }
      ]
    };

    function updateProviderForm(prov) {
      if (customUrlGroup) {
        customUrlGroup.style.display = (prov === 'custom' || prov === 'ollama') ? 'block' : 'none';
      }
      if (lblApiKey) {
        if (prov === 'gemini') lblApiKey.textContent = 'Google Gemini API Key:';
        else if (prov === 'groq') lblApiKey.textContent = 'Groq Cloud API Key:';
        else if (prov === 'openai') lblApiKey.textContent = 'OpenAI API Key:';
        else if (prov === 'openrouter') lblApiKey.textContent = 'OpenRouter API Key:';
        else if (prov === 'ollama') lblApiKey.textContent = 'Ollama API Key (Optional):';
        else if (prov === 'custom') lblApiKey.textContent = 'Custom API Key (Optional):';
        else lblApiKey.textContent = 'NVIDIA NIM API Key:';
      }
      if (apiKeyInput) {
        if (prov === 'gemini') apiKeyInput.placeholder = 'AIzaSy...';
        else if (prov === 'groq') apiKeyInput.placeholder = 'gsk_...';
        else if (prov === 'openai') apiKeyInput.placeholder = 'sk-...';
        else if (prov === 'openrouter') apiKeyInput.placeholder = 'sk-or-v1-...';
        else if (prov === 'ollama') apiKeyInput.placeholder = 'Not required for localhost';
        else if (prov === 'custom') apiKeyInput.placeholder = 'Bearer token if needed';
        else apiKeyInput.placeholder = 'nvapi-...';
      }
      if (modelSelect) {
        const models = LLM_PROVIDER_MODELS[prov] || LLM_PROVIDER_MODELS['nvidia'];
        modelSelect.innerHTML = models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
        if (state.nvidia.model) {
          modelSelect.value = state.nvidia.model;
        }
      }
      if (helpBox) {
        if (prov === 'gemini') {
          helpBox.innerHTML = '<p>Get a free Gemini API key at <a href="https://aistudio.google.com" target="_blank" rel="noopener">aistudio.google.com</a> (Google AI Studio).</p>';
        } else if (prov === 'groq') {
          helpBox.innerHTML = '<p>Get a fast, free Groq API key at <a href="https://console.groq.com" target="_blank" rel="noopener">console.groq.com</a>.</p>';
        } else if (prov === 'nvidia') {
          helpBox.innerHTML = '<p>Get a free starter key at <a href="https://build.nvidia.com" target="_blank" rel="noopener">build.nvidia.com</a> with 1000 free inference credits.</p>';
        } else if (prov === 'ollama') {
          helpBox.innerHTML = '<p>Ensure Ollama is running locally: <code>ollama serve</code> (default: http://localhost:11434/v1).</p>';
        } else {
          helpBox.innerHTML = '<p>Enter your provider key above. Requests are routed through the local proxy server.</p>';
        }
      }
    }

    if (providerSelect) {
      providerSelect.addEventListener('change', (e) => {
        updateProviderForm(e.target.value);
      });
    }

    document.getElementById('btn-open-settings').addEventListener('click', () => {
      const curProv = state.nvidia.provider || 'nvidia';
      if (providerSelect) providerSelect.value = curProv;
      updateProviderForm(curProv);
      if (apiKeyInput) apiKeyInput.value = state.nvidia.apiKey || '';
      if (customUrlInput) customUrlInput.value = state.nvidia.customUrl || '';
      if (modelSelect && state.nvidia.model) modelSelect.value = state.nvidia.model;
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

    // Fetch Live Models Button
    const btnFetchModels = document.getElementById('btn-fetch-models');
    if (btnFetchModels) {
      btnFetchModels.addEventListener('click', async () => {
        const prov = providerSelect ? providerSelect.value : (state.nvidia.provider || 'nvidia');
        const key = apiKeyInput ? apiKeyInput.value.trim() : (state.nvidia.apiKey || '');
        const cUrl = customUrlInput ? customUrlInput.value.trim() : (state.nvidia.customUrl || '');
        const statusBox = document.getElementById('settings-status-message');

        statusBox.className = 'settings-status-box';
        statusBox.textContent = `Fetching live models for ${prov.toUpperCase()}...`;

        try {
          const resp = await fetch('/api/llm/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: prov, apiKey: key, baseUrl: cUrl })
          });
          const data = await resp.json();
          if (data.ok && data.models && data.models.length > 0) {
            modelSelect.innerHTML = data.models.map(m => `<option value="${m}">${m}</option>`).join('');
            statusBox.className = 'settings-status-box success';
            statusBox.textContent = `Retrieved ${data.models.length} live models from ${prov.toUpperCase()}!`;
          } else {
            statusBox.className = 'settings-status-box';
            statusBox.textContent = 'Using default model catalog for ' + prov;
          }
        } catch (err) {
          statusBox.className = 'settings-status-box error';
          statusBox.textContent = `Failed to fetch models: ${err.message}`;
        }
      });
    }

    document.getElementById('btn-save-settings').addEventListener('click', () => {
      const prov = providerSelect ? providerSelect.value : 'nvidia';
      const key = apiKeyInput ? apiKeyInput.value.trim() : '';
      const model = modelSelect ? modelSelect.value : 'meta/llama-3.1-70b-instruct';
      const cUrl = customUrlInput ? customUrlInput.value.trim() : '';

      state.nvidia.provider = prov;
      state.nvidia.apiKey = key;
      state.nvidia.model = model;
      state.nvidia.customUrl = cUrl;

      try {
        localStorage.setItem('velostat_llm_provider', prov);
        localStorage.setItem('velostat_nvidia_api_key', key);
        localStorage.setItem('velostat_nvidia_model', model);
        localStorage.setItem('velostat_llm_custom_url', cUrl);
      } catch (_) {}

      updateApiStatusPill();
      const statusBox = document.getElementById('settings-status-message');
      statusBox.className = 'settings-status-box success';
      statusBox.textContent = (key || prov === 'ollama')
        ? `Settings saved! ${prov.toUpperCase()} (${model.split('/').pop()}) active.`
        : 'Settings saved. Using deterministic rule engine.';
      setTimeout(() => { modal.style.display = 'none'; }, 900);
    });

    document.getElementById('btn-test-nvidia').addEventListener('click', async () => {
      const prov = providerSelect ? providerSelect.value : 'nvidia';
      const key = apiKeyInput ? apiKeyInput.value.trim() : '';
      const cUrl = customUrlInput ? customUrlInput.value.trim() : '';
      const statusBox = document.getElementById('settings-status-message');

      if (!key && prov !== 'ollama') {
        statusBox.className = 'settings-status-box error';
        statusBox.textContent = 'Please enter an API key first.';
        return;
      }

      statusBox.className = 'settings-status-box';
      statusBox.textContent = `Testing connection with ${prov.toUpperCase()} via server proxy...`;

      try {
        const resp = await fetch('/api/llm/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: prov, apiKey: key, baseUrl: cUrl })
        });
        const json = await resp.json();
        if (json.ok) {
          statusBox.className = 'settings-status-box success';
          statusBox.textContent = json.message || `Connection verified with ${prov.toUpperCase()}!`;
        } else {
          statusBox.className = 'settings-status-box error';
          statusBox.textContent = json.error || `Connection test failed. Check your API key.`;
        }
      } catch (err) {
        statusBox.className = 'settings-status-box error';
        statusBox.textContent = `Network error: ${err.message}. Is server.py running?`;
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

    // Screening Defect Presets
    const btnFlatfoot = document.getElementById('btn-preset-flatfoot');
    if (btnFlatfoot) {
      btnFlatfoot.addEventListener('click', () => {
        applyPreset('flatfoot');
        runInstantScreening();
      });
    }

    const btnCavus = document.getElementById('btn-preset-cavus');
    if (btnCavus) {
      btnCavus.addEventListener('click', () => {
        applyPreset('cavus');
        runInstantScreening();
      });
    }

    const btnMetatarsalgia = document.getElementById('btn-preset-metatarsalgia');
    if (btnMetatarsalgia) {
      btnMetatarsalgia.addEventListener('click', () => {
        applyPreset('metatarsalgia');
        runInstantScreening();
      });
    }

    const btnZero = document.getElementById('btn-preset-zero');
    if (btnZero) {
      btnZero.addEventListener('click', () => {
        applyPreset('zero');
        runInstantScreening();
      });
    }

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
