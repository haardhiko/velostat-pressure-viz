/**
 * NVIDIA NIM Analysis Adapter & Security Boundary for Velostat Foot Pressure (Phase 2).
 * Provides secret isolation for NVIDIA_NIM_API_KEY, strict citation validation,
 * and safe deterministic fallback mechanisms.
 */

const {
  ANALYSIS_STATUS,
  CLINICAL_DISCLAIMER
} = require('./constants');
const {
  generateDeterministicFallback
} = require('./llm_adapter');

const API_KEY_SYMBOL = Symbol('nvidia_nim_api_key');

/**
 * Base abstract NIM Adapter.
 */
class BaseNIMAdapter {
  async generateAnalysis(input) {
    throw new Error('generateAnalysis() must be implemented by adapter subclass');
  }
}

/**
 * Strict validator for untrusted model output from NVIDIA NIM.
 * Enforces that cited record IDs strictly exist within the deterministic comparison evidence.
 * 
 * @param {Object} rawOutput Model output object
 * @param {Object} comparisonEvidence Output from regional_comparator or comparator
 * @returns {Object} Validated and sanitized analysis response
 */
function validateAndSanitizeNIMOutput(rawOutput, comparisonEvidence) {
  if (!rawOutput || typeof rawOutput !== 'object') {
    throw new Error('NIM output must be a non-null object');
  }

  // Extract valid matched IDs from comparison evidence (supporting both record_id and source_record_id)
  const validMatchedIds = new Set(
    (comparisonEvidence && comparisonEvidence.matches ? comparisonEvidence.matches : []).map(
      m => m.source_record_id || m.record_id
    ).filter(Boolean)
  );

  // 1. Sanitize summary
  const summary = typeof rawOutput.summary === 'string' && rawOutput.summary.trim().length > 0
    ? rawOutput.summary.trim()
    : 'Summary unavailable from model output.';

  // 2. Validate cited record IDs (MUST strictly be in validMatchedIds)
  const rawCitations = Array.isArray(rawOutput.cited_record_ids) ? rawOutput.cited_record_ids : [];
  const sanitizedCitations = [];
  const rejectedCitations = [];

  rawCitations.forEach((id) => {
    if (typeof id === 'string' && validMatchedIds.has(id.trim())) {
      sanitizedCitations.push(id.trim());
    } else {
      rejectedCitations.push(id);
    }
  });

  // 3. Evidence-based observations
  const observations = Array.isArray(rawOutput.evidence_based_observations)
    ? rawOutput.evidence_based_observations.filter(s => typeof s === 'string' && s.trim().length > 0)
    : [];

  // 4. Uncertainty limitations
  const limitations = Array.isArray(rawOutput.uncertainty_limitations)
    ? rawOutput.uncertainty_limitations.filter(s => typeof s === 'string' && s.trim().length > 0)
    : [];

  // Enforce mandatory non-diagnostic clinical disclaimer in limitations
  if (!limitations.some(l => l.toLowerCase().includes('diagnosis') || l.toLowerCase().includes('clinical'))) {
    limitations.push('Dataset comparisons do not constitute a clinical diagnosis or medical evaluation.');
  }

  if (rejectedCitations.length > 0) {
    limitations.push(
      `Model attempted to cite unsupported/unmatched record ID(s): [${rejectedCitations.join(', ')}]. Disallowed by strict provenance validator.`
    );
  }

  // Active / missing channel/region tracking
  const evaluatedRegions = comparisonEvidence.active_regions || comparisonEvidence.active_channels || [];
  const missingRegions = comparisonEvidence.missing_regions || comparisonEvidence.unmapped_or_missing_channels || [];

  return {
    status: rawOutput.status === ANALYSIS_STATUS.INSUFFICIENT_DATA ? ANALYSIS_STATUS.INSUFFICIENT_DATA : ANALYSIS_STATUS.OK,
    summary,
    model_name: rawOutput.model_name || 'nvidia/nim',
    cited_record_ids: Object.freeze(sanitizedCitations),
    rejected_citations_count: rejectedCitations.length,
    evidence_based_observations: Object.freeze(observations),
    uncertainty_limitations: Object.freeze(limitations),
    evaluated_regions: Object.freeze(evaluatedRegions),
    missing_regions: Object.freeze(missingRegions),
    disclaimer: CLINICAL_DISCLAIMER,
    deterministic_evidence: comparisonEvidence,
    is_fallback: false
  };
}

/**
 * Server-side Environment-Aware NVIDIA NIM Adapter Stub (Phase 2).
 * 
 * IMPORTANT ARCHITECTURAL & OPERATIONAL STATUS:
 * ServerEnvNIMAdapter is currently a secure adapter stub that returns deterministic fallback
 * output. It DOES NOT call NVIDIA NIM or make live external network requests, even when a valid
 * API key is configured in process.env.NVIDIA_NIM_API_KEY. Live network calls and external API
 * integration belong exclusively to Phase 4 (backend persistent integration).
 * 
 * Secret Isolation Guarantees:
 * - Credentials are read strictly from process.env.NVIDIA_NIM_API_KEY (or NVIDIA_API_KEY).
 * - Key is stored in an un-exported private Symbol (API_KEY_SYMBOL).
 * - Key is never exposed in Object.keys(), console.log(), JSON.stringify(), error messages,
 *   or analysis response payloads.
 */
