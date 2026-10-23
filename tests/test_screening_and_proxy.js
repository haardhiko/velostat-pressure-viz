/**
 * 15-Point Foot Defect Screening & Universal LLM Proxy Test Suite
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');

console.log('============================================================');
console.log(' 15-Point Plantar Defect Screening & Proxy Test Suite');
console.log('============================================================\n');

// Load script.js to extract the screening function
const scriptCode = fs.readFileSync('script.js', 'utf8');

// Extract the screenPlantarDefectsAndAbnormalities function definition
const fnMatch = scriptCode.match(/function screenPlantarDefectsAndAbnormalities\s*\([\s\S]*?\n  \}/);
if (!fnMatch) {
  throw new Error('Could not extract screenPlantarDefectsAndAbnormalities from script.js');
}

// Evaluate function in a clean sandbox
const screenFn = new Function(`
  ${fnMatch[0]}
  return screenPlantarDefectsAndAbnormalities;
`)();

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failCount++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failCount++;
  }
}

// Suite 1: 15-Point Screening Logic Verification
console.log('Suite 1: 15-Point Foot Defect & Abnormality Screening');

test('Screening produces exactly 15 findings with required schema', () => {
  const findings = screenFn({ heel: 0.4, arch_medial: 0.1, arch_lateral: 0.1, forefoot_medial: 0.5, forefoot_lateral: 0.5 }, [], 10);
  assert.strictEqual(findings.length, 15, 'Must evaluate exactly 15 screening conditions');
  findings.forEach((f, idx) => {
    assert.strictEqual(f.id, idx + 1, `Finding ID must match sequence ${idx + 1}`);
    assert(f.name, `Finding ${idx + 1} must have a name`);
    assert(f.category, `Finding ${idx + 1} must have a category`);
    assert(['Detected', 'Normal', 'Unloaded'].includes(f.status), `Finding ${idx + 1} invalid status: ${f.status}`);
    assert(['Normal', 'Mild', 'Moderate', 'Severe'].includes(f.severity), `Finding ${idx + 1} invalid severity: ${f.severity}`);
    assert(f.observedReadings, `Finding ${idx + 1} missing observedReadings`);
    assert(f.abnormalityDetected, `Finding ${idx + 1} missing abnormalityDetected`);
    assert(f.supportingEvidence, `Finding ${idx + 1} missing supportingEvidence`);
    assert(f.possibleClinicalAssociation, `Finding ${idx + 1} missing possibleClinicalAssociation`);
    assert(f.limitationsAndCaveats, `Finding ${idx + 1} missing limitationsAndCaveats`);
  });
});

test('Zero input (unloaded insole) does not produce false-positive defect alarms', () => {
  const zeroFindings = screenFn({ heel: 0.0, arch_medial: 0.0, arch_lateral: 0.0, forefoot_medial: 0.0, forefoot_lateral: 0.0 }, [], 0);
  const detected = zeroFindings.filter(f => f.status === 'Detected');
  assert.strictEqual(detected.length, 0, `Unloaded insole should have 0 detected defects, found ${detected.length}`);
  assert.strictEqual(zeroFindings[0].status, 'Unloaded');
});

test('Condition 1: Flat Foot (Pes Planus) detected on medial arch collapse', () => {
  const findings = screenFn({ heel: 0.2, arch_medial: 0.48, arch_lateral: 0.28, forefoot_medial: 0.35, forefoot_lateral: 0.25 }, [], 10);
  const flatfoot = findings.find(f => f.code === 'PES-PLANUS');
  assert(flatfoot, 'Pes Planus check must exist');
  assert.strictEqual(flatfoot.status, 'Detected');
  assert(['Moderate', 'Severe'].includes(flatfoot.severity));
  assert(flatfoot.observedReadings.includes('Medial Arch: 48%'));
  assert(flatfoot.supportingEvidence.includes('REC-FLATFOOT-05'));
});

test('Condition 2: High Arch (Pes Cavus) detected on midfoot deficit with bimodal heel/toe contact', () => {
  const findings = screenFn({ heel: 0.65, arch_medial: 0.01, arch_lateral: 0.03, forefoot_medial: 0.50, forefoot_lateral: 0.45 }, [], 10);
  const cavus = findings.find(f => f.code === 'PES-CAVUS');
  assert(cavus, 'Pes Cavus check must exist');
  assert.strictEqual(cavus.status, 'Detected');
  assert(['Moderate', 'Severe'].includes(cavus.severity));
  assert(cavus.supportingEvidence.includes('REC-CAVUS-07'));
});

test('Condition 3: Metatarsalgia-Associated Loading detected on forefoot hyper-pressure', () => {
  const findings = screenFn({ heel: 0.15, arch_medial: 0.08, arch_lateral: 0.10, forefoot_medial: 0.88, forefoot_lateral: 0.75 }, [], 10);
  const meta = findings.find(f => f.code === 'METATARSALGIA');
  assert(meta, 'Metatarsalgia check must exist');
  assert.strictEqual(meta.status, 'Detected');
  assert.strictEqual(meta.severity, 'Severe');
  assert(meta.supportingEvidence.includes('REC-METATARSALGIA-08'));
});

test('Condition 4: Uneven Forefoot Loading detected on medial vs lateral ball disparity', () => {
  const findings = screenFn({ heel: 0.3, arch_medial: 0.1, arch_lateral: 0.1, forefoot_medial: 0.75, forefoot_lateral: 0.20 }, [], 10);
  const uneven = findings.find(f => f.code === 'UNEVEN-FOREFOOT');
  assert(uneven, 'Uneven Forefoot check must exist');
  assert.strictEqual(uneven.status, 'Detected');
  assert(uneven.observedReadings.includes('Medial Bias'));
});

test('Condition 5: Plantar Fasciitis pattern detected on high heel strike with arch strain', () => {
  const findings = screenFn({ heel: 0.72, arch_medial: 0.25, arch_lateral: 0.1, forefoot_medial: 0.3, forefoot_lateral: 0.3 }, [], 10);
  const pf = findings.find(f => f.code === 'PLANTAR-FASCIITIS');
  assert(pf, 'Plantar Fasciitis check must exist');
  assert.strictEqual(pf.status, 'Detected');
});

test('Condition 6: Abnormal Heel Loading detected on violent calcaneal impact', () => {
  const findings = screenFn({ heel: 0.85, arch_medial: 0.05, arch_lateral: 0.05, forefoot_medial: 0.2, forefoot_lateral: 0.2 }, [], 10);
  const heel = findings.find(f => f.code === 'ABNORMAL-HEEL');
  assert(heel, 'Abnormal Heel check must exist');
  assert.strictEqual(heel.status, 'Detected');
  assert(heel.observedReadings.includes('Calcaneus: 85%'));
});

test('Condition 7: Excessive Plantar Pressure detected when peak sensor >= 85%', () => {
  const findings = screenFn({ heel: 0.3, arch_medial: 0.1, arch_lateral: 0.1, forefoot_medial: 0.95, forefoot_lateral: 0.4 }, [], 10);
  const excess = findings.find(f => f.code === 'EXCESSIVE-PRESSURE');
  assert(excess, 'Excessive Pressure check must exist');
  assert.strictEqual(excess.status, 'Detected');
  assert.strictEqual(excess.severity, 'Severe');
});

test('Condition 8: Diabetic Foot Pressure-Risk Patterns flagged on hazardous focal load', () => {
  const findings = screenFn({ heel: 0.2, arch_medial: 0.1, arch_lateral: 0.1, forefoot_medial: 0.85, forefoot_lateral: 0.4 }, [], 10);
  const diabetic = findings.find(f => f.code === 'DIABETIC-RISK');
  assert(diabetic, 'Diabetic Risk check must exist');
  assert.strictEqual(diabetic.status, 'Detected');
  assert(diabetic.limitationsAndCaveats.includes('RESEARCH SCREENING RISK ONLY'));
});

test('Condition 9: Medial-Lateral Loading Imbalance detected on coronal skew', () => {
  // Medial: forefoot_medial (0.65) + arch_medial (0.40) = 1.05
  // Lateral: forefoot_lateral (0.15) + arch_lateral (0.10) = 0.25
  const findings = screenFn({ heel: 0.3, arch_medial: 0.40, arch_lateral: 0.10, forefoot_medial: 0.65, forefoot_lateral: 0.15 }, [], 10);
  const ml = findings.find(f => f.code === 'ML-IMBALANCE');
  assert(ml, 'Medial-Lateral check must exist');
  assert.strictEqual(ml.status, 'Detected');
  assert(ml.observedReadings.includes('Medial Column Dominance'));
});

test('Condition 10: Forefoot-to-Heel Loading Imbalance detected on anterior or posterior dominance', () => {
  // Forefoot: 0.85, Heel: 0.10 -> Forefoot ratio ~89%
  const findings = screenFn({ heel: 0.10, arch_medial: 0.05, arch_lateral: 0.05, forefoot_medial: 0.85, forefoot_lateral: 0.80 }, [], 10);
  const fh = findings.find(f => f.code === 'FH-IMBALANCE');
  assert(fh, 'Forefoot-Heel check must exist');
  assert.strictEqual(fh.status, 'Detected');
  assert(fh.observedReadings.includes('Anterior Shift'));
});

test('Condition 14: Compensatory Loading Patterns detected on localized antalgic void', () => {
  // Medial forefoot void (0.02) with high lateral compensation (0.75)
  const findings = screenFn({ heel: 0.4, arch_medial: 0.1, arch_lateral: 0.1, forefoot_medial: 0.02, forefoot_lateral: 0.75 }, [], 10);
  const comp = findings.find(f => f.code === 'COMPENSATORY-OFFLOAD');
  assert(comp, 'Compensatory check must exist');
  assert.strictEqual(comp.status, 'Detected');
  assert(comp.observedReadings.includes('Offloaded Zone: 1st Metatarsal (Medial)'));
});

test('Condition 15: Persistent Localized Pressure detected on unrelenting focal stress', () => {
  const findings = screenFn({ heel: 0.2, arch_medial: 0.1, arch_lateral: 0.1, forefoot_medial: 0.95, forefoot_lateral: 0.4 }, [], 10);
  const pers = findings.find(f => f.code === 'PERSISTENT-PRESSURE');
  assert(pers, 'Persistent Pressure check must exist');
  assert.strictEqual(pers.status, 'Detected');
});

// Suite 2: Multi-Input Differentiation (No Identical Outputs)
console.log('\nSuite 2: Multi-Input Differentiation (Fix for "Same Output" Bug)');

test('Zero, Saturation, Flatfoot, and Metatarsalgia produce completely distinct profiles', () => {
  const zero = screenFn({ heel: 0.0, arch_medial: 0.0, arch_lateral: 0.0, forefoot_medial: 0.0, forefoot_lateral: 0.0 }, [], 0);
  const sat = screenFn({ heel: 0.95, arch_medial: 0.95, arch_lateral: 0.95, forefoot_medial: 0.95, forefoot_lateral: 0.95 }, [], 10);
  const flat = screenFn({ heel: 0.2, arch_medial: 0.50, arch_lateral: 0.30, forefoot_medial: 0.40, forefoot_lateral: 0.25 }, [], 10);
  const meta = screenFn({ heel: 0.1, arch_medial: 0.05, arch_lateral: 0.05, forefoot_medial: 0.95, forefoot_lateral: 0.85 }, [], 10);

  const countZero = zero.filter(f => f.status === 'Detected').length;
  const countFlat = flat.filter(f => f.status === 'Detected').length;
  const countMeta = meta.filter(f => f.status === 'Detected').length;

  assert.strictEqual(countZero, 0, 'Zero load must have 0 detected defects');
  assert(countFlat > 0, 'Flatfoot must have detected defects');
  assert(countMeta > 0, 'Metatarsalgia must have detected defects');

  // Flatfoot must detect PES-PLANUS, Metatarsalgia must detect METATARSALGIA
  assert.strictEqual(flat.find(f => f.code === 'PES-PLANUS').status, 'Detected');
  assert.strictEqual(meta.find(f => f.code === 'PES-PLANUS').status, 'Normal');
  assert.strictEqual(meta.find(f => f.code === 'METATARSALGIA').status, 'Detected');
});

// Suite 3: Local Server LLM Proxy Verification
console.log('\nSuite 3: Local Server LLM Proxy (server.py)');

function makePost(path, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 8000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

(async () => {
  await asyncTest('Server proxy /api/llm/models returns default catalog for NVIDIA', async () => {
    const res = await makePost('/api/llm/models', { provider: 'nvidia' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert(Array.isArray(res.body.models));
    assert(res.body.models.includes('meta/llama-3.1-70b-instruct'));
  });

  await asyncTest('Server proxy /api/llm/models returns default catalog for Gemini', async () => {
    const res = await makePost('/api/llm/models', { provider: 'gemini' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert(Array.isArray(res.body.models));
    assert(res.body.models.includes('gemini-2.0-flash'));
  });

  await asyncTest('Server proxy /api/llm/models returns default catalog for Groq', async () => {
    const res = await makePost('/api/llm/models', { provider: 'groq' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert(Array.isArray(res.body.models));
    assert(res.body.models.includes('llama-3.3-70b-versatile'));
  });

  await asyncTest('Server proxy /api/llm/test returns error on missing key', async () => {
    const res = await makePost('/api/llm/test', { provider: 'nvidia', apiKey: '' });
    assert.strictEqual(res.body.ok, false);
    assert(res.body.error.includes('API key is required'));
  });

  console.log('\n============================================================');
  console.log(` Test Summary: ${passCount} passed, ${failCount} failed.`);
  console.log('============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
})();
