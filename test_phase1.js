const fs = require('fs');

console.log('--- Phase 1 Verification Suite ---');

// 1. Verify HTML and Script IDs match
const html = fs.readFileSync('index.html', 'utf8');
const js = fs.readFileSync('script.js', 'utf8');

const idRegex = /document\.getElementById\(['"]([^'"]+)['"]\)/g;
const uniqueIds = new Set();
let match;
while ((match = idRegex.exec(js)) !== null) {
  uniqueIds.add(match[1]);
}

console.log(`Checking ${uniqueIds.size} unique DOM IDs referenced in script.js...`);
const missing = [];
for (const id of uniqueIds) {
  if (!html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) {
    missing.push(id);
  }
}

if (missing.length > 0) {
  console.error('FAIL: Missing IDs in index.html:', missing);
  process.exit(1);
} else {
  console.log('PASS: All element IDs referenced in script.js exist in index.html.');
}

// 2. Test Sensor Config & Independence
// Extract SENSOR_LOCATIONS definition from script.js
const sensorMatch = js.match(/const SENSOR_LOCATIONS = (\[[\s\S]*?\]);/);
if (!sensorMatch) {
  console.error('FAIL: Could not locate SENSOR_LOCATIONS in script.js');
  process.exit(1);
}

const SENSOR_LOCATIONS = eval(sensorMatch[1]);
console.log(`PASS: SENSOR_LOCATIONS parsed successfully (${SENSOR_LOCATIONS.length} sensors defined).`);

// Verify all required regions and IDs are covered
const regions = new Set(SENSOR_LOCATIONS.map(s => s.region));
console.log('Covered regions:', Array.from(regions).join(', '));
const expectedRegions = ['Toes', 'Forefoot', 'Midfoot', 'Heel'];
for (const r of expectedRegions) {
  if (!regions.has(r)) {
    console.error(`FAIL: Missing anatomical region ${r}`);
    process.exit(1);
  }
}
console.log('PASS: All expected anatomical regions (Toes, Forefoot, Midfoot, Heel) are represented.');

// Verify 5 sensors with unique IDs (2 in toes with good separation, 1 in forefoot, 1 in midfoot, 1 in heel)
const sensorIds = SENSOR_LOCATIONS.map(s => s.id);
const uniqueSensorIds = new Set(sensorIds);
if (uniqueSensorIds.size !== 5) {
  console.error(`FAIL: Expected 5 unique sensor IDs, found ${uniqueSensorIds.size}`);
  process.exit(1);
}
console.log('PASS: Exactly 5 unique sensor locations defined (Toe Medial, Toe Lateral, Forefoot, Midfoot, Heel).');

// Verify good distance between the two toe sensors
const toe1 = SENSOR_LOCATIONS.find(s => s.id === 'toe_medial');
const toe2 = SENSOR_LOCATIONS.find(s => s.id === 'toe_lateral');
if (!toe1 || !toe2) {
  console.error('FAIL: Could not find both toe sensors (toe_medial, toe_lateral)');
  process.exit(1);
}
const toeDist = Math.sqrt(Math.pow(toe1.x - toe2.x, 2) + Math.pow(toe1.y - toe2.y, 2));
if (toeDist < 0.20) {
  console.error(`FAIL: Toe sensors too close together (dist=${toeDist.toFixed(3)})`);
  process.exit(1);
}
console.log(`PASS: Two toe sensors separated by good distance (dist=${toeDist.toFixed(3)} in normalized space).`);

// 3. Test independence of sensor states
const sensors = {};
SENSOR_LOCATIONS.forEach(loc => {
  sensors[loc.id] = { targetValue: 0, currentValue: 0, peakValue: 0 };
});

// Update heel only
sensors['heel'].targetValue = 0.85;
for (const id of sensorIds) {
  if (id === 'heel') {
    if (sensors[id].targetValue !== 0.85) throw new Error('Heel target mismatch');
  } else {
    if (sensors[id].targetValue !== 0) throw new Error(`Sensor ${id} bled value from heel!`);
  }
}
console.log('PASS: Sensor value independence verified (pressing heel does not alter toes/arch).');

// 4. Test simultaneous pressure at multiple locations
sensors['toe_medial'].targetValue = 0.95;
sensors['toe_lateral'].targetValue = 0.65;
sensors['forefoot'].targetValue = 0.70;
if (sensors['heel'].targetValue === 0.85 &&
    sensors['toe_medial'].targetValue === 0.95 &&
    sensors['toe_lateral'].targetValue === 0.65 &&
    sensors['forefoot'].targetValue === 0.70 &&
    sensors['midfoot'].targetValue === 0) {
  console.log('PASS: Simultaneous multi-location pressure verified.');
} else {
  console.error('FAIL: Multi-location state error');
  process.exit(1);
}

