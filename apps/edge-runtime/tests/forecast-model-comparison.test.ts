// @ts-nocheck
import assert from 'node:assert'
import {
  DEFAULT_CHALLENGER_MODEL_NAME,
  DEFAULT_PRODUCTION_MODEL_NAME,
  getDefaultForecastModelPolicy,
  runForecastModelComparison,
  resolveForecastModelDefaults,
} from '../src/lib/forecast-model-comparison'

function syntheticTrendingSeasonalPoints(count = 56) {
  const points = []
  for (let i = 0; i < count; i += 1) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
    const weekly = [0, 4, -3, 6, -2, 3, -4][i % 7]
    const deterministicNoise = ((i * 7) % 5) - 2
    points.push({
      tenant_id: 'tenant-a',
      series_id: 'daily',
      metric_name: 'lead_submissions',
      ds: day,
      value: 100 + i * 2 + weekly + deterministicNoise,
      source: 'synthetic',
      metadata_json: '{}',
      created_at: day,
      updated_at: day,
    })
  }
  return points
}

test('forecast model comparison ranks Chronos-2, TimesFM 2.5, and baselines', () => {
  const result = runForecastModelComparison(syntheticTrendingSeasonalPoints(), {
    horizon: 7,
    minTrainPoints: 21,
    minTestPoints: 7,
    stepSize: 7,
    models: ['seasonal_naive', 'moving_average', 'chronos2', 'timesfm_2_5'],
    primaryMetric: 'mae',
  })

  assert.strictEqual(result.winner?.model, 'timesfm_2_5')
  assert.strictEqual(result.winner?.rank, 1)
  assert.deepStrictEqual(
    result.models.map(entry => entry.model),
    ['timesfm_2_5', 'seasonal_naive', 'moving_average', 'chronos2'],
  )
  assert.ok(result.winner?.metrics.mae < 10)
})

test('default forecast policy uses TimesFM 2.5 as production and Chronos-2 as challenger', () => {
  const policy = getDefaultForecastModelPolicy()

  assert.strictEqual(policy.productionModel, DEFAULT_PRODUCTION_MODEL_NAME)
  assert.strictEqual(policy.challengerModel, DEFAULT_CHALLENGER_MODEL_NAME)
  assert.deepStrictEqual(policy.baselineModels, ['seasonal_naive', 'moving_average'])
  assert.deepStrictEqual(policy.comparisonModels, ['seasonal_naive', 'moving_average', 'chronos2', 'timesfm_2_5'])
})

test('model defaults resolve Chronos-2 and TimesFM 2.5 separately', () => {
  assert.deepStrictEqual(resolveForecastModelDefaults('chronos2'), {
    modelName: 'chronos2',
    modelVersion: '1.0.0',
    checkpoint: 'amazon/chronos-2',
  })
  assert.deepStrictEqual(resolveForecastModelDefaults(), {
    modelName: 'timesfm_2_5',
    modelVersion: '2.5',
    checkpoint: 'timesfm-2.5',
  })
})

test('forecast model comparison normalizes model names', () => {
  const result = runForecastModelComparison(syntheticTrendingSeasonalPoints(), {
    horizon: 5,
    minTrainPoints: 20,
    minTestPoints: 5,
    stepSize: 5,
    models: ['Chronos-2', 'TimesFM 2.5'],
    primaryMetric: 'rmse',
  })

  assert.deepStrictEqual(
    result.models.map(entry => entry.model),
    ['timesfm2.5', 'chronos-2'],
  )
  assert.strictEqual(result.winner?.status, 'success')
})

test('forecast model comparison keeps failed models in the report', () => {
  const result = runForecastModelComparison(syntheticTrendingSeasonalPoints(10), {
    horizon: 7,
    models: ['timesfm_2_5'],
  })

  assert.strictEqual(result.models.length, 1)
  assert.strictEqual(result.models[0].status, 'failed')
  assert.ok(result.models[0].error.includes('requires at least'))
  assert.strictEqual(result.winner, undefined)
})
