/**
 * Base Dataset Adapter for Velostat Pressure Analysis.
 * Defines shared schema, ingestion lifecycle, and comparability states.
 */

const ADAPTER_STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  QUARANTINED: 'quarantined',
  UNSUPPORTED: 'unsupported',
  NEEDS_MAPPING: 'needs_mapping',
  NOT_COMPARABLE: 'not_comparable'
});

const PRODUCT_REGIONS = Object.freeze(['heel', 'arch', 'ball', 'toes']);

/**
 * Creates a standardized internal record representation.
 */
function createSharedRecord(fields) {
  return {
    source_dataset: fields.source_dataset,
    source_version: fields.source_version || '1.0.0',
    source_record_id: fields.source_record_id,
    foot: fields.foot || 'unspecified', // 'left' | 'right' | 'both' | 'unspecified'
    timestamp_sec: fields.timestamp_sec !== undefined ? fields.timestamp_sec : null,
    sample_rate_hz: fields.sample_rate_hz || null,
    original_values: Object.freeze(fields.original_values || {}),
    original_units: fields.original_units || 'unknown',
    
    // Derived four-region values (heel, arch, ball, toes)
    regional_values: fields.regional_values ? Object.freeze({ ...fields.regional_values }) : null,
    regional_units: fields.regional_units || null, // e.g. 'relative_load_pct' or 'N'
    
    // Mapping and normalization metadata
    mapping_method: fields.mapping_method || 'none',
    mapping_coverage: typeof fields.mapping_coverage === 'number' ? fields.mapping_coverage : 0.0,
    normalization_method: fields.normalization_method || 'none',
    contributing_sensor_ids: fields.contributing_sensor_ids ? Object.freeze({ ...fields.contributing_sensor_ids }) : null,
    
    // Comparability & Data Quality
    status: fields.status || ADAPTER_STATUS.NEEDS_MAPPING,
    reasons: Object.freeze(fields.reasons || []),
    provenance: Object.freeze({
      archive: fields.provenance?.archive || 'unknown',
      source_file: fields.provenance?.source_file || 'unknown',
      row_or_sample_index: fields.provenance?.row_or_sample_index ?? null,
      notes: fields.provenance?.notes || ''
    })
  };
}

class BaseDatasetAdapter {
  constructor(name) {
    this.name = name;
  }

  async parse(input) {
    throw new Error('parse() must be implemented by subclass');
  }
}

module.exports = {
  ADAPTER_STATUS,
  PRODUCT_REGIONS,
  createSharedRecord,
  BaseDatasetAdapter
};
