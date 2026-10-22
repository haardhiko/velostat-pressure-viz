/**
 * Adapter for PhysioNet Gait in Parkinson's Disease VGRF Dataset.
 * Parses 19-column text files at 100 Hz (Time, 8 Left VGRF in Newtons, 8 Right VGRF in Newtons, Total L, Total R).
 * Derives four-region values using a project-defined coordinate-based heuristic from documented Infotronic sensor positions.
 * 
 * IMPORTANT ARCHITECTURAL & MAPPING NOTE:
 * The PhysioNet dataset documentation (format.txt) provides physical (X, Y) coordinates for the 8 Ultraflex/Infotronic
 * sensors per foot, but DOES NOT define anatomical region groups. The grouping of these coordinates into
 * 'heel', 'arch', 'ball', and 'toes' is a PROJECT-DEFINED COORDINATE HEURISTIC.
 * 
 * Heuristic Assumptions:
 * - Sensors 1, 2, 3 (Y <= -400 mm) approximate calcaneal / rearfoot (heel) contact.
 * - Sensors 4, 5 (Y = 0 mm) approximate midfoot / longitudinal arch support.
 * - Sensors 6, 7 (Y = 400 mm) approximate metatarsal heads / forefoot (ball) loading.
 * - Sensor 8 (Y = 800 mm) approximates distal hallux / toes push-off.
 * 
 * Heuristic Limits:
 * - Infotronic insole uses 8 discrete point sensors, not a continuous high-density pressure map.
 * - Coordinate partitions are fixed threshold bands, not customized to individual subject foot morphology.
 * - Original measurements are vertical ground reaction forces (VGRF) in Newtons (N), NOT pressure.
 * - Derived regional values represent relative load percentages (sum = 1.0), distinct from physical pressure (kPa)
 *   since sensor contact surface areas are not measured or calibrated.
 */

const {
  ADAPTER_STATUS,
  createSharedRecord
} = require('./base_adapter');

/**
 * Sensor (X, Y) coordinates from PhysioNet format.txt, mapped via project-defined coordinate heuristic:
 * - Y <= -400 -> heel
 * - Y == 0    -> arch
 * - Y == 400  -> ball
 * - Y >= 800  -> toes
 */
const SENSOR_COORDINATES = Object.freeze({
  L1: { x: -500, y: -800, region: 'heel', note: 'Project heuristic: rearfoot' },
  L2: { x: -700, y: -400, region: 'heel', note: 'Project heuristic: rearfoot lateral' },
  L3: { x: -300, y: -400, region: 'heel', note: 'Project heuristic: rearfoot medial' },
  L4: { x: -700, y: 0,    region: 'arch', note: 'Project heuristic: midfoot lateral' },
  L5: { x: -300, y: 0,    region: 'arch', note: 'Project heuristic: midfoot medial' },
  L6: { x: -700, y: 400,  region: 'ball', note: 'Project heuristic: forefoot lateral' },
  L7: { x: -300, y: 400,  region: 'ball', note: 'Project heuristic: forefoot medial' },
  L8: { x: -500, y: 800,  region: 'toes', note: 'Project heuristic: distal toes' },
  R1: { x: 500,  y: -800, region: 'heel', note: 'Project heuristic: rearfoot' },
  R2: { x: 700,  y: -400, region: 'heel', note: 'Project heuristic: rearfoot lateral' },
  R3: { x: 300,  y: -400, region: 'heel', note: 'Project heuristic: rearfoot medial' },
  R4: { x: 700,  y: 0,    region: 'arch', note: 'Project heuristic: midfoot lateral' },
  R5: { x: 300,  y: 0,    region: 'arch', note: 'Project heuristic: midfoot medial' },
  R6: { x: 700,  y: 400,  region: 'ball', note: 'Project heuristic: forefoot lateral' },
  R7: { x: 300,  y: 400,  region: 'ball', note: 'Project heuristic: forefoot medial' },
  R8: { x: 500,  y: 800,  region: 'toes', note: 'Project heuristic: distal toes' }
});

const REGION_SENSOR_MAP = Object.freeze({
  left: {
    heel: ['L1', 'L2', 'L3'],
    arch: ['L4', 'L5'],
    ball: ['L6', 'L7'],
    toes: ['L8']
  },
  right: {
    heel: ['R1', 'R2', 'R3'],
    arch: ['R4', 'R5'],
    ball: ['R6', 'R7'],
    toes: ['R8']
  }
});

class ParkinsonsVgrfAdapter {
  constructor() {
    this.datasetName = 'gait-in-parkinsons-disease';
    this.version = '1.0.0';
    this.sampleRateHz = 100;
  }

