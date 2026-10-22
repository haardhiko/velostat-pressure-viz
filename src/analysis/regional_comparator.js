/**
 * Regional Deterministic Numerical Comparator for Velostat Foot Pressure (Phase 2).
 * Aggregates Phase 1 15-sensor inputs into four product regions (heel, arch, ball, toes)
 * and compares them against validated reference dataset records.
 * 
 * Strict comparability rules:
 * - Compares ONLY records with status === 'accepted' (exact match).
 * - Excludes missing, unknown, or misspelled statuses.
 * - Distinguishes measured zero from missing, unmapped, or invalid regions (never converts missing to zero).
 * - Enforces documented comparison policies:
 *     1. 'all_four_required' (default): Requires all four regions to be measured and valid on both sides.
 *     2. 'shared_subset': Compares the identical shared subset on both sides, re-normalizes over the subset,
 *        reports coverage and compared/uncompared regions, and enforces a documented minimum.
 * - Validates finite values, expected range [0.0, 1.0], and compatible units ('relative_load_pct').
 * - Deterministic tie-breaking: similarity descending -> distance ascending -> record_id ascending.
 * - Reconciles hardware channel reality: single-channel hardware (GPIO32) returns insufficient_data.
 */

const {
  PRODUCT_REGIONS,
  ADAPTER_STATUS
} = require('./adapters/base_adapter');
const {
  ANALYSIS_STATUS,
  CLINICAL_DISCLAIMER
} = require('./constants');

/**
 * Supported comparison policies.
 */
const COMPARISON_POLICIES = Object.freeze({
  ALL_FOUR_REQUIRED: 'all_four_required',
  SHARED_SUBSET: 'shared_subset'
});

/**
 * Mapping of Phase 1 15 sensor IDs to the 4 product regions.
 */
const PHASE1_REGION_MAP = Object.freeze({
  heel: Object.freeze(['heel_medial', 'heel_center', 'heel_lateral']),
  arch: Object.freeze(['arch_medial', 'midfoot_center', 'arch_lateral']),
  ball: Object.freeze(['meta_1', 'meta_2', 'meta_3', 'meta_5']),
  toes: Object.freeze(['toe_1', 'toe_2', 'toe_3', 'toe_4', 'toe_5'])
});

const DEFAULT_MIN_ACTIVE_REGIONS = 3;

/**
 * Aggregates sensor input (15-sensor snapshot or direct 4-region values)
 * into the 4 canonical product regions.
 * Distinguishes true measured zeros from missing, unmapped, or invalid regions.
 * 
 * @param {Object} sensorInput Map of 15 sensor IDs or 4 region names
 * @returns {Object} Aggregated regional representation
 */
