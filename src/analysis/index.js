/**
 * Velostat Foot Pressure Analysis Layer (Phase 2)
 * Module index exporting validators, dataset adapters, comparators, and LLM/NIM adapter boundaries.
 */

const constants = require('./constants');
const { validateReferenceDataset, DatasetValidationError } = require('./dataset_validator');
const { compareSensorWithDataset, normalizeSensorSnapshot } = require('./comparator');
const {
  COMPARISON_POLICIES,
  PHASE1_REGION_MAP,
  aggregateToFourRegions,
  compareRegionalSnapshot
} = require('./regional_comparator');
const {
  ADAPTER_STATUS,
  PRODUCT_REGIONS,
  createSharedRecord,
  BaseDatasetAdapter
} = require('./adapters/base_adapter');
const { ParkinsonsVgrfAdapter, SENSOR_COORDINATES, REGION_SENSOR_MAP } = require('./adapters/parkinsons_vgrf_adapter');
const { GaitRiteInsoleAdapter } = require('./adapters/gaitrite_insole_adapter');
const { FsrMatrixAdapter } = require('./adapters/fsr_matrix_adapter');
const { NeurodegenerativeDbAdapter, decodeFormat212 } = require('./adapters/neurodegenerative_db_adapter');
const {
  BaseLLMAdapter,
  TestMockLLMAdapter,
  ServerEnvLLMAdapter,
  validateAndSanitizeModelOutput,
  generateDeterministicFallback
} = require('./llm_adapter');
const {
  BaseNIMAdapter,
  ServerEnvNIMAdapter: ServerEnvNIMAdapterClass,
  TestMockNIMAdapter,
  validateAndSanitizeNIMOutput
} = require('./nvidia_nim_adapter');
const { AnalysisEngine } = require('./engine');

module.exports = {
  ...constants,
  // Validation & 15-sensor comparison
  validateReferenceDataset,
  DatasetValidationError,
  compareSensorWithDataset,
  normalizeSensorSnapshot,

  // Four-Region Mapping & Comparison
  COMPARISON_POLICIES,
  PHASE1_REGION_MAP,
  aggregateToFourRegions,
  compareRegionalSnapshot,

  // Base dataset adapters & shared schema
  ADAPTER_STATUS,
  PRODUCT_REGIONS,
  createSharedRecord,
  BaseDatasetAdapter,

  // Specific dataset adapters
  ParkinsonsVgrfAdapter,
  SENSOR_COORDINATES,
  REGION_SENSOR_MAP,
  GaitRiteInsoleAdapter,
  FsrMatrixAdapter,
  NeurodegenerativeDbAdapter,
  decodeFormat212,

  // LLM & NIM boundaries
  BaseLLMAdapter,
  TestMockLLMAdapter,
  ServerEnvLLMAdapter,
  validateAndSanitizeModelOutput,
  generateDeterministicFallback,
  BaseNIMAdapter,
  ServerEnvNIMAdapter: ServerEnvNIMAdapterClass,
  TestMockNIMAdapter,
  validateAndSanitizeNIMOutput,

  // High-level engine
  AnalysisEngine
};
