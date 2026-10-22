/**
 * Adapter for PhysioNet Gait Dynamics in Neurodegenerative Disease Database.
 * Decodes WFDB Format 212 binary signal files (.let, .rit), parses header files (.hea),
 * and ingests tabular stride time-series metrics (.ts).
 * Marks four-region spatial comparison as 'not_comparable' because the hardware measured
 * single total-foot ground reaction force rather than multi-zone spatial distributions.
 */

const {
  ADAPTER_STATUS,
  createSharedRecord
} = require('./base_adapter');

/**
 * Decodes PhysioNet WFDB Format 212 binary buffer into signed 12-bit integer samples.
 * Format 212 packs pairs of 12-bit two's-complement samples into 3-byte triplets:
 *   Sample 1 = ( (byte1 & 0x0F) << 8 ) | byte0
 *   Sample 2 = ( (byte1 >> 4) << 8 ) | byte2
 * Sign extension applied for 12-bit negative numbers.
 * @param {Buffer} buffer Raw binary buffer
 * @returns {Int16Array} Decoded sample amplitudes
 */
function decodeFormat212(buffer) {
  const numTriplets = Math.floor(buffer.length / 3);
  const totalSamples = numTriplets * 2;
  const samples = new Int16Array(totalSamples);

  let sampleIdx = 0;
  for (let i = 0; i < numTriplets * 3; i += 3) {
    const b0 = buffer[i];
    const b1 = buffer[i + 1];
    const b2 = buffer[i + 2];

    // First sample: lower 8 bits from b0, high 4 bits from lower nibble of b1
    let s0 = ((b1 & 0x0f) << 8) | b0;
    if (s0 >= 2048) s0 -= 4096; // Sign-extend 12-bit two's complement

    // Second sample: lower 8 bits from b2, high 4 bits from upper nibble of b1
    let s1 = ((b1 >> 4) << 8) | b2;
    if (s1 >= 2048) s1 -= 4096; // Sign-extend 12-bit two's complement

    samples[sampleIdx++] = s0;
    samples[sampleIdx++] = s1;
  }

  return samples;
}

class NeurodegenerativeDbAdapter {
  constructor() {
    this.datasetName = 'gait-in-neurodegenerative-disease';
    this.version = '1.0.0';
    this.defaultSampleRateHz = 300;
  }

  /**
   * Parses WFDB .hea text header file.
   */
  parseHeader(heaContent, provenance = {}) {
    const lines = heaContent.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return { signals: [] };

    const firstTokens = lines[0].trim().split(/\s+/);
    const recordName = firstTokens[0];
    const numSignals = parseInt(firstTokens[1], 10) || 1;
    const sampleRate = parseFloat(firstTokens[2]) || this.defaultSampleRateHz;
    const numSamples = parseInt(firstTokens[3], 10) || null;

    const signals = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('#')) continue; // Skip comments
      const sigTokens = lines[i].trim().split(/\s+/);
      if (sigTokens.length < 3) continue;