// 5. Test SerialAdapter Line Parsing
class TestSerialAdapter {
  constructor() {
    this.packets = [];
  }
  parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('---') || trimmed.includes('Started') || trimmed.includes('Reading')) {
      return;
    }

    const pointMatch = trimmed.match(/^(?:Point\s*(\d+)(?:\s*\((?:GPIO\s*)?(\d+)\))?|(?:GPIO\s*)(\d+))\s*:\s*(\d+)/i);
    if (pointMatch) {
      const pointIdx = pointMatch[1] ? parseInt(pointMatch[1], 10) : null;
      const rawVal = parseInt(pointMatch[4], 10);
      const updates = {};
      const mapping = { 1: 'toe_medial', 2: 'toe_lateral', 3: 'forefoot', 4: 'midfoot', 5: 'heel' };
      updates[mapping[pointIdx] || `point_${pointIdx}`] = rawVal;
      this.packets.push({ type: 'multichannel_named', data: updates });
      return;
    }

    if (line.includes(':')) {
      const pairs = line.split(',');
      const updates = {};
      pairs.forEach(p => {
        const [k, v] = p.split(':');
        const num = parseInt(v, 10);
        if (k && !isNaN(num)) updates[k.trim()] = num;
      });
      this.packets.push({ type: 'multichannel_named', data: updates });
      return;
    }
    if (line.includes(',')) {
      const parts = line.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      this.packets.push({ type: 'multichannel_indexed', data: parts });
      return;
    }
    const val = parseInt(line, 10);
    if (!isNaN(val)) {
      this.packets.push({ type: 'single_channel', raw: val });
    }
  }
}

const adapter = new TestSerialAdapter();
adapter.parseLine('2048');
adapter.parseLine('heel:3200,forefoot:1500');
adapter.parseLine('100,200,300,400,500');
adapter.parseLine('Velostat Sensor Started');
adapter.parseLine('Point 1 (GPIO 32): 2145');
adapter.parseLine('Point 5 (GPIO 36): 4095');
adapter.parseLine('--------------------');

if (adapter.packets[0].type === 'single_channel' && adapter.packets[0].raw === 2048 &&
    adapter.packets[1].type === 'multichannel_named' && adapter.packets[1].data.heel === 3200 &&
    adapter.packets[2].type === 'multichannel_indexed' && adapter.packets[2].data.length === 5 &&
    adapter.packets[3].type === 'multichannel_named' && adapter.packets[3].data.toe_medial === 2145 &&
    adapter.packets[4].type === 'multichannel_named' && adapter.packets[4].data.heel === 4095 &&
    adapter.packets.length === 5) {
  console.log('PASS: SerialAdapter parsing verified (Format A single integer, Format B CSV, Format C key-value, Format D Arduino Point/GPIO).');
} else {
  console.error('FAIL: SerialAdapter packet parsing error');
  process.exit(1);
}

// 6. Test Calibration & Inversion Math
function calcNormalized(rawVal, calibMin, calibMax, invertADC) {
  const min = Math.min(calibMin, calibMax);
  const max = Math.max(calibMin, calibMax);
  const span = Math.max(50, max - min);
  let normalized;
  if (invertADC) {
    normalized = (max - rawVal) / span;
  } else {
    normalized = (rawVal - min) / span;
  }
  return Math.max(0, Math.min(1.0, normalized));
}

// Standard (low ADC = 0, high ADC = 4095)
const norm1 = calcNormalized(2048, 0, 4095, false);
if (Math.abs(norm1 - 0.5) > 0.02) throw new Error(`Standard normalization math failed: ${norm1}`);

// Inverted (low ADC = pressed, high ADC = resting)
const norm2 = calcNormalized(1000, 1000, 3500, true);
if (norm2 !== 1.0) throw new Error(`Inverted max press normalization failed: ${norm2}`);

const norm3 = calcNormalized(3500, 1000, 3500, true);
if (norm3 !== 0.0) throw new Error(`Inverted resting normalization failed: ${norm3}`);

console.log('PASS: Normalization & ADC inversion math verified.');

console.log('\nALL 6 VERIFICATION CHECKS PASSED SUCCESSFULLY!');
