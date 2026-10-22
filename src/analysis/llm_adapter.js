/**
 * LLM Analysis Adapter & Output Validator for Velostat Foot Pressure (Phase 2).
 * Narrow boundary that formats evidence, keeps credentials secure, validates
 * untrusted model output, rejects hallucinated citations, and provides safe deterministic fallbacks.
 */

const {
  ANALYSIS_STATUS,
  CLINICAL_DISCLAIMER
} = require('./constants');

/**
 * Base abstract LLM Adapter.
 */
class BaseLLMAdapter {
  async generateAnalysis(input) {
    throw new Error('generateAnalysis() must be implemented by adapter subclass');
  }
}

/**
 * Strict validator for untrusted LLM outputs.
 * Enforces that cited record IDs strictly exist within the deterministic comparison evidence.
 * @param {Object} rawOutput Model output (parsed JSON or object)
 * @param {Object} comparisonEvidence Deterministic evidence produced by comparator.js
 * @returns {Object} Validated and sanitized analysis result
 */
function validateAndSanitizeModelOutput(rawOutput, comparisonEvidence) {
  if (!rawOutput || typeof rawOutput !== 'object') {
    throw new Error('LLM output must be a non-null object');
  }

  // Allowed record IDs from deterministic matching
  const validMatchedIds = new Set(
    (comparisonEvidence && comparisonEvidence.matches ? comparisonEvidence.matches : []).map(m => m.record_id)
  );

  // 1. Sanitize summary
  const summary = typeof rawOutput.summary === 'string' && rawOutput.summary.trim().length > 0
    ? rawOutput.summary.trim()
    : 'Summary unavailable from model output.';

  // 2. Validate cited record IDs (MUST be a subset of validMatchedIds)
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

  // Always enforce core clinical and measurement uncertainty
  if (!limitations.some(l => l.toLowerCase().includes('diagnosis') || l.toLowerCase().includes('clinical'))) {
    limitations.push('Dataset comparisons do not constitute a clinical diagnosis or medical evaluation.');
  }

  if (comparisonEvidence.unmapped_or_missing_channels && comparisonEvidence.unmapped_or_missing_channels.length > 0) {
    limitations.push(`Analysis based on ${comparisonEvidence.active_channel_count} active channels; ${comparisonEvidence.unmapped_or_missing_channels.length} sensor channels unmapped or inactive.`);
  }

  if (rejectedCitations.length > 0) {
    limitations.push(`Model attempted to cite unsupported/unmatched record ID(s): [${rejectedCitations.join(', ')}]. Disallowed by strict provenance validator.`);
  }

  return {
    status: rawOutput.status === ANALYSIS_STATUS.INSUFFICIENT_DATA ? ANALYSIS_STATUS.INSUFFICIENT_DATA : ANALYSIS_STATUS.OK,
    summary,
    cited_record_ids: Object.freeze(sanitizedCitations),
    rejected_citations_count: rejectedCitations.length,
    evidence_based_observations: Object.freeze(observations),
    uncertainty_limitations: Object.freeze(limitations),
    evaluated_channels: Object.freeze(comparisonEvidence.active_channels || []),
    missing_unmapped_channels: Object.freeze(comparisonEvidence.unmapped_or_missing_channels || []),
    disclaimer: CLINICAL_DISCLAIMER,
    deterministic_evidence: comparisonEvidence,
    is_fallback: false
  };
}

/**
 * Generates a safe, structured deterministic fallback analysis when
 * the LLM is unavailable, returns invalid output, or throws an error.
 * Never fabricates an answer.
 * @param {Object} comparisonEvidence Deterministic evidence from comparator.js
 * @param {string} fallbackReason Explanation for why fallback was triggered
 * @returns {Object} Structured analysis response
 */
function generateDeterministicFallback(comparisonEvidence, fallbackReason = 'LLM unavailable') {
  if (!comparisonEvidence || comparisonEvidence.status === ANALYSIS_STATUS.INSUFFICIENT_DATA) {
    return {
      status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
      summary: 'Insufficient comparable sensor data. Cannot perform pattern comparison.',
      reason: comparisonEvidence ? comparisonEvidence.reason : 'No sensor data available',
      cited_record_ids: [],
      evidence_based_observations: [],
      uncertainty_limitations: [
        'Insufficient active sensor channels for planar pattern comparison.',
        'Single-channel readings cannot establish multi-point pressure distribution.'
      ],
      evaluated_channels: Object.freeze(comparisonEvidence ? comparisonEvidence.active_channels || [] : []),
      missing_unmapped_channels: Object.freeze(comparisonEvidence ? comparisonEvidence.unmapped_or_missing_channels || [] : []),
      disclaimer: CLINICAL_DISCLAIMER,
      deterministic_evidence: comparisonEvidence,
      is_fallback: true,
      fallback_reason: fallbackReason
    };
  }

  const topMatch = comparisonEvidence.matches && comparisonEvidence.matches.length > 0
    ? comparisonEvidence.matches[0]
    : null;

  const matchId = topMatch ? (topMatch.source_record_id || topMatch.record_id) : null;
  const citations = matchId ? [matchId] : [];
  const observations = [];

  if (topMatch) {
    const patternStr = topMatch.pattern ? ` (${topMatch.pattern})` : '';
    observations.push(`Highest similarity match is ${matchId}${patternStr} with score ${(topMatch.similarity_score * 100).toFixed(1)}% (RMSD: ${topMatch.rmsd_distance}).`);

    // Top channel or regional deltas
    const deltas = topMatch.regional_deltas || topMatch.channel_deltas || {};
    const sortedDeltas = Object.entries(deltas).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const prominentDeltas = sortedDeltas.slice(0, 3).map(([ch, d]) => `${ch}: ${d > 0 ? '+' : ''}${d}`);
    if (prominentDeltas.length > 0) {
      observations.push(`Notable residual deltas against template: ${prominentDeltas.join(', ')}.`);
    }
  }

  const channelsOrRegionsCount = topMatch?.comparable_channel_count || comparisonEvidence.active_regions?.length || comparisonEvidence.active_channels?.length || 'active';

  return {
    status: ANALYSIS_STATUS.OK,
    summary: topMatch
      ? `Deterministic evaluation matches ${topMatch.pattern || matchId} with ${(topMatch.similarity_score * 100).toFixed(1)}% similarity across ${channelsOrRegionsCount} comparable units.`
      : 'Deterministic evaluation completed with no definitive template match.',
    cited_record_ids: Object.freeze(citations),
    rejected_citations_count: 0,
    evidence_based_observations: Object.freeze(observations),
    uncertainty_limitations: Object.freeze([
      `Analysis produced via deterministic fallback (${fallbackReason}).`,
      `Evaluated on ${comparisonEvidence.active_channel_count} active channels.`,
      'Outputs are numerical template comparisons, not medical diagnoses.'
    ]),
    evaluated_channels: Object.freeze(comparisonEvidence.active_channels || []),
    missing_unmapped_channels: Object.freeze(comparisonEvidence.unmapped_or_missing_channels || []),
    disclaimer: CLINICAL_DISCLAIMER,
    deterministic_evidence: comparisonEvidence,
    is_fallback: true,
    fallback_reason: fallbackReason
  };
}

