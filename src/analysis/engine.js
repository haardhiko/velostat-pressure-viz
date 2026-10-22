/**
 * High-level Analysis Engine for Velostat Foot Pressure (Phase 2).
 * Integrates dataset ingestion, deterministic numerical comparison, and the LLM adapter boundary.
 */

const fs = require('fs');
const path = require('path');
const { validateReferenceDataset } = require('./dataset_validator');
const { compareSensorWithDataset } = require('./comparator');
const {
  TestMockLLMAdapter,
  ServerEnvLLMAdapter,
  generateDeterministicFallback
} = require('./llm_adapter');
const { ANALYSIS_STATUS, CLINICAL_DISCLAIMER } = require('./constants');

class AnalysisEngine {
  /**
   * @param {Object} options
   * @param {Object} options.llmAdapter BaseLLMAdapter instance (default: ServerEnvLLMAdapter)
   * @param {Object} options.defaultDataset Validated dataset object or filepath
   */
  constructor(options = {}) {
    this.llmAdapter = options.llmAdapter || new ServerEnvLLMAdapter();
    this.dataset = null;

    if (options.defaultDataset) {
      this.loadDataset(options.defaultDataset);
    }
  }

  /**
   * Loads and validates a reference dataset from file path or raw object.
   * @param {string|Object} source File path or raw dataset object
   * @returns {Object} Validation summary
   */
  loadDataset(source) {
    if (source && typeof source === 'object' && source.isValid && Array.isArray(source.valid_records)) {
      this.dataset = source;
      return source;
    }

    let raw;
    if (typeof source === 'string') {
      const fullPath = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Reference dataset file not found: ${fullPath}`);
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      raw = JSON.parse(content);
    } else if (typeof source === 'object' && source !== null) {
      raw = source;
    } else {
      throw new Error('Dataset source must be a file path string or object');
    }

    const validated = validateReferenceDataset(raw);
    this.dataset = validated;
    return validated;
  }

  /**
   * Analyzes an incoming sensor snapshot against the loaded reference dataset.
   * @param {Object} sensorSnapshot Raw or normalized sensor readings
   * @param {Object} options { minComparableChannels, topK }
   * @returns {Promise<Object>} Structured evidence-cited analysis result
   */
  async analyze(sensorSnapshot, options = {}) {
    if (!this.dataset || !this.dataset.isValid) {
      return {
        status: ANALYSIS_STATUS.INSUFFICIENT_DATA,
        summary: 'No valid reference dataset loaded in analysis engine.',
        cited_record_ids: [],
        evidence_based_observations: [],
        uncertainty_limitations: ['Analysis engine requires a validated reference dataset.'],
        evaluated_channels: [],
        missing_unmapped_channels: [],
        disclaimer: CLINICAL_DISCLAIMER,
        is_fallback: true
      };
    }

    // Step 1: Deterministic numerical comparison
    const comparisonEvidence = compareSensorWithDataset(
      sensorSnapshot,
      this.dataset,
      options
    );

    // If deterministic comparison found insufficient data, fail safely without invoking LLM
    if (comparisonEvidence.status === ANALYSIS_STATUS.INSUFFICIENT_DATA) {
      return generateDeterministicFallback(
        comparisonEvidence,
        comparisonEvidence.reason
      );
    }

    // Step 2: Extract minimal, non-sensitive sensor summary for the LLM
    const sensorSummary = {
      active_channel_count: comparisonEvidence.active_channel_count,
      active_channels: comparisonEvidence.active_channels,
      unmapped_channel_count: comparisonEvidence.unmapped_or_missing_channels.length,
      top_match_pattern: comparisonEvidence.matches[0]?.pattern,
      top_match_score: comparisonEvidence.matches[0]?.similarity_score
    };

    // Step 3: Call narrow LLM adapter boundary
    try {
      const result = await this.llmAdapter.generateAnalysis({
        sensorSummary,
        comparisonEvidence
      });
      return result;
    } catch (err) {
      // Safe fallback if adapter encounters an unhandled exception
      return generateDeterministicFallback(
        comparisonEvidence,
        `LLM adapter exception: ${err.message}`
      );
    }
  }
}

module.exports = {
  AnalysisEngine
};
