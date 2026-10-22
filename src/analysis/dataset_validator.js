/**
 * Reference Dataset Validator for Velostat Pressure Analysis (Phase 2).
 * Validates dataset structure, sensor channels, value ranges, and uniqueness.
 * Quarantines malformed records without silent coercion or data loss.
 */

const {
  VALID_SENSOR_IDS,
  SUPPORTED_UNITS,
  CLINICAL_DISCLAIMER
} = require('./constants');

class DatasetValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'DatasetValidationError';
    this.details = details;
  }
}

/**
 * Validates a reference dataset object or parsed JSON.
 * @param {Object} rawDataset
 * @returns {Object} { isValid, datasetId, version, unit, validRecords, quarantinedRecords, errors }
 */
function validateReferenceDataset(rawDataset) {
  const errors = [];
  const quarantinedRecords = [];
  const validRecords = [];

  if (!rawDataset || typeof rawDataset !== 'object' || Array.isArray(rawDataset)) {
    throw new DatasetValidationError('Dataset payload must be a non-null object', ['Root payload is not an object']);
  }

  // 1. Dataset-level headers
  const datasetId = typeof rawDataset.dataset_id === 'string' ? rawDataset.dataset_id.trim() : null;
  if (!datasetId) {
    errors.push('Missing or empty "dataset_id" header');
  }

  const version = typeof rawDataset.version === 'string' ? rawDataset.version.trim() : '1.0.0';

  const unit = typeof rawDataset.unit === 'string' ? rawDataset.unit.trim().toLowerCase() : null;
  if (!unit || !Object.values(SUPPORTED_UNITS).includes(unit)) {
    errors.push(`Unsupported or missing "unit". Supported units: ${Object.values(SUPPORTED_UNITS).join(', ')}`);
  }

  if (!Array.isArray(rawDataset.records)) {
    errors.push('Dataset "records" field must be an array');
  }

  if (errors.length > 0) {
    throw new DatasetValidationError(`Dataset header validation failed: ${errors.join('; ')}`, errors);
  }

  // 2. Record-level validation
  const seenRecordIds = new Set();

  rawDataset.records.forEach((record, index) => {
    const recordErrors = [];

    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      quarantinedRecords.push({
        index,
        record: null,
        reasons: ['Record is not a valid object']
      });
      return;
    }

    const recordId = typeof record.record_id === 'string' ? record.record_id.trim() : null;
    if (!recordId) {
      recordErrors.push('Missing or non-string "record_id"');
    } else if (seenRecordIds.has(recordId)) {
      recordErrors.push(`Duplicate record_id "${recordId}" detected`);
    } else {
      seenRecordIds.add(recordId);
    }

    // Optional per-record unit override check (must match dataset unit)
    if (record.unit && record.unit.toLowerCase() !== unit) {
      recordErrors.push(`Record unit "${record.unit}" incompatible with dataset unit "${unit}"`);
    }

    // Pressures map
    if (!record.pressures || typeof record.pressures !== 'object' || Array.isArray(record.pressures)) {
      recordErrors.push('Missing or invalid "pressures" mapping object');
    } else {
      const sensorKeys = Object.keys(record.pressures);
      if (sensorKeys.length === 0) {
        recordErrors.push('"pressures" map is empty');
      }

      const validatedPressures = {};

      sensorKeys.forEach((sensorId) => {
        if (!VALID_SENSOR_IDS.has(sensorId)) {
          recordErrors.push(`Unknown sensor ID "${sensorId}" not mapped to foot layout`);
          return;
        }

        const val = record.pressures[sensorId];

        // Strict numeric check: no strings, no null, no NaN, no Infinity
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          recordErrors.push(`Sensor "${sensorId}" value is non-numeric or non-finite: ${val}`);
          return;
        }

        // Unit-specific bounds checking
        if (unit === SUPPORTED_UNITS.NORMALIZED) {
          if (val < 0.0 || val > 1.0) {
            recordErrors.push(`Sensor "${sensorId}" value ${val} out of normalized bounds [0.0, 1.0]`);
            return;
          }
        } else if (unit === SUPPORTED_UNITS.RAW_ADC) {
          if (val < 0 || val > 4095) {
            recordErrors.push(`Sensor "${sensorId}" value ${val} out of 12-bit ADC range [0, 4095]`);
            return;
          }
        }

        validatedPressures[sensorId] = val;
      });

      if (recordErrors.length === 0) {
        // Record is valid
        validRecords.push({
          record_id: recordId,
          pattern: record.pattern || 'Unnamed Pattern',
          description: record.description || '',
          unit,
          pressures: Object.freeze(validatedPressures),
          provenance: Object.freeze({
            dataset_id: datasetId,
            version,
            record_id: recordId
          })
        });
      }
    }

    if (recordErrors.length > 0) {
      quarantinedRecords.push({
        index,
        record_id: recordId || `idx_${index}`,
        reasons: recordErrors
      });
    }
  });

  return {
    isValid: validRecords.length > 0,
    dataset_id: datasetId,
    name: rawDataset.name || datasetId,
    version,
    unit,
    total_records: rawDataset.records.length,
    valid_count: validRecords.length,
    quarantined_count: quarantinedRecords.length,
    valid_records: Object.freeze(validRecords),
    quarantined_records: Object.freeze(quarantinedRecords),
    disclaimer: CLINICAL_DISCLAIMER
  };
}

module.exports = {
  validateReferenceDataset,
  DatasetValidationError
};
