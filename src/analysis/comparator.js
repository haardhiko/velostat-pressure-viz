/**
 * Deterministic Numerical Comparator for Velostat Foot Pressure Analysis (Phase 2).
 * Compares verified incoming sensor readings against reference records.
 * All calculations, distance metrics, channel filtering, and rankings occur here.
 */

const {
  VALID_SENSOR_IDS,
  DEFAULT_MIN_COMPARABLE_CHANNELS,
  ANALYSIS_STATUS
} = require('./constants');

/**
 * Normalizes an incoming sensor snapshot into an explicit structure.
 * @param {Object} rawSnapshot Map of sensorId -> number or sensorId -> { value, hasSignal }
 * @returns {Object} Cleaned snapshot with explicit status per sensor
 */
function normalizeSensorSnapshot(rawSnapshot) {
  const result = {};

  VALID_SENSOR_IDS.forEach((id) => {
    const item = rawSnapshot ? rawSnapshot[id] : null;

    if (item === null || item === undefined) {
      result[id] = { hasSignal: false, value: null, reason: 'missing_from_snapshot' };
      return;
    }

    // Item could be a raw number or an object { value, hasSignal, source }
    if (typeof item === 'number') {
      if (Number.isFinite(item)) {
        result[id] = { hasSignal: true, value: Math.max(0, Math.min(1.0, item)), source: 'direct_numeric' };
      } else {
        result[id] = { hasSignal: false, value: null, reason: 'non_finite_number' };
      }
    } else if (typeof item === 'object') {
      const isSignal = Boolean(item.hasSignal);
      const val = typeof item.value === 'number' && Number.isFinite(item.value)
        ? Math.max(0, Math.min(1.0, item.value))
        : (typeof item.targetValue === 'number' && Number.isFinite(item.targetValue)
            ? Math.max(0, Math.min(1.0, item.targetValue))
            : null);

      if (isSignal && val !== null) {
        result[id] = { hasSignal: true, value: val, source: item.source || 'sensor_reading' };
      } else {
        result[id] = { hasSignal: false, value: null, reason: isSignal ? 'invalid_value' : 'no_signal' };
      }
    } else {
      result[id] = { hasSignal: false, value: null, reason: 'unrecognized_type' };
    }
  });

  return result;
}

/**
 * Compares an incoming sensor snapshot against validated reference records.
 * @param {Object} sensorSnapshot Raw or normalized sensor readings
 * @param {Object} validatedDataset Output of validateReferenceDataset
 * @param {Object} options { minComparableChannels, topK }
 * @returns {Object} Structured comparison evidence
 */
function compareSensorWithDataset(sensorSnapshot, validatedDataset, options = {}) {
  const minChannels = options.minComparableChannels || DEFAULT_MIN_COMPARABLE_CHANNELS;
  const topK = options.topK || 3;

  const normalizedSnapshot = normalizeSensorSnapshot(sensorSnapshot);

  // Extract active sensor channels with valid signals
  const activeChannels = [];
  const unmappedOrMissingChannels = [];

  VALID_SENSOR_IDS.forEach((id) => {
    if (normalizedSnapshot[id].hasSignal) {
      activeChannels.push(id);
    } else {
      unmappedOrMissingChannels.push(id);
    }
  });

  const records = validatedDataset && validatedDataset.valid_records
    ? validatedDataset.valid_records
    : (Array.isArray(validatedDataset) ? validatedDataset : []);

  if (records.length === 0) {
    return {
      status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
      reason: 'No valid reference dataset records available for comparison',
      active_channel_count: activeChannels.length,
      active_channels: activeChannels,
      unmapped_or_missing_channels: unmappedOrMissingChannels,
      matches: []
    };
  }

  // Check if overall active channel count is below minimum requirement
  if (activeChannels.length < minChannels) {
    return {
      status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
      reason: `Insufficient active sensor channels (${activeChannels.length} active; minimum required: ${minChannels}). Single-channel or sparse inputs cannot establish planar pattern similarity.`,
      active_channel_count: activeChannels.length,
      active_channels: activeChannels,
      unmapped_or_missing_channels: unmappedOrMissingChannels,
      matches: []
    };
  }

  // Compute distance & similarity for each reference record
  const scoredRecords = [];

  records.forEach((record) => {
    // Intersect mutually active channels
    const mutualChannels = activeChannels.filter((id) => {
      return record.pressures[id] !== undefined && Number.isFinite(record.pressures[id]);
    });

    if (mutualChannels.length < minChannels) {
      return; // Skip records with insufficient channel overlap
    }

    let sumSquaredDiff = 0;
    const channelDeltas = {};

    mutualChannels.forEach((id) => {
      const sVal = normalizedSnapshot[id].value;
      const rVal = record.pressures[id];
      const diff = sVal - rVal;
      sumSquaredDiff += diff * diff;
      channelDeltas[id] = Number(diff.toFixed(4));
    });

    const rmsd = Math.sqrt(sumSquaredDiff / mutualChannels.length);
    const similarity = Math.max(0, 1 - rmsd);

    scoredRecords.push({
      record_id: record.record_id,
      pattern: record.pattern,
      similarity_score: Number(similarity.toFixed(4)),
      rmsd_distance: Number(rmsd.toFixed(4)),
      comparable_channel_count: mutualChannels.length,
      comparable_channels: mutualChannels,
      channel_deltas: channelDeltas,
      provenance: record.provenance
    });
  });

  if (scoredRecords.length === 0) {
    return {
      status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
      reason: `No reference records shared at least ${minChannels} overlapping channels with the active sensor set`,
      active_channel_count: activeChannels.length,
      active_channels: activeChannels,
      unmapped_or_missing_channels: unmappedOrMissingChannels,
      matches: []
    };
  }

  // Deterministic sort: similarity descending -> distance ascending -> record_id ascending
  scoredRecords.sort((a, b) => {
    if (b.similarity_score !== a.similarity_score) {
      return b.similarity_score - a.similarity_score;
    }
    if (a.rmsd_distance !== b.rmsd_distance) {
      return a.rmsd_distance - b.rmsd_distance;
    }
    return a.record_id.localeCompare(b.record_id);
  });

  const topMatches = scoredRecords.slice(0, topK);

  return {
    status: ANALYSIS_STATUS.OK,
    comparison_method: 'Root Mean Squared Deviation (RMSD) on mutually active normalized channels',
    active_channel_count: activeChannels.length,
    active_channels: activeChannels,
    unmapped_or_missing_channels: unmappedOrMissingChannels,
    matched_count: topMatches.length,
    matches: Object.freeze(topMatches)
  };
}

module.exports = {
  compareSensorWithDataset,
  normalizeSensorSnapshot
};
