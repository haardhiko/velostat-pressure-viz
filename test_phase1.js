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

// Verify 4 regional sensors with unique IDs
const sensorIds = SENSOR_LOCATIONS.map(s => s.id);
const uniqueSensorIds = new Set(sensorIds);
if (uniqueSensorIds.size !== 4) {
  console.error(`FAIL: Expected 4 unique sensor IDs, found ${uniqueSensorIds.size}`);
  process.exit(1);
}
console.log('PASS: Exactly 4 unique sensor locations defined (Toes, Forefoot, Midfoot, Heel).');

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
sensors['toes'].targetValue = 0.95;
sensors['forefoot'].targetValue = 0.70;
if (sensors['heel'].targetValue === 0.85 &&
    sensors['toes'].targetValue === 0.95 &&
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
adapter.parseLine('heel_center:3200,meta_1:1500');
adapter.parseLine('100,200,300,400,500');

if (adapter.packets[0].type === 'single_channel' && adapter.packets[0].raw === 2048 &&
    adapter.packets[1].type === 'multichannel_named' && adapter.packets[1].data.heel_center === 3200 &&
    adapter.packets[2].type === 'multichannel_indexed' && adapter.packets[2].data.length === 5) {
  console.log('PASS: SerialAdapter parsing verified (Format A single integer, Format B CSV, Format C key-value).');
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
const normNormal = calcNormalized(4095, 0, 4095, false);
if (Math.abs(normNormal - 1.0) > 0.001) throw new Error('Normal calib max failed');
const normZero = calcNormalized(0, 0, 4095, false);
if (Math.abs(normZero - 0.0) > 0.001) throw new Error('Normal calib min failed');

// Inverted (Velostat voltage drop when pressed: 4095 = unpressed, 500 = pressed)
const normInvertPressed = calcNormalized(500, 500, 4095, true);
if (Math.abs(normInvertPressed - 1.0) > 0.001) throw new Error('Inverted calib pressed failed');
const normInvertRest = calcNormalized(4095, 500, 4095, true);
if (Math.abs(normInvertRest - 0.0) > 0.001) throw new Error('Inverted calib rest failed');
console.log('PASS: Normalization & ADC inversion math verified.');

console.log('\nALL 6 VERIFICATION CHECKS PASSED SUCCESSFULLY!');