/**
 * Test Mock Adapter for unit testing and offline development.
 * Allows simulating various LLM responses, errors, and invalid citations without external calls.
 */
class TestMockLLMAdapter extends BaseLLMAdapter {
  constructor(options = {}) {
    super();
    this.mode = options.mode || 'valid'; // 'valid' | 'hallucinate_citation' | 'invalid_json' | 'error' | 'unavailable'
    this.customResponse = options.customResponse || null;
  }

  setMode(mode, customResponse = null) {
    this.mode = mode;
    this.customResponse = customResponse;
  }

  async generateAnalysis({ sensorSummary, comparisonEvidence }) {
    if (this.mode === 'unavailable') {
      return generateDeterministicFallback(comparisonEvidence, 'Model service offline');
    }

    if (this.mode === 'error') {
      throw new Error('Simulated upstream network error from LLM provider');
    }

    if (this.mode === 'invalid_json') {
      return generateDeterministicFallback(comparisonEvidence, 'Model returned non-conforming schema');
    }

    if (this.mode === 'hallucinate_citation') {
      // Simulate an LLM attempting to cite an arbitrary uncited dataset record
      const fakeOutput = {
        summary: 'The reading strongly resembles an unverified historical case.',
        cited_record_ids: ['REC-FABRICATED-999', comparisonEvidence.matches[0]?.record_id].filter(Boolean),
        evidence_based_observations: ['High heel loading observed.'],
        uncertainty_limitations: ['Preliminary screening.']
      };
      return validateAndSanitizeModelOutput(fakeOutput, comparisonEvidence);
    }

    // Default 'valid' mode
    if (this.customResponse) {
      return validateAndSanitizeModelOutput(this.customResponse, comparisonEvidence);
    }

    if (!comparisonEvidence || comparisonEvidence.status === ANALYSIS_STATUS.INSUFFICIENT_DATA) {
      return generateDeterministicFallback(comparisonEvidence, 'Insufficient comparable data');
    }

    const top = comparisonEvidence.matches[0];
    const generated = {
      summary: `The pressure distribution demonstrates closest alignment to ${top.pattern} (${top.record_id}) with ${(top.similarity_score * 100).toFixed(1)}% pattern similarity.`,
      cited_record_ids: [top.record_id],
      evidence_based_observations: [
        `Calcaneus and metatarsal zones exhibit consistent loading relative to reference ${top.record_id}.`,
        `Root Mean Square Deviation across ${top.comparable_channel_count} channels is ${top.rmsd_distance}.`
      ],
      uncertainty_limitations: [
        'Velostat sensor piezoresistive response subject to non-linear hysteresis.',
        'Comparison limited to normalized relative distribution; physical pressure in kPa requires individual gauge calibration.'
      ]
    };

    return validateAndSanitizeModelOutput(generated, comparisonEvidence);
  }
}

/**
 * Server-side Environment-Aware LLM Adapter.
 * Reads API key strictly from environment. Fails safely if credentials are not configured.
 * Never leaks key into responses, logs, or error payloads.
 */
class ServerEnvLLMAdapter extends BaseLLMAdapter {
  constructor(envVarName = 'GEMINI_API_KEY') {
    super();
    this.envVarName = envVarName;
  }

  hasCredentials() {
    const key = process.env[this.envVarName] || process.env.LLM_API_KEY;
    return typeof key === 'string' && key.trim().length > 0;
  }

  async generateAnalysis({ sensorSummary, comparisonEvidence }) {
    if (!this.hasCredentials()) {
      // Clean, safe failure when no API key is present in environment
      return generateDeterministicFallback(
        comparisonEvidence,
        `No API key configured in server environment (${this.envVarName})`
      );
    }

    // In Phase 4, the real HTTPS client will be wired here on the backend.
    // For Phase 2 security boundary, we return safe deterministic fallback
    // and prevent unauthorized external leakage during test runs.
    return generateDeterministicFallback(
      comparisonEvidence,
      'Phase 4 server boundary not yet attached; using secure deterministic fallback'
    );
  }
}

module.exports = {
  BaseLLMAdapter,
  TestMockLLMAdapter,
  ServerEnvLLMAdapter,
  validateAndSanitizeModelOutput,
  generateDeterministicFallback
};
