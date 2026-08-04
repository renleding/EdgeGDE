/**
 * EdgeGDE — Forecast Model Comparison
 *
 * Telemetry & Analytics v1.1:
 * Deterministic backtest comparison for baselines and model adapters.
 *
 * Important:
 * Chronos-2 and TimesFM 2.5 are represented here as deterministic local
 * adapters until a live inference endpoint is configured. The comparison
 * framework, ranking, and promotion gates are production-ready; the adapters
 * can be swapped for real inference calls without changing the evaluation API.
 */

import {
  runMetricSeriesBacktest,
  type BacktestConfig,
  type BacktestResult,
  type MetricPoint,
} from './metric-series'

export type ForecastModelName =
  | 'seasonal_naive'
  | 'moving_average'
  | 'chronos2'
  | 'chronos-2'
  | 'timesfm_2_5'
  | 'timesfm2.5'
  | 'timesfm25'
  | string

export const DEFAULT_PRODUCTION_MODEL_NAME = 'timesfm_2_5'
export const DEFAULT_CHALLENGER_MODEL_NAME = 'chronos2'
export const DEFAULT_MODEL_COMPARISON_MODELS: ForecastModelName[] = [
  'seasonal_naive',
  'moving_average',
  DEFAULT_CHALLENGER_MODEL_NAME,
  DEFAULT_PRODUCTION_MODEL_NAME,
]

export interface ForecastModelPolicy {
  productionModel: string
  challengerModel: string
  baselineModels: string[]
  comparisonModels: string[]
  primaryMetric: 'mae' | 'rmse' | 'smape' | 'mape'
}

export interface ForecastModelDefaults {
  modelName: string
  modelVersion: string
  checkpoint: string
}

export interface ForecastModelComparisonConfig {
  horizon?: number
  models?: ForecastModelName[]
  primaryMetric?: 'mae' | 'rmse' | 'smape' | 'mape'
  quantiles?: number[]
  minTrainPoints?: number
  minTestPoints?: number
  stepSize?: number
  movingAverageWindow?: number
}

export interface ForecastModelComparisonEntry {
  model: string
  status: 'success' | 'failed'
  rank?: number
  metrics?: BacktestResult['metrics']
  result?: BacktestResult
  error?: string
  runtimeMs: number
}

export interface ForecastModelComparisonResult {
  models: ForecastModelComparisonEntry[]
  winner?: ForecastModelComparisonEntry
  primaryMetric: 'mae' | 'rmse' | 'smape' | 'mape'
  generatedAt: string
}

export function getDefaultForecastModelPolicy(): ForecastModelPolicy {
  return {
    productionModel: DEFAULT_PRODUCTION_MODEL_NAME,
    challengerModel: DEFAULT_CHALLENGER_MODEL_NAME,
    baselineModels: ['seasonal_naive', 'moving_average'],
    comparisonModels: DEFAULT_MODEL_COMPARISON_MODELS.map(normalizeForecastModelName),
    primaryMetric: 'mae',
  }
}

export function resolveForecastModelDefaults(modelName?: string): ForecastModelDefaults {
  const normalized = normalizeForecastModelName(modelName || DEFAULT_PRODUCTION_MODEL_NAME)
  if (normalized === 'chronos2' || normalized === 'chronos-2') {
    return {
      modelName: 'chronos2',
      modelVersion: '1.0.0',
      checkpoint: 'amazon/chronos-2',
    }
  }
  return {
    modelName: DEFAULT_PRODUCTION_MODEL_NAME,
    modelVersion: '2.5',
    checkpoint: 'timesfm-2.5',
  }
}

export function normalizeForecastModelName(model: ForecastModelName): string {
  return String(model || 'seasonal_naive')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
}

export function runForecastModelComparison(
  points: MetricPoint[],
  config: ForecastModelComparisonConfig = {},
): ForecastModelComparisonResult {
  const primaryMetric = config.primaryMetric || 'mae'
  const models = config.models && config.models.length > 0
    ? config.models
    : DEFAULT_MODEL_COMPARISON_MODELS
  const startedAt = Date.now()

  const entries = models.map(model => {
    const modelStartedAt = Date.now()
    try {
      const backtestConfig: BacktestConfig = {
        horizon: config.horizon || 1,
        quantiles: config.quantiles,
        minTrainPoints: config.minTrainPoints,
        minTestPoints: config.minTestPoints,
        stepSize: config.stepSize,
        movingAverageWindow: config.movingAverageWindow,
        model,
      }
      const result = runMetricSeriesBacktest(points, backtestConfig)
      return {
        model: normalizeForecastModelName(model),
        status: 'success' as const,
        metrics: result.metrics,
        result,
        runtimeMs: Date.now() - modelStartedAt,
      }
    } catch (err: any) {
      return {
        model: normalizeForecastModelName(model),
        status: 'failed' as const,
        error: err.message,
        runtimeMs: Date.now() - modelStartedAt,
      }
    }
  })

  const successful = entries.filter(entry => entry.status === 'success' && entry.metrics)
  successful.sort((a, b) => {
    const aMetric = Number(a.metrics?.[primaryMetric] ?? Number.POSITIVE_INFINITY)
    const bMetric = Number(b.metrics?.[primaryMetric] ?? Number.POSITIVE_INFINITY)
    if (aMetric !== bMetric) return aMetric - bMetric
    return a.model.localeCompare(b.model)
  })
  successful.forEach((entry, index) => {
    (entry as ForecastModelComparisonEntry).rank = index + 1
  })

  const ranked = [...successful, ...entries.filter(entry => entry.status === 'failed')]
  const winner = ranked.find(entry => entry.status === 'success')

  return {
    models: ranked,
    winner,
    primaryMetric,
    generatedAt: new Date().toISOString(),
  }
}

export function getComparisonRuntimeMs(result: ForecastModelComparisonResult): number {
  const generated = Date.parse(result.generatedAt)
  if (!Number.isFinite(generated)) return 0
  return Math.max(0, generated - (Date.now() - 1))
}
