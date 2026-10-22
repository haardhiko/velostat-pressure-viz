/**
 * Adapter for 15257837.zip FSR Matrix Dataset.
 * Parses raw CSV grid/interpolation matrices from nested FSR DATA_FV.
 * 
 * Strict preservation rules:
 * - Preserves the COMPLETE 2D matrix losslessly; does not truncate to sample rows.
 * - Does not filter empty CSV cells in a way that shifts column positions.
 * - Empty cells are flagged and quarantined; they are never silently coerced to zero.
 * - Enforces consistent rectangular grid dimensions across all matrix rows.
 * - Explicitly marks records as 'needs_mapping' and 'not_comparable'
 *   because physical units (kPa / N) and spatial coordinate grids are not established by authoritative documentation.
 */

const {
  ADAPTER_STATUS,
  createSharedRecord
} = require('./base_adapter');

class FsrMatrixAdapter {
  constructor() {
    this.datasetName = 'fsr-matrix-15257837';
    this.version = '1.0.0';
  }

  /**
   * Parses an FSR matrix CSV file, preserving the complete lossless 2D numerical grid.
   * @param {string} csvContent Raw CSV file content
   * @param {Object} provenance { archive, source_file }
   * @returns {Object} Ingestion result including complete matrix
   */
  parse(csvContent, provenance = {}) {
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 4) {
      return {
        source_dataset: this.datasetName,
        source_version: this.version,
        source_file: provenance.source_file || 'unknown',
        grid_dimensions: [0, 0],
        accepted_count: 0,
        quarantined_count: 1,
        matrix: Object.freeze([]),
        records: Object.freeze([]),
        reasons: ['File contains fewer than 4 rows (incomplete header/metadata/grid)']
      };
    }

    // Row 0: Timestamp / Map identifier (e.g. ",MAP__20_11_2024__11_45_45,,,,")
    const headerRow = lines[0];
    const mapIdMatch = headerRow.match(/MAP__([0-9_]+)/i);
    const mapIdentifier = mapIdMatch ? mapIdMatch[1] : 'unspecified_map';

    // Row 1: Metadata row (e.g. "3.919031,Rectus,2.525574,Rectus...")
    const metadataTokens = lines[1].split(',').map(t => t.trim());

    // Row 2: Tag line (e.g. "INTERPOLATIONS,,,,")
    const tag = lines[2].split(',')[0].trim();

    // Rows 3+: Interpolated 2D numerical matrix rows
    const matrix = [];
    const quarantinedRows = [];
    let expectedCols = null;

    for (let r = 3; r < lines.length; r++) {
      // Split preserving exact column indices without shifting
      const tokens = lines[r].split(',').map(t => t.trim());

      if (expectedCols === null) {
        expectedCols = tokens.length;
      }

      if (tokens.length !== expectedCols) {
        quarantinedRows.push({
          row_index: r,
          reason: `Row column count mismatch: expected ${expectedCols}, got ${tokens.length}`,
          raw: lines[r]
        });
        continue;
      }

      let rowHasInvalid = false;
      let invalidReason = '';
      const rowNums = [];

      for (let c = 0; c < tokens.length; c++) {
        const t = tokens[c];
        // In JS, Number('') === 0. We must explicitly reject empty cells so they are not coerced to zero
        if (t === '') {
          rowHasInvalid = true;
          invalidReason = `Empty cell detected at column ${c}; empty cells are not coerced to zero and column positions must not shift`;
          break;
        }

        const num = Number(t);
        if (typeof num !== 'number' || !Number.isFinite(num)) {
          rowHasInvalid = true;
          invalidReason = `Non-finite numeric value '${t}' at column ${c}`;
          break;
        }

        rowNums.push(num);
      }

      if (rowHasInvalid) {
        quarantinedRows.push({
          row_index: r,
          reason: invalidReason,
          raw: lines[r]
        });
        continue;
      }

      matrix.push(rowNums);
    }

    const rowCount = matrix.length;
    const colCount = expectedCols || 0;
    const isAccepted = quarantinedRows.length === 0 && rowCount > 0;

    // Freeze complete 2D matrix losslessly for immutability
    const frozenMatrix = Object.freeze(matrix.map(row => Object.freeze([...row])));

    const baseId = provenance.source_file
      ? provenance.source_file.replace(/\.csv$/i, '')
      : 'fsr_matrix';

    const record = createSharedRecord({
      source_dataset: this.datasetName,
      source_version: this.version,
      source_record_id: `${baseId}_${mapIdentifier}`,
      foot: 'unspecified',
      timestamp_sec: null,
      sample_rate_hz: null,
      original_values: {
        grid_dimensions: [rowCount, colCount],
        metadata_tokens: metadataTokens,
        tag,
        map_identifier: mapIdentifier,
        // Lossless representation: complete rectangular matrix preserved
        matrix: frozenMatrix
      },
      original_units: 'uncalibrated_arbitrary_interpolations',
      regional_values: null, // Regional mapping explicitly withheld
      regional_units: null,
      mapping_method: 'none',
      mapping_coverage: 0.0,
      normalization_method: 'none',
      status: ADAPTER_STATUS.NEEDS_MAPPING,
      reasons: [
        `Complete ${rowCount}x${colCount} matrix preserved losslessly without column shifting.`,
        'Spatial arrangement, electrode coordinates, and anatomical landmarks are not defined in source documentation.',
        'Units cannot be inferred from image labels or filenames per specification; regional pressure comparison is withheld.'
      ],
      provenance: {
        archive: provenance.archive || '15257837.zip',
        source_file: provenance.source_file || 'rectus_rectus.csv',
        row_or_sample_index: 0,
        notes: `Nested inside 2. FSR_DATASET_FV.zip. Lossless grid size: ${rowCount}x${colCount}.`
      }
    });

    return {
      source_dataset: this.datasetName,
      source_version: this.version,
      source_file: provenance.source_file || 'unknown',
      grid_dimensions: [rowCount, colCount],
      accepted_count: isAccepted ? 1 : 0,
      quarantined_count: quarantinedRows.length,
      matrix: frozenMatrix, // Direct access to complete matrix
      records: Object.freeze(isAccepted ? [record] : []),
      quarantined_rows: Object.freeze(quarantinedRows),
      status: ADAPTER_STATUS.NEEDS_MAPPING
    };
  }
}

module.exports = {
  FsrMatrixAdapter
};