  /**
   * Parses string content or lines from a 19-column gait text file.
   * Keeps left and right feet strictly separated.
   * @param {string} fileContent Raw content of .txt file
   * @param {Object} provenance { archive, source_file }
   * @returns {Object} { accepted: [], quarantined: [], summary: {} }
   */
  parse(fileContent, provenance = {}) {
    const lines = fileContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    const acceptedLeft = [];
    const acceptedRight = [];
    const quarantined = [];

    lines.forEach((line, index) => {
      const tokens = line.trim().split(/\s+/);

      // Verify column count
      if (tokens.length !== 19) {
        quarantined.push({
          row_index: index,
          reason: `Invalid column count: expected 19, found ${tokens.length}`,
          raw: line
        });
        return;
      }

      // Parse all numbers strictly
      const nums = tokens.map(t => Number(t));
      const hasInvalid = nums.some(n => typeof n !== 'number' || !Number.isFinite(n));

      if (hasInvalid) {
        quarantined.push({
          row_index: index,
          reason: 'Row contains non-numeric or non-finite values',
          raw: line
        });
        return;
      }

      const timeSec = nums[0];
      const leftSensors = nums.slice(1, 9);
      const rightSensors = nums.slice(9, 17);
      const leftTotalReported = nums[17];
      const rightTotalReported = nums[18];

      // Build Left Foot Record
      acceptedLeft.push(
        this._buildFootRecord({
          foot: 'left',
          timeSec,
          sensors: leftSensors,
          totalReported: leftTotalReported,
          rowIndex: index,
          provenance
        })
      );

      // Build Right Foot Record
      acceptedRight.push(
        this._buildFootRecord({
          foot: 'right',
          timeSec,
          sensors: rightSensors,
          totalReported: rightTotalReported,
          rowIndex: index,
          provenance
        })
      );
    });

    return {
      source_dataset: this.datasetName,
      source_version: this.version,
      source_file: provenance.source_file || 'unknown',
      total_rows: lines.length,
      accepted_count_per_foot: acceptedLeft.length,
      quarantined_count: quarantined.length,
      left_foot_records: Object.freeze(acceptedLeft),
      right_foot_records: Object.freeze(acceptedRight),
      quarantined_records: Object.freeze(quarantined)
    };
  }

  _buildFootRecord({ foot, timeSec, sensors, totalReported, rowIndex, provenance }) {
    const prefix = foot === 'left' ? 'L' : 'R';
    const originalValues = {};
    let computedTotal = 0;

    sensors.forEach((val, i) => {
      const channelId = `${prefix}${i + 1}`;
      originalValues[channelId] = val;
      computedTotal += val;
    });

    const mapping = REGION_SENSOR_MAP[foot];

    // Compute regional forces (Newtons)
    const regionalForceN = {
      heel: mapping.heel.reduce((sum, ch) => sum + originalValues[ch], 0),
      arch: mapping.arch.reduce((sum, ch) => sum + originalValues[ch], 0),
      ball: mapping.ball.reduce((sum, ch) => sum + originalValues[ch], 0),
      toes: mapping.toes.reduce((sum, ch) => sum + originalValues[ch], 0)
    };

    // Derived normalized relative load (0.0 to 1.0)
    let relativeLoad = null;
    let status = ADAPTER_STATUS.ACCEPTED;
    const reasons = [];

    if (computedTotal > 0.5) {
      relativeLoad = {
        heel: Number((regionalForceN.heel / computedTotal).toFixed(4)),
        arch: Number((regionalForceN.arch / computedTotal).toFixed(4)),
        ball: Number((regionalForceN.ball / computedTotal).toFixed(4)),
        toes: Number((regionalForceN.toes / computedTotal).toFixed(4))
      };
    } else {
      // Unloaded swing phase
      relativeLoad = { heel: 0.0, arch: 0.0, ball: 0.0, toes: 0.0 };
      reasons.push('Unloaded swing phase (total VGRF < 0.5 N)');
    }

    // Verify discrepancy with reported total
    if (Math.abs(computedTotal - totalReported) > 1.0) {
      reasons.push(`Reported total (${totalReported} N) differs from sum (${computedTotal.toFixed(2)} N)`);
    }

    const baseId = provenance.source_file
      ? provenance.source_file.replace(/\.txt$/i, '')
      : 'record';

    return createSharedRecord({
      source_dataset: this.datasetName,
      source_version: this.version,
      source_record_id: `${baseId}_${foot}_t${timeSec.toFixed(4)}`,
      foot,
      timestamp_sec: timeSec,
      sample_rate_hz: this.sampleRateHz,
      original_values: originalValues,
      original_units: 'N',
      regional_values: relativeLoad,
      regional_units: 'relative_load_pct',
      mapping_method: 'project_coordinate_heuristic_infotronic',
      mapping_coverage: 1.0, // All 8 sensors grouped into heel, arch, ball, toes via coordinate bands
      normalization_method: 'regional_force_divided_by_total_vgrf',
      contributing_sensor_ids: mapping,
      status,
      reasons,
      provenance: {
        archive: provenance.archive || 'gait-in-parkinsons-disease-1.0.0.zip',
        source_file: provenance.source_file || 'unknown',
        row_or_sample_index: rowIndex,
        notes: `Vertical Ground Reaction Force in Newtons. 8 sensors (${prefix}1..${prefix}8). Regional values derived via project-defined coordinate heuristic (distinct from physical pressure).`
      }
    });
  }
}

module.exports = {
  ParkinsonsVgrfAdapter,
  SENSOR_COORDINATES,
  REGION_SENSOR_MAP
};