      signals.push({
        fileName: sigTokens[0],
        format: sigTokens[1],
        gain: parseFloat(sigTokens[2]) || 1.0,
        baseline: parseInt(sigTokens[4], 10) || 0,
        description: sigTokens.slice(8).join(' ') || sigTokens[0]
      });
    }

    return {
      record_name: recordName,
      num_signals: numSignals,
      sample_rate_hz: sampleRate,
      num_samples: numSamples,
      signals: Object.freeze(signals),
      status: ADAPTER_STATUS.ACCEPTED
    };
  }

  /**
   * Parses binary .let or .rit signal file.
   * @param {Buffer} binaryBuffer Raw binary buffer
   * @param {Object} options { foot: 'left'|'right', sampleRateHz, gain, provenance }
   */
  parseSignal(binaryBuffer, options = {}) {
    const foot = options.foot || 'unspecified';
    const sampleRate = options.sampleRateHz || this.defaultSampleRateHz;
    const gain = options.gain || 1000.0; // Typical gain from .hea
    const provenance = options.provenance || {};

    const rawSamples = decodeFormat212(binaryBuffer);

    // Compute basic summary stats
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < rawSamples.length; i++) {
      const v = rawSamples[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    const mean = rawSamples.length > 0 ? sum / rawSamples.length : 0;

    const record = createSharedRecord({
      source_dataset: this.datasetName,
      source_version: this.version,
      source_record_id: `${provenance.source_file || 'signal'}_${foot}`,
      foot,
      timestamp_sec: 0,
      sample_rate_hz: sampleRate,
      original_values: {
        total_sample_count: rawSamples.length,
        duration_sec: Number((rawSamples.length / sampleRate).toFixed(2)),
        gain,
        min_raw: min,
        max_raw: max,
        mean_raw: Number(mean.toFixed(2)),
        sample_preview: Array.from(rawSamples.slice(0, 10)) // Lightweight audit preview
      },
      original_units: 'raw_digital_amplitude_12bit',
      regional_values: null, // NOT mapped to four regions
      regional_units: null,
      mapping_method: 'none',
      mapping_coverage: 0.0,
      normalization_method: 'none',
      status: ADAPTER_STATUS.NOT_COMPARABLE,
      reasons: [
        `Binary signal decoded successfully via Format 212 (${rawSamples.length} samples at ${sampleRate} Hz).`,
        'Sensor configuration measures single aggregated vertical ground reaction force per foot.',
        'Regional four-zone pressure distribution (heel/arch/ball/toes) is not provided by this single-sensor instrument.'
      ],
      provenance: {
        archive: provenance.archive || 'gait-in-neurodegenerative-disease-database-1.0.0.zip',
        source_file: provenance.source_file || `${foot}.let`,
        row_or_sample_index: 0,
        notes: `WFDB Format 212 12-bit binary waveform. Foot: ${foot}.`
      }
    });

    return {
      source_dataset: this.datasetName,
      source_version: this.version,
      foot,
      sample_count: rawSamples.length,
      sample_rate_hz: sampleRate,
      record: Object.freeze(record),
      status: ADAPTER_STATUS.NOT_COMPARABLE
    };
  }

  /**
   * Parses .ts stride interval time-series text file.
   */
  parseStrideTimeSeries(tsContent, provenance = {}) {
    const lines = tsContent.split(/\r?\n/).filter(l => l.trim().length > 0);
    const records = [];
    const quarantined = [];

    const columnNames = [
      'elapsed_time_sec',
      'left_stride_interval_sec',
      'right_stride_interval_sec',
      'left_swing_interval_sec',
      'right_swing_interval_sec',
      'left_swing_pct_stride',
      'right_swing_pct_stride',
      'left_stance_interval_sec',
      'right_stance_interval_sec',
      'left_stance_pct_stride',
      'right_stance_pct_stride',
      'double_support_interval_sec',
      'double_support_pct_stride'
    ];

    for (let i = 0; i < lines.length; i++) {
      const tokens = lines[i].trim().split(/\s+/);
      if (tokens.length !== 13) {
        quarantined.push({ row_index: i, reason: `Expected 13 columns, found ${tokens.length}` });
        continue;
      }

      const nums = tokens.map(Number);
      if (nums.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
        quarantined.push({ row_index: i, reason: 'Row contains non-numeric values' });
        continue;
      }

      const values = {};
      columnNames.forEach((col, idx) => {
        values[col] = nums[idx];
      });

      records.push(
        createSharedRecord({
          source_dataset: this.datasetName,
          source_version: this.version,
          source_record_id: `${provenance.source_file || 'stride'}_stride${i + 1}`,
          foot: 'both',
          timestamp_sec: values.elapsed_time_sec,
          sample_rate_hz: null,
          original_values: values,
          original_units: 'seconds_and_percentage',
          regional_values: null,
          regional_units: null,
          mapping_method: 'none',
          mapping_coverage: 0.0,
          normalization_method: 'none',
          status: ADAPTER_STATUS.NOT_COMPARABLE,
          reasons: [
            'Derived step-to-step gait interval metrics, not continuous localized insole pressure.',
            'Preserved as auxiliary gait temporal dynamics record.'
          ],
          provenance: {
            archive: provenance.archive || 'gait-in-neurodegenerative-disease-database-1.0.0.zip',
            source_file: provenance.source_file || 'record.ts',
            row_or_sample_index: i,
            notes: '13-column gait interval time series.'
          }
        })
      );
    }

    return {
      source_dataset: this.datasetName,
      source_version: this.version,
      source_file: provenance.source_file || 'unknown.ts',
      total_strides: records.length,
      quarantined_count: quarantined.length,
      records: Object.freeze(records),
      quarantined_records: Object.freeze(quarantined),
      status: ADAPTER_STATUS.NOT_COMPARABLE
    };
  }
}

module.exports = {
  NeurodegenerativeDbAdapter,
  decodeFormat212
};