function aggregateToFourRegions(sensorInput) {
  if (!sensorInput || typeof sensorInput !== 'object') {
    return {
      isLoaded: false,
      totalLoad: 0,
      activeRegionCount: 0,
      measuredRegionCount: 0,
      measuredRegions: [],
      activeRegions: [],
      missingRegions: [...PRODUCT_REGIONS],
      invalidRegions: [],
      regionalSums: { heel: null, arch: null, ball: null, toes: null },
      relativeLoads: { heel: null, arch: null, ball: null, toes: null },
      regionDetails: {}
    };
  }

  // Check if input uses direct 4-region keys (heel, arch, ball, toes)
  // Input is direct if at least one PRODUCT_REGION key is present and not matching 15-sensor IDs
  const directKeysPresent = PRODUCT_REGIONS.filter(r => r in sensorInput);
  const isDirectRegional = directKeysPresent.length > 0 && !('heel_center' in sensorInput);

  const regionalSums = {};
  const regionDetails = {};
  const measuredRegions = [];
  const activeRegions = [];
  const missingRegions = [];
  const invalidRegions = [];

  if (isDirectRegional) {
    PRODUCT_REGIONS.forEach((region) => {
      if (!(region in sensorInput) || sensorInput[region] === null || sensorInput[region] === undefined) {
        missingRegions.push(region);
        regionalSums[region] = null;
        regionDetails[region] = { status: 'missing', isMeasured: false, isZero: false, rawSum: null };
        return;
      }

      const raw = sensorInput[region];
      const val = typeof raw === 'number' ? raw : (raw && typeof raw.value === 'number' ? raw.value : null);

      if (val === null || typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
        invalidRegions.push(region);
        regionalSums[region] = null;
        regionDetails[region] = { status: 'invalid', isMeasured: false, isZero: false, rawSum: null };
        return;
      }

      // Valid finite measured value (could be a true zero: 0.0)
      const isZero = (val === 0 || Math.abs(val) < 1e-6);
      regionalSums[region] = Number(val.toFixed(4));
      measuredRegions.push(region);
      if (!isZero) activeRegions.push(region);

      regionDetails[region] = {
        status: 'measured',
        isMeasured: true,
        isZero,
        rawSum: regionalSums[region],
        contributingSensors: [region]
      };
    });
  } else {
    // Map from Phase 1 15-sensor layout
    PRODUCT_REGIONS.forEach((region) => {
      const sensorList = PHASE1_REGION_MAP[region];
      let sum = 0;
      let validSensorsInRegion = 0;
      const contributingSensors = [];

      sensorList.forEach((sensorId) => {
        if (!(sensorId in sensorInput) || sensorInput[sensorId] === null || sensorInput[sensorId] === undefined) {
          return;
        }

        const item = sensorInput[sensorId];
        let val = null;
        let hasSignal = true;

        if (typeof item === 'number') {
          if (Number.isFinite(item) && item >= 0) {
            val = Math.max(0, Math.min(1.0, item));
          }
        } else if (item && typeof item === 'object') {
          hasSignal = item.hasSignal !== false;
          const raw = typeof item.value === 'number' ? item.value : item.targetValue;
          if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
            val = Math.max(0, Math.min(1.0, raw));
          }
        }

        if (hasSignal && val !== null) {
          sum += val;
          validSensorsInRegion++;
          contributingSensors.push(sensorId);
        }
      });

      if (validSensorsInRegion === 0) {
        // No sensors in this region were measured or active
        missingRegions.push(region);
        regionalSums[region] = null;
        regionDetails[region] = { status: 'missing', isMeasured: false, isZero: false, rawSum: null };
      } else {
        const isZero = (sum < 1e-4);
        regionalSums[region] = Number(sum.toFixed(4));
        measuredRegions.push(region);
        if (!isZero) activeRegions.push(region);

        regionDetails[region] = {
          status: 'measured',
          isMeasured: true,
          isZero,
          rawSum: regionalSums[region],
          contributingSensors
        };
      }
    });
  }

  // Calculate total load strictly across measured regions
  const totalLoad = measuredRegions.reduce((accum, r) => accum + (regionalSums[r] || 0), 0);
  const isLoaded = totalLoad > 0.01;

  const relativeLoads = {};
  PRODUCT_REGIONS.forEach((region) => {
    if (regionDetails[region].isMeasured) {
      if (isLoaded) {
        relativeLoads[region] = Number((regionalSums[region] / totalLoad).toFixed(4));
      } else {
        relativeLoads[region] = 0.0; // Swing phase
      }
      regionDetails[region].relativeLoad = relativeLoads[region];
    } else {
      // Crucial: Missing regions are explicitly null, NEVER converted to 0.0
      relativeLoads[region] = null;
      regionDetails[region].relativeLoad = null;
    }
  });

  return {
    isLoaded,
    totalLoad: Number(totalLoad.toFixed(4)),
    activeRegionCount: activeRegions.length,
    measuredRegionCount: measuredRegions.length,
    measuredRegions: Object.freeze(measuredRegions),
    activeRegions: Object.freeze(activeRegions),
    missingRegions: Object.freeze(missingRegions),
    invalidRegions: Object.freeze(invalidRegions),
    regionalSums: Object.freeze(regionalSums),
    relativeLoads: Object.freeze(relativeLoads),
    regionDetails: Object.freeze(regionDetails)
  };
}

/**
 * Compares an incoming regional sensor snapshot against reference dataset records.
 * 
 * @param {Object} sensorInput 15-sensor snapshot or direct 4-region values
 * @param {Array<Object>} datasetRecords Array of shared dataset records
 * @param {Object} options
 * @param {string} options.policy 'all_four_required' (default) | 'shared_subset'
 * @param {number} options.minActiveRegions Minimum required active regions (default: 3)
 * @param {number} options.topK Number of top matches to return (default: 3)
 * @param {string} options.footFilter 'left' | 'right' | null
 * @returns {Object} Structured deterministic comparison results
 */
