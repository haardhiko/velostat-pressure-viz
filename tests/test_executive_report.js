/**
 * Verification test for Executive Foot Health & Action Report
 */

const assert = require('assert');
const fs = require('fs');

console.log('--- Executive Foot Health & Action Report Test Suite ---');

const js = fs.readFileSync('script.js', 'utf8');

// Ensure function definition exists
assert(js.includes('function renderExecutiveActionReport'), 'renderExecutiveActionReport must be defined');

// Extract the plainDefectExplanations dictionary from script.js
const dictMatch = js.match(/const plainDefectExplanations = ({[\s\S]*?\n    \});/);
assert(dictMatch, 'plainDefectExplanations must exist in script.js');

const dict = eval(`(${dictMatch[1]})`);
console.log(`PASS: Found ${Object.keys(dict).length} plain-English defect descriptions.`);

// Assert key conditions are clearly translated into non-complicated language
assert(dict['PES-PLANUS'], 'Must translate Flatfoot');
assert(dict['PES-PLANUS'].title.includes('Flat Foot'), 'Title must be user-friendly');
assert(dict['PES-CAVUS'], 'Must translate High Arch');
assert(dict['METATARSALGIA'], 'Must translate Metatarsalgia');
assert(dict['PLANTAR-FASCIITIS'], 'Must translate Plantar Fasciitis');
assert(dict['ABNORMAL-HEEL'], 'Must translate Heel Strike');

console.log('PASS: All primary defects translated into plain-English terminology.');

// Check HTML structure contains the report elements
const html = fs.readFileSync('index.html', 'utf8');
const requiredIds = [
  'executive-summary-report',
  'exec-status-badge',
  'exec-report-title',
  'exec-summary-text',
  'exec-defects-pill',
  'exec-defects-count',
  'exec-defects-list',
  'action-footwear-list',
  'action-exercises-list',
  'action-habits-list'
];

requiredIds.forEach(id => {
  assert(html.includes(`id="${id}"`), `index.html must contain id="${id}"`);
});

console.log(`PASS: All ${requiredIds.length} required executive report DOM IDs exist in index.html.`);
console.log('ALL EXECUTIVE REPORT TESTS PASSED!');
