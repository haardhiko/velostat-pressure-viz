/**
 * Constants and specifications for Velostat foot pressure analysis.
 * Authoritative list of sensor locations derived from Phase 1.
 */

const VALID_SENSOR_LOCATIONS = Object.freeze([
  // Toes (Phalanges)
  { id: 'toe_1', label: 'Big Toe (Hallux)', region: 'Toes' },
  { id: 'toe_2', label: 'Second Toe', region: 'Toes' },
  { id: 'toe_3', label: 'Third Toe', region: 'Toes' },
  { id: 'toe_4', label: 'Fourth Toe', region: 'Toes' },
  { id: 'toe_5', label: 'Fifth Toe (Pinky)', region: 'Toes' },

  // Forefoot / Ball (Metatarsal Heads)
  { id: 'meta_1', label: '1st Metatarsal (Medial Ball)', region: 'Forefoot' },
  { id: 'meta_2', label: '2nd Metatarsal Head', region: 'Forefoot' },
  { id: 'meta_3', label: '3rd Metatarsal Head', region: 'Forefoot' },
  { id: 'meta_5', label: '5th Metatarsal (Lateral Ball)', region: 'Forefoot' },

  // Midfoot & Arch
  { id: 'arch_medial', label: 'Medial Arch', region: 'Midfoot' },
  { id: 'midfoot_center', label: 'Central Midfoot', region: 'Midfoot' },
  { id: 'arch_lateral', label: 'Lateral Midfoot', region: 'Midfoot' },

  // Heel (Calcaneus)
  { id: 'heel_medial', label: 'Medial Heel', region: 'Heel' },
  { id: 'heel_center', label: 'Heel Center', region: 'Heel' },
  { id: 'heel_lateral', label: 'Lateral Heel', region: 'Heel' }
]);

const VALID_SENSOR_IDS = Object.freeze(new Set(VALID_SENSOR_LOCATIONS.map(s => s.id)));

const SUPPORTED_UNITS = Object.freeze({
  NORMALIZED: 'normalized', // Range 0.0 to 1.0 (Phase 1 convention)
  RAW_ADC: 'raw_adc_12bit'  // Range 0 to 4095
});

const DEFAULT_MIN_COMPARABLE_CHANNELS = 3;

const ANALYSIS_STATUS = Object.freeze({
  OK: 'ok',
  INSUFFICIENT_DATA: 'insufficient_data',
  MODEL_UNAVAILABLE: 'model_unavailable',
  VALIDATION_FAILED: 'validation_failed'
});

const CLINICAL_DISCLAIMER =
  'Notice: Findings are numerical dataset comparisons based on sensor readings and reference templates. This system does not provide medical diagnoses or clinical advice.';

module.exports = {
  VALID_SENSOR_LOCATIONS,
  VALID_SENSOR_IDS,
  SUPPORTED_UNITS,
  DEFAULT_MIN_COMPARABLE_CHANNELS,
  ANALYSIS_STATUS,
  CLINICAL_DISCLAIMER
};