function compareRegionalSnapshot(sensorInput, datasetRecords = [], options = {}) {
  const policy = options.policy || COMPARISON_POLICIES.ALL_FOUR_REQUIRED;
  if (policy !== COMPARISON_POLICIES.ALL_FOUR_REQUIRED && policy !== COMPARISON_POLICIES.SHARED_SUBSET) {
    throw new Error(`Unknown comparison policy: '${policy}'. Supported policies: 'all_four_required', 'shared_subset'.`);
  }

  const minActiveRegions = options.minActiveRegions || DEFAULT_MIN_ACTIVE_REGIONS;
  const topK = options.topK || 3;
  const footFilter = options.footFilter || null;

  const aggregated = aggregateToFourRegions(sensorInput);

  // 1. Hardware Channel Reality Check
  // The current ESP32 firmware (esp32_velostat.ino) only reads a single ADC pin (GPIO32),
  // which maps to a single sensor location (e.g. heel_center).
  // A single physical channel cannot establish a 4-region planar pressure distribution.
  if (aggregated.measuredRegionCount === 1) {
    return {
      status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
      reason: 'Current hardware stream supplies only 1 physical sensor channel (GPIO32), but a 4-region planar comparison requires multi-channel measurements across at least 3 regions. Single-channel inputs cannot establish planar pressure distribution.',
      comparison_policy: policy,
      aggregated_input: aggregated,
      active_region_count: aggregated.activeRegionCount,
      measured_region_count: aggregated.measuredRegionCount,
      compared_regions: [],
      uncompared_regions: [...PRODUCT_REGIONS],
      matched_count: 0,
      matches: [],
      excluded_records_summary: { count: 0, reasons: [] }
    };
  }

  // 2. Unloaded foot (swing phase) check
  if (!aggregated.isLoaded) {
    return {
      status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
      reason: 'Sensor reading is unloaded (total load near zero). Foot is in swing or unweighted phase.',
      comparison_policy: policy,
      aggregated_input: aggregated,
      active_region_count: 0,
      measured_region_count: aggregated.measuredRegionCount,
      compared_regions: [],
      uncompared_regions: [...PRODUCT_REGIONS],
      matched_count: 0,
      matches: [],
      excluded_records_summary: { count: 0, reasons: [] }
    };
  }

  // 3. Policy-based check on incoming regions
  if (policy === COMPARISON_POLICIES.ALL_FOUR_REQUIRED) {
    if (aggregated.missingRegions.length > 0 || aggregated.invalidRegions.length > 0) {
      const missingList = [...aggregated.missingRegions, ...aggregated.invalidRegions];
      return {
        status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
        reason: `Missing required region(s) for 4-region comparison: [${missingList.join(', ')}]. Under 'all_four_required' policy, all four anatomical zones must be measured.`,
        comparison_policy: policy,
        aggregated_input: aggregated,
        active_region_count: aggregated.activeRegionCount,
        measured_region_count: aggregated.measuredRegionCount,
        compared_regions: [],
        uncompared_regions: missingList,
        matched_count: 0,
        matches: [],
        excluded_records_summary: { count: 0, reasons: [] }
      };
    }
  } else if (policy === COMPARISON_POLICIES.SHARED_SUBSET) {
    if (aggregated.measuredRegionCount < minActiveRegions) {
      return {
        status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
        reason: `Insufficient measured regions (${aggregated.measuredRegionCount} measured; minimum required: ${minActiveRegions}) under 'shared_subset' policy.`,
        comparison_policy: policy,
        aggregated_input: aggregated,
        active_region_count: aggregated.activeRegionCount,
        measured_region_count: aggregated.measuredRegionCount,
        compared_regions: [],
        uncompared_regions: aggregated.missingRegions,
        matched_count: 0,
        matches: [],
        excluded_records_summary: { count: 0, reasons: [] }
      };
    }
  }

  // 4. Strict Candidate Reference Record Validation
  const candidateRecords = Array.isArray(datasetRecords) ? datasetRecords : [];
  const scoredRecords = [];
  const excludedSummary = {
    total_candidate_count: candidateRecords.length,
    unmapped_count: 0,
    not_comparable_count: 0,
    quarantined_count: 0,
    invalid_status_count: 0,
    incompatible_units_count: 0,
    invalid_values_count: 0,
    missing_regional_values_count: 0,
    foot_mismatch_count: 0,
    insufficient_shared_regions_count: 0,
    reasons: []
  };

  candidateRecords.forEach((record) => {
    const recId = record.source_record_id || 'unknown_record';

    // A. Status validation: MUST be exactly 'accepted'
    if (record.status !== ADAPTER_STATUS.ACCEPTED) {
      let category = 'invalid_status_count';
      if (record.status === ADAPTER_STATUS.NEEDS_MAPPING) {
        excludedSummary.unmapped_count++;
        category = 'needs_mapping';
      } else if (record.status === ADAPTER_STATUS.NOT_COMPARABLE) {
        excludedSummary.not_comparable_count++;
        category = 'not_comparable';
      } else if (record.status === ADAPTER_STATUS.QUARANTINED || record.status === ADAPTER_STATUS.UNSUPPORTED) {
        excludedSummary.quarantined_count++;
        category = 'quarantined';
      } else {
        excludedSummary.invalid_status_count++;
        category = 'unsupported_status';
      }

      excludedSummary.reasons.push({
        source_record_id: recId,
        category,
        reason: `Record status '${record.status}' is not '${ADAPTER_STATUS.ACCEPTED}'`
      });
      return;
    }

    // B. Foot filter validation
    if (footFilter && record.foot && record.foot !== 'unspecified' && record.foot !== footFilter) {
      excludedSummary.foot_mismatch_count++;
      excludedSummary.reasons.push({
        source_record_id: recId,
        category: 'foot_mismatch',
        reason: `Foot mismatch: requested '${footFilter}', record has '${record.foot}'`
      });
      return;
    }

    // C. Units validation: MUST be 'relative_load_pct'
    if (record.regional_units !== 'relative_load_pct') {
      excludedSummary.incompatible_units_count++;
      excludedSummary.reasons.push({
        source_record_id: recId,
        category: 'incompatible_units',
        reason: `Incompatible units: expected 'relative_load_pct', found '${record.regional_units || 'undefined'}'`
      });
      return;
    }

    // D. Regional values presence validation
    if (!record.regional_values || typeof record.regional_values !== 'object') {
      excludedSummary.missing_regional_values_count++;
      excludedSummary.reasons.push({
        source_record_id: recId,
        category: 'missing_regional_values',
        reason: 'Missing regional_values object on reference record'
      });
      return;
    }

    const recRegions = record.regional_values;

    // E. Numeric and range validation on reference values
    let recordHasInvalidValue = false;
    let invalidValReason = '';
    const validRecRegions = [];

    PRODUCT_REGIONS.forEach((region) => {
      if (region in recRegions) {
        const v = recRegions[region];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          recordHasInvalidValue = true;
          invalidValReason = `Non-finite numeric value in region '${region}': ${v}`;
        } else if (v < 0.0 || v > 1.0) {
          recordHasInvalidValue = true;
          invalidValReason = `Value out of range [0.0, 1.0] in region '${region}': ${v}`;
        } else {
          validRecRegions.push(region);
        }
      }
    });

    if (recordHasInvalidValue) {
      excludedSummary.invalid_values_count++;
      excludedSummary.reasons.push({
        source_record_id: recId,
        category: 'invalid_values',
        reason: invalidValReason
      });
      return;
    }

    // F. Policy-specific region matching
    let comparedRegions = [];
    let uncomparedRegions = [];

    if (policy === COMPARISON_POLICIES.ALL_FOUR_REQUIRED) {
      if (validRecRegions.length !== PRODUCT_REGIONS.length) {
        const missingInRec = PRODUCT_REGIONS.filter(r => !validRecRegions.includes(r));
        excludedSummary.missing_regional_values_count++;
        excludedSummary.reasons.push({
          source_record_id: recId,
          category: 'missing_regions',
          reason: `Reference record missing required region(s): [${missingInRec.join(', ')}] under 'all_four_required'`
        });
        return;
      }
      comparedRegions = [...PRODUCT_REGIONS];
      uncomparedRegions = [];
    } else {
      // Shared subset policy: intersection of input measured regions and valid reference regions
      comparedRegions = aggregated.measuredRegions.filter(r => validRecRegions.includes(r));
      uncomparedRegions = PRODUCT_REGIONS.filter(r => !comparedRegions.includes(r));

      if (comparedRegions.length < minActiveRegions) {
        excludedSummary.insufficient_shared_regions_count++;
        excludedSummary.reasons.push({
          source_record_id: recId,
          category: 'insufficient_shared_regions',
          reason: `Insufficient shared regions between input and reference (${comparedRegions.length} shared; minimum required: ${minActiveRegions})`
        });
        return;
      }
    }

    // G. Compute Root Mean Square Deviation (RMSD) on the exact compared subset
    // Renormalize over the compared subset on both sides to ensure an identical mathematical basis
    const inputSubsetSum = comparedRegions.reduce((sum, r) => sum + (aggregated.relativeLoads[r] || 0), 0);
    const recSubsetSum = comparedRegions.reduce((sum, r) => sum + (recRegions[r] || 0), 0);

    if (inputSubsetSum < 1e-4 || recSubsetSum < 1e-4) {
      return; // Skip unloaded comparisons
    }

    let sumSquaredDiff = 0;
    const regionalDeltas = {};
    PRODUCT_REGIONS.forEach((r) => {
      if (comparedRegions.includes(r)) {
        // Renormalized relative loads over shared subset
        const inVal = aggregated.relativeLoads[r] / inputSubsetSum;
        const refVal = recRegions[r] / recSubsetSum;
        const delta = inVal - refVal;
        sumSquaredDiff += delta * delta;
        regionalDeltas[r] = Number(delta.toFixed(4));
      } else {
        regionalDeltas[r] = null; // Uncompared region is explicitly null
      }
    });

    const rmsd = Math.sqrt(sumSquaredDiff / comparedRegions.length);
    const similarity = Math.max(0, 1 - rmsd);

    scoredRecords.push({
      source_record_id: recId,
      source_dataset: record.source_dataset,
      source_version: record.source_version,
      foot: record.foot,
      timestamp_sec: record.timestamp_sec,
      similarity_score: Number(similarity.toFixed(4)),
      rmsd_distance: Number(rmsd.toFixed(4)),
      compared_region_count: comparedRegions.length,
      compared_regions: Object.freeze(comparedRegions),
      uncompared_regions: Object.freeze(uncomparedRegions),
      shared_region_coverage: Number((comparedRegions.length / PRODUCT_REGIONS.length).toFixed(2)),
      regional_deltas: Object.freeze(regionalDeltas),
      reference_regional_values: record.regional_values,
      reference_regional_units: record.regional_units,
      provenance: record.provenance,
      contributing_sensor_ids: record.contributing_sensor_ids || null
    });
  });

  if (scoredRecords.length === 0) {
    return {
      status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
      reason: 'No eligible reference records passed status, unit, range, and regional coverage filters for comparison.',
      comparison_policy: policy,
      aggregated_input: aggregated,
      active_region_count: aggregated.activeRegionCount,
      measured_region_count: aggregated.measuredRegionCount,
      compared_regions: [],
      uncompared_regions: [...PRODUCT_REGIONS],
      matched_count: 0,
      matches: [],
      excluded_records_summary: excludedSummary
    };
  }

  // Deterministic sorting:
  // 1. similarity_score descending
  // 2. rmsd_distance ascending
  // 3. source_record_id ascending (lexicographical tie-breaker)
  scoredRecords.sort((a, b) => {
    if (b.similarity_score !== a.similarity_score) {
      return b.similarity_score - a.similarity_score;
    }
    if (a.rmsd_distance !== b.rmsd_distance) {
      return a.rmsd_distance - b.rmsd_distance;
    }
    return a.source_record_id.localeCompare(b.source_record_id);
  });

  const topMatches = scoredRecords.slice(0, topK);

  return {
    status: ANALYSIS_STATUS.OK,
    comparison_method: `Four-region relative load Root Mean Squared Deviation (${policy})`,
    comparison_policy: policy,
    aggregated_input: aggregated,
    active_region_count: aggregated.activeRegionCount,
    measured_region_count: aggregated.measuredRegionCount,
    compared_regions: topMatches[0].compared_regions,
    uncompared_regions: topMatches[0].uncompared_regions,
    shared_region_coverage: topMatches[0].shared_region_coverage,
    matched_count: topMatches.length,
    matches: Object.freeze(topMatches),
    excluded_records_summary: excludedSummary
  };
}

module.exports = {
  COMPARISON_POLICIES,
  PHASE1_REGION_MAP,
  DEFAULT_MIN_ACTIVE_REGIONS,
  aggregateToFourRegions,
  compareRegionalSnapshot
};
