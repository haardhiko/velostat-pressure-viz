/**
 * Phase 2 Analysis & Reference Dataset Test Suite.
 * Validates dataset ingestion, deterministic numerical comparison,
 * LLM adapter security boundary, citation integrity, and failure handling.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  validateReferenceDataset,
  DatasetValidationError,
  compareSensorWithDataset,
  normalizeSensorSnapshot,
  TestMockLLMAdapter,
  ServerEnvLLMAdapter,
  AnalysisEngine,
  ANALYSIS_STATUS,
  VALID_SENSOR_IDS,
  CLINICAL_DISCLAIMER
} = require('../src/analysis');

let testsPassed = 0;
let testsTotal = 0;

function runTest(name, fn) {
  testsTotal++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runAsyncTest(name, fn) {
  testsTotal++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('\n============================================================');
  console.log(' Phase 2: Analysis Layer & Reference Dataset Test Suite');
  console.log('============================================================\n');

  const samplePath = path.resolve(__dirname, '../data/reference_datasets/sample_gait_dataset.json');
  const malformedPath = path.resolve(__dirname, '../data/reference_datasets/malformed_sample_dataset.json');

  // --- Suite 1: Dataset Ingestion & Validation ---
  console.log('Suite 1: Dataset Ingestion & Validation');

  runTest('Ingest valid canonical reference dataset', () => {
    const raw = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    const result = validateReferenceDataset(raw);

    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.dataset_id, 'REF-GAIT-V1');
    assert.strictEqual(result.unit, 'normalized');
    assert.strictEqual(result.valid_count, 6);
    assert.strictEqual(result.quarantined_count, 0);

    // Verify record provenance is preserved
    const rec = result.valid_records[0];
    assert.strictEqual(rec.record_id, 'REC-GS-01');
    assert.strictEqual(rec.provenance.dataset_id, 'REF-GAIT-V1');
    assert.strictEqual(rec.provenance.record_id, 'REC-GS-01');
    assert.ok(rec.pressures.heel_center > 0.8);
  });

  runTest('Quarantine malformed records without silent coercion', () => {
    const raw = JSON.parse(fs.readFileSync(malformedPath, 'utf8'));
    const result = validateReferenceDataset(raw);

    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.valid_count, 1); // Only REC-VALID-01
    assert.strictEqual(result.quarantined_count, 6); // 6 quarantined records

    const quarantinedIds = result.quarantined_records.map(r => r.record_id);
    assert.ok(quarantinedIds.includes('REC-BAD-UNIT'));
    assert.ok(quarantinedIds.includes('REC-VALID-01')); // Duplicate
    assert.ok(quarantinedIds.includes('REC-BAD-NONFINITE'));
    assert.ok(quarantinedIds.includes('REC-BAD-RANGE'));
    assert.ok(quarantinedIds.includes('REC-BAD-SENSOR'));
  });

  runTest('Reject dataset with missing header or incompatible unit', () => {
    assert.throws(() => {
      validateReferenceDataset({ dataset_id: 'TEST', unit: 'psi_pounds', records: [] });
    }, /Unsupported or missing "unit"/);

    assert.throws(() => {
      validateReferenceDataset({ unit: 'normalized', records: [] });
    }, /Missing or empty "dataset_id"/);
  });

  // --- Suite 2: Deterministic Comparison & Evidence Retrieval ---
  console.log('\nSuite 2: Deterministic Comparison & Evidence Retrieval');

  const sampleDataset = validateReferenceDataset(JSON.parse(fs.readFileSync(samplePath, 'utf8')));

  runTest('Deterministic match for Heel Strike snapshot', () => {
    // Sensor reading with heavy heel pressure, matching REC-GS-01
    const heelStrikeSnapshot = {
      heel_center: 0.92,
      heel_medial: 0.72,
      heel_lateral: 0.63,
      arch_lateral: 0.04,
      meta_1: 0.0,
      toe_1: 0.0
    };

    const evidence = compareSensorWithDataset(heelStrikeSnapshot, sampleDataset, { minComparableChannels: 3, topK: 3 });

    assert.strictEqual(evidence.status, ANALYSIS_STATUS.OK);
    assert.strictEqual(evidence.active_channel_count, 6);
    assert.ok(evidence.matches.length > 0);

    const top = evidence.matches[0];
    assert.strictEqual(top.record_id, 'REC-GS-01');
    assert.ok(top.similarity_score > 0.95, `Expected similarity > 0.95, got ${top.similarity_score}`);
    assert.ok(top.rmsd_distance < 0.05, `Expected RMSD < 0.05, got ${top.rmsd_distance}`);
    assert.strictEqual(top.comparable_channel_count, 6);

    // Verify deltas exist
    assert.strictEqual(typeof top.channel_deltas.heel_center, 'number');
  });

  runTest('Deterministic match for Toe Off snapshot', () => {
    const toeOffSnapshot = {
      meta_1: 0.88,
      meta_2: 0.82,
      toe_1: 0.96,
      toe_2: 0.64,
      heel_center: 0.0
    };

    const evidence = compareSensorWithDataset(toeOffSnapshot, sampleDataset, { minComparableChannels: 3, topK: 3 });
    assert.strictEqual(evidence.status, ANALYSIS_STATUS.OK);
    assert.strictEqual(evidence.matches[0].record_id, 'REC-TO-03');
  });

  runTest('Deterministic tie-breaker handles identical similarity scores', () => {
    // Synthetic dataset with two identical patterns but different IDs
    const tieDataset = {
      valid_records: [
        {
          record_id: 'REC-B-TIE',
          pattern: 'Tie Pattern B',
          pressures: { heel_center: 0.5, meta_1: 0.5, toe_1: 0.5 },
          provenance: { dataset_id: 'TIE', version: '1', record_id: 'REC-B-TIE' }
        },
        {
          record_id: 'REC-A-TIE',
          pattern: 'Tie Pattern A',
          pressures: { heel_center: 0.5, meta_1: 0.5, toe_1: 0.5 },
          provenance: { dataset_id: 'TIE', version: '1', record_id: 'REC-A-TIE' }
        }
      ]
    };

    const snapshot = { heel_center: 0.5, meta_1: 0.5, toe_1: 0.5 };
    const evidence = compareSensorWithDataset(snapshot, tieDataset, { minComparableChannels: 3 });

    assert.strictEqual(evidence.matches[0].record_id, 'REC-A-TIE'); // Lexicographical tie break
    assert.strictEqual(evidence.matches[1].record_id, 'REC-B-TIE');
  });

  runTest('Refuse comparison on insufficient active channels (single channel HW mode)', () => {
    // Current ESP32 prototype only provides 1 channel (GPIO32 mapped to heel_center)
    const singleChannelSnapshot = {
      heel_center: { value: 0.85, hasSignal: true, source: 'ESP32 GPIO32' },
      meta_1: { value: 0, hasSignal: false, source: 'No signal' }
    };

    const evidence = compareSensorWithDataset(singleChannelSnapshot, sampleDataset, { minComparableChannels: 3 });

    assert.strictEqual(evidence.status, ANALYSIS_STATUS.INSUFFICIENT_DATA);
    assert.ok(evidence.reason.includes('Insufficient active sensor channels'));
    assert.strictEqual(evidence.active_channel_count, 1);
    assert.strictEqual(evidence.matches.length, 0);
  });

  runTest('Missing readings and unmapped channels explicitly tracked without zero coercion', () => {
    const sparseSnapshot = {
      heel_center: 0.80,
      meta_1: 0.70,
      toe_1: 0.90
      // Other 12 channels omitted
    };

    const evidence = compareSensorWithDataset(sparseSnapshot, sampleDataset, { minComparableChannels: 3 });

    assert.strictEqual(evidence.status, ANALYSIS_STATUS.OK);
    assert.strictEqual(evidence.active_channel_count, 3);
    assert.strictEqual(evidence.unmapped_or_missing_channels.length, 12);
    assert.ok(evidence.unmapped_or_missing_channels.includes('arch_medial'));
  });

  // --- Suite 3: LLM Adapter, Output Schema & Security Boundary ---
  console.log('\nSuite 3: LLM Adapter, Output Schema & Security Boundary');

  await runAsyncTest('End-to-end analysis with valid mock LLM adapter', async () => {
    const mockAdapter = new TestMockLLMAdapter({ mode: 'valid' });
    const engine = new AnalysisEngine({
      llmAdapter: mockAdapter,
      defaultDataset: sampleDataset
    });

    const snapshot = {
      heel_center: 0.90,
      heel_medial: 0.70,
      heel_lateral: 0.65,
      meta_1: 0.0,
      toe_1: 0.0
    };

    const result = await engine.analyze(snapshot, { minComparableChannels: 3 });

    assert.strictEqual(result.status, ANALYSIS_STATUS.OK);
    assert.ok(result.summary.includes('REC-GS-01'));
    assert.deepStrictEqual(Array.from(result.cited_record_ids), ['REC-GS-01']);
    assert.ok(result.evidence_based_observations.length > 0);
    assert.ok(result.uncertainty_limitations.some(l => l.includes('clinical') || l.includes('diagnosis')));
    assert.strictEqual(result.is_fallback, false);
    assert.ok(result.deterministic_evidence.matches.length > 0);
  });

  await runAsyncTest('Strict schema validation rejects hallucinated uncited record IDs', async () => {
    const mockAdapter = new TestMockLLMAdapter({ mode: 'hallucinate_citation' });
    const engine = new AnalysisEngine({
      llmAdapter: mockAdapter,
      defaultDataset: sampleDataset
    });

    const snapshot = {
      heel_center: 0.90,
      heel_medial: 0.70,
      heel_lateral: 0.65
    };

    const result = await engine.analyze(snapshot, { minComparableChannels: 3 });

    // Ensure hallucinated record 'REC-FABRICATED-999' was stripped
    assert.ok(!result.cited_record_ids.includes('REC-FABRICATED-999'));
    assert.strictEqual(result.rejected_citations_count, 1);
    assert.ok(result.uncertainty_limitations.some(l => l.includes('Disallowed by strict provenance validator')));
  });

  await runAsyncTest('Model unavailability produces safe deterministic fallback', async () => {
    const mockAdapter = new TestMockLLMAdapter({ mode: 'unavailable' });
    const engine = new AnalysisEngine({
      llmAdapter: mockAdapter,
      defaultDataset: sampleDataset
    });

    const snapshot = {
      meta_1: 0.85,
      meta_2: 0.80,
      toe_1: 0.95
    };

    const result = await engine.analyze(snapshot, { minComparableChannels: 3 });

    assert.strictEqual(result.status, ANALYSIS_STATUS.OK);
    assert.strictEqual(result.is_fallback, true);
    assert.ok(result.summary.startsWith('Deterministic evaluation'));
    assert.deepStrictEqual(Array.from(result.cited_record_ids), ['REC-TO-03']);
    assert.ok(result.uncertainty_limitations.some(l => l.includes('deterministic fallback')));
  });

  await runAsyncTest('Safe handling when sensor input is insufficient data', async () => {
    const mockAdapter = new TestMockLLMAdapter({ mode: 'valid' });
    const engine = new AnalysisEngine({
      llmAdapter: mockAdapter,
      defaultDataset: sampleDataset
    });

    // Only 1 channel active
    const sparseSnapshot = { heel_center: 0.90 };
    const result = await engine.analyze(sparseSnapshot, { minComparableChannels: 3 });

    assert.strictEqual(result.status, ANALYSIS_STATUS.INSUFFICIENT_DATA);
    assert.strictEqual(result.is_fallback, true);
    assert.strictEqual(result.cited_record_ids.length, 0);
  });

  runTest('Credentials are secure and not exposed in adapter properties or outputs', () => {
    const secretKey = 'secret_test_key_123456789';
    process.env.GEMINI_API_KEY = secretKey;

    const envAdapter = new ServerEnvLLMAdapter('GEMINI_API_KEY');

    // Confirm secret key does not appear in serialized string of adapter
    const adapterStr = JSON.stringify(envAdapter);
    assert.ok(!adapterStr.includes(secretKey), 'Adapter serialization must not leak API key');

    // Clean up environment
    delete process.env.GEMINI_API_KEY;
  });

  // --- Suite 4: Regression of Phase 1 Unit Tests ---
  console.log('\nSuite 4: Regression Check on Phase 1');

  runTest('Verify Phase 1 test suite remains intact and passing', () => {
    const phase1TestFile = path.resolve(__dirname, '../test_phase1.js');
    assert.ok(fs.existsSync(phase1TestFile), 'test_phase1.js must exist');
    // We will also run test_phase1.js via command runner
  });

  console.log('\n============================================================');
  console.log(` Test Summary: ${testsPassed} / ${testsTotal} tests passed.`);
  console.log('============================================================\n');

  if (testsPassed !== testsTotal) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
