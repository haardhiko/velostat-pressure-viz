/**
 * Test Suite for Phase 2 Reference Dataset Adapters, 4-Region Comparator & NVIDIA NIM Adapter.
 * Uses synthetic fixtures to verify ingestion, error quarantine, provenance tracking,
 * unit preservation, comparability boundaries, and credential security.
 */

const assert = require('assert');
const {
  ADAPTER_STATUS,
  PRODUCT_REGIONS,
  COMPARISON_POLICIES,
  ParkinsonsVgrfAdapter,
  SENSOR_COORDINATES,
  GaitRiteInsoleAdapter,
  FsrMatrixAdapter,
  NeurodegenerativeDbAdapter,
  decodeFormat212,
  aggregateToFourRegions,
  compareRegionalSnapshot,
  BaseNIMAdapter,
  ServerEnvNIMAdapter,
  TestMockNIMAdapter,
  validateAndSanitizeNIMOutput,
  ANALYSIS_STATUS,
  CLINICAL_DISCLAIMER
} = require('../src/analysis/index');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

async function runTestAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

async function main() {
  console.log('============================================================');
  console.log(' Phase 2: Dataset Adapters & 4-Region Analysis Test Suite   ');
  console.log('============================================================\n');

  // =========================================================================
  // Suite 1: Parkinson's VGRF Dataset Adapter
  // =========================================================================
  console.log('Suite 1: Parkinson\'s VGRF Dataset Adapter');

  const parkinsonsAdapter = new ParkinsonsVgrfAdapter();

  // Synthetic 19-column fixture (Time, 8 L-sensors, 8 R-sensors, Total L, Total R)
  // Row 1: Left Heel Strike (L1=200, L2=150, L3=150 => Heel=500N; Total=500N)
  // Row 2: Right Midstance / Ball (R6=300, R7=200 => Ball=500N; Total=500N)
  // Row 3: Unloaded swing phase (all 0s)
  const syntheticVgrfContent = [
    '0.0100 200.0 150.0 150.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 500.0 0.0',
    '0.0200 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 300.0 200.0 0.0 0.0 500.0',
    '0.0300 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0 0.0',
    '0.0400 100.0 50.0' // Malformed row (too few columns)
  ].join('\n');

  runTest('Parkinson VGRF: Parse 19 columns, preserve 100Hz and Newtons', () => {
    const res = parkinsonsAdapter.parse(syntheticVgrfContent, {
      archive: 'gait-in-parkinsons-disease-1.0.0.zip',
      source_file: 'test_pt01.txt'
    });

    assert.strictEqual(res.accepted_count_per_foot, 3);
    assert.strictEqual(res.quarantined_count, 1);
    assert.strictEqual(res.left_foot_records.length, 3);
    assert.strictEqual(res.right_foot_records.length, 3);

    // Verify Row 0 Left foot (Heel Strike)
    const recL = res.left_foot_records[0];
    assert.strictEqual(recL.foot, 'left');
    assert.strictEqual(recL.original_units, 'N'); // Raw force retained in Newtons
    assert.strictEqual(recL.sample_rate_hz, 100);
    assert.strictEqual(recL.status, ADAPTER_STATUS.ACCEPTED);
    assert.strictEqual(recL.regional_values.heel, 1.0); // 500N / 500N relative load
    assert.strictEqual(recL.regional_values.arch, 0.0);
    assert.strictEqual(recL.regional_values.ball, 0.0);
    assert.strictEqual(recL.regional_values.toes, 0.0);
    assert.strictEqual(recL.provenance.archive, 'gait-in-parkinsons-disease-1.0.0.zip');
    assert.strictEqual(recL.provenance.source_file, 'test_pt01.txt');
  });

  runTest('Parkinson VGRF: Accurately labels mapping as coordinate heuristic', () => {
    const res = parkinsonsAdapter.parse(syntheticVgrfContent, { source_file: 'test_pt01.txt' });
    const recL = res.left_foot_records[0];
    assert.strictEqual(recL.mapping_method, 'project_coordinate_heuristic_infotronic');
    assert(recL.provenance.notes.includes('project-defined coordinate heuristic'));
    assert(recL.provenance.notes.includes('distinct from physical pressure'));

    // Verify coordinate thresholds
    assert.strictEqual(SENSOR_COORDINATES.L1.region, 'heel'); // Y = -800
    assert.strictEqual(SENSOR_COORDINATES.L4.region, 'arch'); // Y = 0
    assert.strictEqual(SENSOR_COORDINATES.L6.region, 'ball'); // Y = 400
    assert.strictEqual(SENSOR_COORDINATES.L8.region, 'toes'); // Y = 800
  });

  runTest('Parkinson VGRF: Keeps left and right feet separate', () => {
    const res = parkinsonsAdapter.parse(syntheticVgrfContent, { source_file: 'test_pt01.txt' });
    const recL = res.left_foot_records[1]; // Left foot at t=0.02 has 0N
    const recR = res.right_foot_records[1]; // Right foot at t=0.02 has 500N (ball)
    assert.strictEqual(recL.foot, 'left');
    assert.strictEqual(recR.foot, 'right');
    assert.strictEqual(recL.regional_values.ball, 0.0);
    assert.strictEqual(recR.regional_values.ball, 1.0);
  });

  runTest('Parkinson VGRF: Unloaded swing phase handled without zero-division', () => {
    const res = parkinsonsAdapter.parse(syntheticVgrfContent, { source_file: 'test_pt01.txt' });
    const unloadedRec = res.left_foot_records[2]; // Row 2 is all 0s
    assert.strictEqual(unloadedRec.regional_values.heel, 0.0);
    assert.strictEqual(unloadedRec.regional_values.ball, 0.0);
    assert(unloadedRec.reasons.some(r => r.includes('Unloaded swing phase')));
  });

  runTest('Parkinson VGRF: Quarantines malformed row with informative reason', () => {
    const res = parkinsonsAdapter.parse(syntheticVgrfContent, { source_file: 'test_pt01.txt' });
    assert.strictEqual(res.quarantined_records.length, 1);
    assert(res.quarantined_records[0].reason.includes('Invalid column count: expected 19'));
  });

  // =========================================================================
  // Suite 2: GaitRite Insole Dataset Adapter
  // =========================================================================
  console.log('\nSuite 2: GaitRite Insole Dataset Adapter');

  const gaitriteAdapter = new GaitRiteInsoleAdapter();

  const syntheticInsoleCsv = [
    ['AccelerometerX', 'copX', 'copY', 'sumP', ...Array.from({ length: 32 }, (_, i) => `PressureSensor ${i}`)].join(','),
    ['0.1', '12.5', '45.2', '1250', ...Array.from({ length: 32 }, () => '39')].join(','),
    ['0.2', '13.0', '46.0', '1300', ...Array.from({ length: 31 }, () => '40'), 'INVALID_NUMBER'].join(',')
  ].join('\n');

  runTest('GaitRite Insole: Ingests 32 sensors and marks as needs_mapping', () => {
    const res = gaitriteAdapter.parseInsoleCsv(syntheticInsoleCsv, {
      foot: 'left',
      provenance: { source_file: 'L.csv' }
    });

    assert.strictEqual(res.accepted_count, 1);
    assert.strictEqual(res.quarantined_count, 1);
    assert.strictEqual(res.status, ADAPTER_STATUS.NEEDS_MAPPING);

    const rec = res.records[0];
    assert.strictEqual(rec.status, ADAPTER_STATUS.NEEDS_MAPPING);
    assert.strictEqual(rec.mapping_coverage, 0.0);
    assert.strictEqual(rec.regional_values, null); // Refused arbitrary spatial mapping
    assert.strictEqual(rec.original_values['PressureSensor 0'], 39);
    assert.strictEqual(rec.original_values['PressureSensor 31'], 39);
    assert(rec.reasons.some(r => r.includes('Spatial coordinate layout')));
  });

  runTest('GaitRite Insole: GaitRite test events marked not_comparable for pressure', () => {
    const eventCsv = 'Item;Time;Foot;Event\n1;0.54;L;Heel_On\n2;0.82;L;Toe_Off';
    const res = gaitriteAdapter.parseGaitriteTestCsv(eventCsv);
    assert.strictEqual(res.events.length, 2);
    assert.strictEqual(res.status, ADAPTER_STATUS.NOT_COMPARABLE);
    assert(res.reasons.some(r => r.includes('temporal-spatial gait parameters')));
  });

  runTest('GaitRite Insole: Parses sync_auto.json', () => {
    const syncJson = JSON.stringify({ insole_offset_sec: 0.125, mat_offset_sec: 0.0 });
    const res = gaitriteAdapter.parseSyncJson(syncJson);
    assert.strictEqual(res.status, ADAPTER_STATUS.ACCEPTED);
    assert.strictEqual(res.sync_offsets.insole_offset_sec, 0.125);
  });

  // =========================================================================
  // Suite 3: FSR Matrix Dataset Adapter
  // =========================================================================
  console.log('\nSuite 3: FSR Matrix Dataset Adapter');

  const fsrAdapter = new FsrMatrixAdapter();

  const syntheticFsrCsv = [
    ',MAP__15_03_2024__14_20_10,,,,',
    '3.91,Rectus,2.52,Rectus',
    'INTERPOLATIONS,,,,',
    '10.2, 12.4, 15.1, 8.0',
    '11.0, 14.2, 16.5, 9.1',
    '9.5,  11.8, 13.9, 7.8'
  ].join('\n');

  runTest('FSR Matrix: Preserves complete 2D matrix losslessly', () => {
    const res = fsrAdapter.parse(syntheticFsrCsv, {
      archive: '15257837.zip',
      source_file: 'rectus_sample.csv'
    });

    assert.strictEqual(res.accepted_count, 1);
    assert.strictEqual(res.grid_dimensions[0], 3);
    assert.strictEqual(res.grid_dimensions[1], 4);
    assert.strictEqual(res.status, ADAPTER_STATUS.NEEDS_MAPPING);

    // Verify complete matrix preserved losslessly (all 3 rows, not sliced to 2)
    assert.strictEqual(res.matrix.length, 3);
    assert.strictEqual(res.matrix[0].length, 4);
    assert.strictEqual(res.matrix[0][0], 10.2);
    assert.strictEqual(res.matrix[2][3], 7.8);

    const rec = res.records[0];
    assert.strictEqual(rec.original_values.matrix.length, 3);
    assert.strictEqual(rec.regional_values, null); // Comparison withheld
  });

  runTest('FSR Matrix: Quarantines empty cells without shifting column positions', () => {
    const emptyCellCsv = [
      ',MAP__test,,,,',
      'meta,1,2',
      'INTERPOLATIONS',
      '1.0, 2.0, 3.0, 4.0',
      '1.0,    , 3.0, 4.0' // Empty cell in column 1
    ].join('\n');

    const res = fsrAdapter.parse(emptyCellCsv);
    assert.strictEqual(res.accepted_count, 0);
    assert.strictEqual(res.quarantined_count, 1);
    assert(res.quarantined_rows[0].reason.includes('Empty cell detected at column 1'));
  });

  runTest('FSR Matrix: Quarantines ragged rows in matrix grid', () => {
    const raggedCsv = [
      ',MAP__test,,,,',
      'meta,1,2',
      'INTERPOLATIONS',
      '1.0, 2.0, 3.0',
      '1.0, 2.0' // Ragged: 2 cols instead of 3
    ].join('\n');

    const res = fsrAdapter.parse(raggedCsv);
    assert.strictEqual(res.quarantined_count, 1);
    assert.strictEqual(res.accepted_count, 0);
  });

  // =========================================================================
  // Suite 4: Neurodegenerative Disease Database Adapter (Format 212 WFDB)
  // =========================================================================
  console.log('\nSuite 4: Neurodegenerative DB WFDB Format 212 Adapter');

  const neuroAdapter = new NeurodegenerativeDbAdapter();

  runTest('Neurodegenerative DB: Decodes Format 212 12-bit binary buffer', () => {
    const buf = Buffer.from([0x23, 0xa1, 0xbc]);
    const samples = decodeFormat212(buf);

    assert.strictEqual(samples.length, 2);
    assert.strictEqual(samples[0], 291);
    assert.strictEqual(samples[1], -1348);
  });

  runTest('Neurodegenerative DB: Signal file marked not_comparable for 4-region distribution', () => {
    const buf = Buffer.from([0x23, 0xa1, 0xbc, 0x00, 0x00, 0x00]);
    const res = neuroAdapter.parseSignal(buf, { foot: 'left', sampleRateHz: 300 });

    assert.strictEqual(res.status, ADAPTER_STATUS.NOT_COMPARABLE);
    assert.strictEqual(res.sample_count, 4);
    assert.strictEqual(res.record.status, ADAPTER_STATUS.NOT_COMPARABLE);
    assert.strictEqual(res.record.regional_values, null); // Withheld
    assert(res.record.reasons.some(r => r.includes('single aggregated vertical ground reaction force')));
  });

  runTest('Neurodegenerative DB: Parses 13-column stride time series (.ts)', () => {
    const tsContent = '0.00 1.05 1.04 0.40 0.39 38.1 37.5 0.65 0.65 61.9 62.5 0.25 24.0';
    const res = neuroAdapter.parseStrideTimeSeries(tsContent);
    assert.strictEqual(res.total_strides, 1);
    assert.strictEqual(res.status, ADAPTER_STATUS.NOT_COMPARABLE);
    assert.strictEqual(res.records[0].original_values.left_stride_interval_sec, 1.05);
  });

  // =========================================================================
  // Suite 5: Four-Region Deterministic Comparator
  // =========================================================================
  console.log('\nSuite 5: Four-Region Deterministic Comparator');

  // Reference dataset records
  const canonicalRecords = [
    // Valid Record A: Heel Strike
    {
      source_dataset: 'gait-in-parkinsons-disease',
      source_version: '1.0.0',
      source_record_id: 'REC_PARK_HEEL_STRIKE',
      foot: 'right',
      status: ADAPTER_STATUS.ACCEPTED,
      regional_values: { heel: 0.90, arch: 0.05, ball: 0.05, toes: 0.0 },
      regional_units: 'relative_load_pct',
      provenance: { source_file: 'pt01.txt' }
    },
    // Valid Record B: Balanced Midstance
    {
      source_dataset: 'gait-in-parkinsons-disease',
      source_version: '1.0.0',
      source_record_id: 'REC_PARK_MIDSTANCE',
      foot: 'right',
      status: ADAPTER_STATUS.ACCEPTED,
      regional_values: { heel: 0.30, arch: 0.15, ball: 0.40, toes: 0.15 },
      regional_units: 'relative_load_pct',
      provenance: { source_file: 'pt02.txt' }
    },
    // Record C: Invalid status (misspelled / uppercase)
    {
      source_dataset: 'gait-in-parkinsons-disease',
      source_record_id: 'REC_BAD_STATUS_UPPER',
      status: 'ACCEPTED', // Misspelled uppercase!
      regional_values: { heel: 0.90, arch: 0.05, ball: 0.05, toes: 0.0 },
      regional_units: 'relative_load_pct'
    },
    // Record D: Unknown status
    {
      source_dataset: 'gait-in-parkinsons-disease',
      source_record_id: 'REC_BAD_STATUS_UNKNOWN',
      status: 'pending_review',
      regional_values: { heel: 0.90, arch: 0.05, ball: 0.05, toes: 0.0 },
      regional_units: 'relative_load_pct'
    },
    // Record E: Incompatible units (Newtons instead of relative_load_pct)
    {
      source_dataset: 'gait-in-parkinsons-disease',
      source_record_id: 'REC_BAD_UNIT_NEWTONS',
      status: ADAPTER_STATUS.ACCEPTED,
      regional_values: { heel: 450, arch: 25, ball: 25, toes: 0 },
      regional_units: 'N' // Incompatible!
    },
    // Record F: Out of range values (relative load > 1.0)
    {
      source_dataset: 'gait-in-parkinsons-disease',
      source_record_id: 'REC_OUT_OF_RANGE',
      status: ADAPTER_STATUS.ACCEPTED,
      regional_values: { heel: 1.5, arch: 0.05, ball: 0.05, toes: 0.0 }, // 1.5 > 1.0!
      regional_units: 'relative_load_pct'
    },
    // Record G: Non-finite value (NaN)
    {
      source_dataset: 'gait-in-parkinsons-disease',
      source_record_id: 'REC_NAN_VALUE',
      status: ADAPTER_STATUS.ACCEPTED,
      regional_values: { heel: NaN, arch: 0.05, ball: 0.05, toes: 0.0 },
      regional_units: 'relative_load_pct'
    },
    // Record H: Needs mapping (GaitRite)
    {
      source_dataset: 'insole-gaitrite-dataset',
      source_record_id: 'REC_GAITRITE_UNMAPPED',
      status: ADAPTER_STATUS.NEEDS_MAPPING,
      regional_values: null,
      regional_units: null
    }
  ];

  runTest('4-Region Comparator: Rejects unknown, missing, and misspelled statuses strictly', () => {
    const heelInput = { heel: 0.85, arch: 0.05, ball: 0.10, toes: 0.0 };
    const res = compareRegionalSnapshot(heelInput, canonicalRecords);

    assert.strictEqual(res.status, ANALYSIS_STATUS.OK);
    // Only valid records A and B should be matched
    const matchedIds = res.matches.map(m => m.source_record_id);
    assert(matchedIds.includes('REC_PARK_HEEL_STRIKE'));
    assert(matchedIds.includes('REC_PARK_MIDSTANCE'));
    assert(!matchedIds.includes('REC_BAD_STATUS_UPPER'));
    assert(!matchedIds.includes('REC_BAD_STATUS_UNKNOWN'));

    // Excluded summary tracks invalid status reasons
    assert.strictEqual(res.excluded_records_summary.invalid_status_count, 2);
    assert(res.excluded_records_summary.reasons.some(r => r.source_record_id === 'REC_BAD_STATUS_UPPER'));
    assert(res.excluded_records_summary.reasons.some(r => r.source_record_id === 'REC_BAD_STATUS_UNKNOWN'));
  });

  runTest('4-Region Comparator: Validates finite values, ranges, and compatible units', () => {
    const heelInput = { heel: 0.85, arch: 0.05, ball: 0.10, toes: 0.0 };
    const res = compareRegionalSnapshot(heelInput, canonicalRecords);

    const matchedIds = res.matches.map(m => m.source_record_id);
    assert(!matchedIds.includes('REC_BAD_UNIT_NEWTONS'));
    assert(!matchedIds.includes('REC_OUT_OF_RANGE'));
    assert(!matchedIds.includes('REC_NAN_VALUE'));

    assert.strictEqual(res.excluded_records_summary.incompatible_units_count, 1);
    assert.strictEqual(res.excluded_records_summary.invalid_values_count, 2); // 1.5 and NaN
  });

  runTest('4-Region Comparator: Distinguishes measured zero from missing region', () => {
    // Input 1: All 4 regions measured, with toes being a true measured zero
    const trueZeroInput = { heel: 0.80, arch: 0.10, ball: 0.10, toes: 0.0 };
    const aggZero = aggregateToFourRegions(trueZeroInput);
    assert.strictEqual(aggZero.measuredRegionCount, 4);
    assert.strictEqual(aggZero.missingRegions.length, 0);
    assert.strictEqual(aggZero.relativeLoads.toes, 0.0);
    assert.strictEqual(aggZero.regionDetails.toes.isZero, true);
    assert.strictEqual(aggZero.regionDetails.toes.isMeasured, true);

    // Input 2: 3 regions measured, toes is MISSING
    const missingToesInput = { heel: 0.80, arch: 0.10, ball: 0.10 };
    const aggMissing = aggregateToFourRegions(missingToesInput);
    assert.strictEqual(aggMissing.measuredRegionCount, 3);
    assert.strictEqual(aggMissing.missingRegions.length, 1);
    assert.strictEqual(aggMissing.missingRegions[0], 'toes');
    assert.strictEqual(aggMissing.relativeLoads.toes, null); // NOT converted to zero!
    assert.strictEqual(aggMissing.regionDetails.toes.isMeasured, false);
  });

  runTest('4-Region Comparator: all_four_required policy rejects 3 regions + 1 missing', () => {
    const missingToesInput = { heel: 0.80, arch: 0.10, ball: 0.10 };
    const res = compareRegionalSnapshot(missingToesInput, canonicalRecords, {
      policy: COMPARISON_POLICIES.ALL_FOUR_REQUIRED
    });

    assert.strictEqual(res.status, ANALYSIS_STATUS.INSUFFICIENT_DATA);
    assert(res.reason.includes('Missing required region(s) for 4-region comparison: [toes]'));
    assert.strictEqual(res.matched_count, 0);
  });

  runTest('4-Region Comparator: shared_subset policy compares shared regions and reports coverage', () => {
    const missingToesInput = { heel: 0.80, arch: 0.10, ball: 0.10 };
    const res = compareRegionalSnapshot(missingToesInput, canonicalRecords, {
      policy: COMPARISON_POLICIES.SHARED_SUBSET,
      minActiveRegions: 3
    });

    assert.strictEqual(res.status, ANALYSIS_STATUS.OK);
    assert.strictEqual(res.comparison_policy, 'shared_subset');
    assert.deepStrictEqual(res.compared_regions, ['heel', 'arch', 'ball']);
    assert.deepStrictEqual(res.uncompared_regions, ['toes']);
    assert.strictEqual(res.shared_region_coverage, 0.75); // 3 of 4 regions
    assert.strictEqual(res.matches[0].regional_deltas.toes, null); // Uncompared region delta is null
  });

  runTest('4-Region Comparator: Hardware reconciliation reports single-channel reality', () => {
    // Current ESP32 firmware reads only GPIO32 (1 channel mapped to heel)
    const singleChannelHw = { heel_center: 0.85 }; // only heel mapped
    const res = compareRegionalSnapshot(singleChannelHw, canonicalRecords);

    assert.strictEqual(res.status, ANALYSIS_STATUS.INSUFFICIENT_DATA);
    assert(res.reason.includes('Current hardware stream supplies only 1 physical sensor channel (GPIO32)'));
  });

  // =========================================================================
  // Suite 6: NVIDIA NIM Adapter & Secret Isolation
  // =========================================================================
  console.log('\nSuite 6: NVIDIA NIM Adapter & Secret Isolation');

  await runTestAsync('NIM Adapter: Credentials isolated and not exposed in properties or JSON', async () => {
    process.env.NVIDIA_NIM_API_KEY = 'nvapi-secret-key-12345-do-not-leak';
    const nimAdapter = new ServerEnvNIMAdapter();

    assert.strictEqual(nimAdapter.hasCredentials(), true);

    // Verify key is not in enumerable keys or string serialization
    const keys = Object.keys(nimAdapter);
    assert(!keys.includes('apiKey'));
    assert(!keys.includes('NVIDIA_NIM_API_KEY'));

    const jsonStr = JSON.stringify(nimAdapter);
    assert(!jsonStr.includes('nvapi-secret-key-12345-do-not-leak'));

    delete process.env.NVIDIA_NIM_API_KEY;
  });

  await runTestAsync('NIM Adapter: ServerEnvNIMAdapter functions as Phase 2 secure stub (no live calls)', async () => {
    process.env.NVIDIA_NIM_API_KEY = 'nvapi-dummy-key';
    const nimAdapter = new ServerEnvNIMAdapter();

    const comparisonEvidence = {
      status: ANALYSIS_STATUS.OK,
      matches: [{ source_record_id: 'REC_PARK_01', similarity_score: 0.92, rmsd_distance: 0.08 }]
    };

    // Even with key configured, it returns deterministic fallback stub output in Phase 2
    const res = await nimAdapter.generateAnalysis({ sensorSummary: {}, comparisonEvidence });
    assert.strictEqual(res.is_fallback, true);
    assert(res.fallback_reason.includes('Phase 2 secure stub: deterministic fallback active'));

    delete process.env.NVIDIA_NIM_API_KEY;
  });

  await runTestAsync('NIM Adapter: Safe fallback returned when key is absent', async () => {
    delete process.env.NVIDIA_NIM_API_KEY;
    delete process.env.NVIDIA_API_KEY;

    const nimAdapter = new ServerEnvNIMAdapter();
    const comparisonEvidence = {
      status: ANALYSIS_STATUS.OK,
      matches: [{ source_record_id: 'REC_PARK_01', similarity_score: 0.92, rmsd_distance: 0.08 }]
    };

    const res = await nimAdapter.generateAnalysis({ sensorSummary: {}, comparisonEvidence });
    assert.strictEqual(res.is_fallback, true);
    assert(res.fallback_reason.includes('No NVIDIA NIM API key configured'));
  });

  await runTestAsync('NIM Adapter: Strict citation validation rejects hallucinated record IDs', async () => {
    const mockNim = new TestMockNIMAdapter({ mode: 'hallucinate_citation' });
    const comparisonEvidence = {
      status: ANALYSIS_STATUS.OK,
      active_regions: ['heel', 'arch', 'ball', 'toes'],
      matches: [{ source_record_id: 'REC_VALID_01', similarity_score: 0.88, rmsd_distance: 0.12 }]
    };

    const res = await mockNim.generateAnalysis({ sensorSummary: {}, comparisonEvidence });
    assert.strictEqual(res.rejected_citations_count, 1);
    assert(!res.cited_record_ids.includes('NIM-FABRICATED-REC-404'));
    assert(res.cited_record_ids.includes('REC_VALID_01'));
    assert(res.uncertainty_limitations.some(l => l.includes('Disallowed by strict provenance validator')));
    assert.strictEqual(res.disclaimer, CLINICAL_DISCLAIMER);
  });

  await runTestAsync('NIM Adapter: Valid output generated with matching citations', async () => {
    const mockNim = new TestMockNIMAdapter({ mode: 'valid' });
    const comparisonEvidence = {
      status: ANALYSIS_STATUS.OK,
      active_regions: ['heel', 'arch', 'ball', 'toes'],
      matches: [{ source_record_id: 'REC_VALID_01', similarity_score: 0.94, rmsd_distance: 0.06 }]
    };

    const res = await mockNim.generateAnalysis({ sensorSummary: {}, comparisonEvidence });
    assert.strictEqual(res.status, ANALYSIS_STATUS.OK);
    assert.strictEqual(res.is_fallback, false);
    assert.strictEqual(res.cited_record_ids[0], 'REC_VALID_01');
    assert.strictEqual(res.model_name, 'meta/llama-3.1-70b-instruct');
    assert(res.evidence_based_observations.length > 0);
  });

  // =========================================================================
  // Test Summary
  // =========================================================================
  console.log('\n============================================================');
  console.log(` Test Summary: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('============================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
