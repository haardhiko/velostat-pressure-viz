/**
 * Adapter for GaitRite Insole Pressure Dataset.
 * Parses 32-sensor insole CSVs (L.csv, R.csv), GaitRite mat events, and synchronization JSON.
 * Explicitly marks four-region mapping as 'needs_mapping' due to unverified spatial layout.
 * Video files are explicitly excluded.
 */

const {
  ADAPTER_STATUS,
  createSharedRecord
} = require('./base_adapter');

class GaitRiteInsoleAdapter {
  constructor() {
    this.datasetName = 'insole-gaitrite-dataset';
    this.version = '1.0.0';
  }

  /**
   * Parses L.csv or R.csv insole pressure data.
   * @param {string} csvContent Raw CSV content
   * @param {Object} options { foot: 'left'|'right', provenance: {} }
   * @returns {Object} Ingestion result
   */
  parseInsoleCsv(csvContent, options = {}) {
    const foot = options.foot || 'unspecified';
    const provenance = options.provenance || {};

    const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      return {
        source_dataset: this.datasetName,
        source_version: this.version,
        accepted_count: 0,
        quarantined_count: 0,
        records: [],
        reasons: ['CSV contains fewer than 2 rows (missing header or data)']
      };
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const pressureIndices = [];
    headers.forEach((h, idx) => {
      if (/^PressureSensor\s*\d+$/i.test(h)) {
        pressureIndices.push({ name: h, idx });
      }
    });

    const accelXIdx = headers.indexOf('AccelerometerX');
    const copXIdx = headers.indexOf('copX');
    const copYIdx = headers.indexOf('copY');
    const sumPIdx = headers.indexOf('sumP');

    const accepted = [];
    const quarantined = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const tokens = line.split(',');

      if (tokens.length !== headers.length) {
        quarantined.push({
          row_index: i,
          reason: `Column count mismatch: expected ${headers.length}, got ${tokens.length}`
        });
        continue;
      }

      const originalValues = {};
      let hasInvalid = false;

      // Extract 32 pressure sensors
      pressureIndices.forEach(({ name, idx }) => {
        const val = Number(tokens[idx]);
        if (!Number.isFinite(val)) {
          hasInvalid = true;
        }
        originalValues[name] = val;
      });

      if (hasInvalid) {
        quarantined.push({
          row_index: i,
          reason: 'Non-finite pressure value detected in row'
        });
        continue;
      }

      // Supplementary telemetry
      const sumP = sumPIdx >= 0 ? Number(tokens[sumPIdx]) : null;
      const copX = copXIdx >= 0 ? Number(tokens[copXIdx]) : null;
      const copY = copYIdx >= 0 ? Number(tokens[copYIdx]) : null;

      const record = createSharedRecord({
        source_dataset: this.datasetName,
        source_version: this.version,
        source_record_id: `${provenance.source_file || 'insole'}_${foot}_row${i}`,
        foot,
        timestamp_sec: null, // Relative row index (sample clock)
        sample_rate_hz: null, // Documented in metadata
        original_values: originalValues,
        original_units: 'raw_sensor_counts',
        regional_values: null, // Not mapped!
        regional_units: null,
        mapping_method: 'none',
        mapping_coverage: 0.0,
        normalization_method: 'none',
        status: ADAPTER_STATUS.NEEDS_MAPPING,
        reasons: [
          'Spatial coordinate layout for PressureSensor 0–31 is not documented in dataset archive.',
          'Direct assignment to heel/arch/ball/toes cannot be scientifically justified without sensor geometry specifications.'
        ],
        provenance: {
          archive: provenance.archive || 'insole-gaitrite-dataset.zip',
          source_file: provenance.source_file || `${foot}.csv`,
          row_or_sample_index: i,
          notes: `Telemetry: sumP=${sumP}, copX=${copX}, copY=${copY}. Video files explicitly excluded.`
        }
      });

      accepted.push(record);
    }

    return {
      source_dataset: this.datasetName,
      source_version: this.version,
      source_file: provenance.source_file || `${foot}.csv`,
      total_rows: lines.length - 1,
      accepted_count: accepted.length,
      quarantined_count: quarantined.length,
      records: Object.freeze(accepted),
      quarantined_records: Object.freeze(quarantined),
      status: ADAPTER_STATUS.NEEDS_MAPPING
    };
  }

  /**
   * Parses GaitRite temporal-spatial mat events CSV (semicolon separated).
   */
  parseGaitriteTestCsv(csvContent, provenance = {}) {
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return { events: [] };

    const headers = lines[0].split(';').map(h => h.trim());
    const events = [];

    for (let i = 1; i < lines.length; i++) {
      const tokens = lines[i].split(';');
      if (tokens.length < headers.length) continue;

      const eventObj = {};
      headers.forEach((h, idx) => {
        const val = tokens[idx] ? tokens[idx].trim() : '';
        const num = Number(val);
        eventObj[h] = !isNaN(num) && val !== '' ? num : val;
      });
      events.push(eventObj);
    }

    return {
      source_dataset: this.datasetName,
      source_file: provenance.source_file || 'gaitrite_test.csv',
      total_events: events.length,
      events: Object.freeze(events),
      status: ADAPTER_STATUS.NOT_COMPARABLE,
      reasons: ['GaitRite mat records temporal-spatial gait parameters, not continuous insole pressure.']
    };
  }

  /**
   * Parses synchronization JSON (sync_auto.json).
   */
  parseSyncJson(jsonContent) {
    try {
      const parsed = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
      return {
        source_dataset: this.datasetName,
        sync_offsets: parsed,
        status: ADAPTER_STATUS.ACCEPTED
      };
    } catch (err) {
      return {
        source_dataset: this.datasetName,
        status: ADAPTER_STATUS.QUARANTINED,
        reasons: [`Failed to parse sync JSON: ${err.message}`]
      };
    }
  }
}

module.exports = {
  GaitRiteInsoleAdapter
};