class ServerEnvNIMAdapter extends BaseNIMAdapter {
  constructor(options = {}) {
    super();
    this.envVarName = options.envVarName || 'NVIDIA_NIM_API_KEY';
    this.modelName = options.modelName || 'meta/llama-3.1-70b-instruct';

    // Store key securely via private non-enumerable symbol
    const key = process.env[this.envVarName] || process.env.NVIDIA_API_KEY || null;
    this[API_KEY_SYMBOL] = key && typeof key === 'string' && key.trim().length > 0 ? key.trim() : null;
  }

  hasCredentials() {
    return Boolean(this[API_KEY_SYMBOL]);
  }

  /**
   * Safe serialization to ensure credentials are never leaked.
   */
  toJSON() {
    return {
      adapter: 'ServerEnvNIMAdapter',
      modelName: this.modelName,
      hasCredentials: this.hasCredentials(),
      status: 'Phase 2 secure adapter stub (live network calls deferred to Phase 4)'
    };
  }

  async generateAnalysis({ sensorSummary, comparisonEvidence }) {
    if (!this.hasCredentials()) {
      return generateDeterministicFallback(
        comparisonEvidence,
        `No NVIDIA NIM API key configured in server environment (${this.envVarName})`
      );
    }

    // Phase 2 security boundary: return safe deterministic fallback.
    // Live remote endpoint wiring belongs to Phase 4 server backend.
    // ServerEnvNIMAdapter is currently a secure adapter stub and does NOT make live network calls.
    return generateDeterministicFallback(
      comparisonEvidence,
      'Phase 2 secure stub: deterministic fallback active (live NVIDIA NIM calls deferred to Phase 4 backend)'
    );
  }
}

/**
 * Test Mock NIM Adapter for automated test suites and offline development.
 */
class TestMockNIMAdapter extends BaseNIMAdapter {
  constructor(options = {}) {
    super();
    this.mode = options.mode || 'valid';
    this.modelName = options.modelName || 'meta/llama-3.1-70b-instruct';
    this.customResponse = options.customResponse || null;
  }

  setMode(mode, customResponse = null) {
    this.mode = mode;
    this.customResponse = customResponse;
  }

  async generateAnalysis({ sensorSummary, comparisonEvidence }) {
    if (this.mode === 'unavailable') {
      return generateDeterministicFallback(comparisonEvidence, 'NVIDIA NIM service offline or unreachable');
    }

    if (this.mode === 'error') {
      throw new Error('Simulated upstream network error from NVIDIA NIM API');
    }

    if (this.mode === 'invalid_json') {
      return generateDeterministicFallback(comparisonEvidence, 'NIM model returned non-conforming JSON payload');
    }

    if (this.mode === 'hallucinate_citation') {
      const topMatch = comparisonEvidence.matches && comparisonEvidence.matches[0];
      const validId = topMatch ? (topMatch.source_record_id || topMatch.record_id) : null;
      const fakeOutput = {
        summary: 'Observed significant resemblance to historical clinical trial records.',
        model_name: this.modelName,
        cited_record_ids: ['NIM-FABRICATED-REC-404', validId].filter(Boolean),
        evidence_based_observations: ['High relative load on heel region.'],
        uncertainty_limitations: ['Experimental assessment.']
      };
      return validateAndSanitizeNIMOutput(fakeOutput, comparisonEvidence);
    }

    if (this.customResponse) {
      return validateAndSanitizeNIMOutput(this.customResponse, comparisonEvidence);
    }

    if (!comparisonEvidence || comparisonEvidence.status === ANALYSIS_STATUS.INSUFFICIENT_DATA) {
      return generateDeterministicFallback(comparisonEvidence, 'Insufficient comparable regional data');
    }

    const top = comparisonEvidence.matches[0];
    const topId = top.source_record_id || top.record_id;
    const generated = {
      summary: `Four-region plantar distribution demonstrates closest alignment to reference ${topId} with ${(top.similarity_score * 100).toFixed(1)}% pattern similarity.`,
      model_name: this.modelName,
      cited_record_ids: [topId],
      evidence_based_observations: [
        `Heel and forefoot zones match reference load curve within ${(top.rmsd_distance * 100).toFixed(1)}% RMSD.`,
        `Evaluated across product regions with verified Infotronic VGRF coordinates.`
      ],
      uncertainty_limitations: [
        'Velostat piezoresistive sensors exhibit non-linear pressure-resistance characteristics.',
        'Comparison evaluates relative regional distribution; physical force calibration requires precision load cell testing.'
      ]
    };

    return validateAndSanitizeNIMOutput(generated, comparisonEvidence);
  }
}

module.exports = {
  BaseNIMAdapter,
  ServerEnvNIMAdapter,
  TestMockNIMAdapter,
  validateAndSanitizeNIMOutput
};
