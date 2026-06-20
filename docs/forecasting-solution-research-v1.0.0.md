---
name: EdgeGDE_Forecasting_Solution_Research_v1_0_0
version: "1.0.0"
status: research_in_progress
owner: Hermes
created_at: "2026-06-19"
last_researched_at: "2026-06-19"
---

# EdgeGDE Forecasting Solution Research v1.0.0

## 0. Decision Status

TimesFM 2.5 is NOT confirmed.

TimesFM 2.5 is a candidate only.

No forecasting model is locked for EdgeGDE v1.0.0.

The current recommendation is to build a forecasting evaluation layer first, then select a model by backtest against EdgeGDE data.

## 1. Research Objective

Find the best forecasting approach for EdgeGDE by comparing candidate solutions against:

- accuracy
- latency
- cost
- tenant isolation
- operational complexity
- explainability
- covariate support
- uncertainty support
- backtesting support
- deployment fit
- maintenance burden
- support model
- compatibility with EdgeGDE's deterministic projection architecture

## 2. EdgeGDE Forecasting Context

EdgeGDE is:

- Cloudflare Workers based
- Hono + TypeScript
- tenant-isolated
- D1/KV/R2/Durable Object based
- deterministic-core plus AI-overlay
- queue-driven for async work
- append-only audit ledged
- pointer-pattern KV
- not designed to host large ML runtimes inside Workers

Therefore, forecasting should be treated as:

- async
- tenant-scoped
- audit-backed
- versioned
- projection-based
- not authoritative truth

## 3. Research Summary

The best fit for EdgeGDE is not a single model. The best fit is a forecasting evaluation and projection layer that can run multiple candidate models and promote the best one by backtest.

The architecture should be:

Queue job -> external inference service -> forecast output -> D1 forecast projections -> KV latest pointer -> AuditLedger event -> dashboard read path

EdgeGDE Workers should not host TimesFM, Chronos, Moirai, or any other large forecasting model directly.

## 4. Candidate Landscape

### 4.1 Baseline statistical models

Candidates:

- seasonal naive
- moving average
- exponential smoothing
- ARIMA / AutoARIMA
- SARIMAX
- ETS
- Theta
- MSTL

Useful sources/tools:

- StatsForecast
- statsmodels
- Forecasting: Principles and Practice
- Darts

EdgeGDE fit:

- excellent for v1.0.0
- cheap
- deterministic
- explainable
- easy to run in an external worker/container
- good baseline for proving whether ML/foundation models add value

Risks:

- weaker with complex covariates
- weaker with many non-stationary series
- may need manual feature engineering for events, campaigns, and regime shifts

### 4.2 Machine learning models with lag features

Candidates:

- MLForecast
- XGBoost / LightGBM with lag features
- scikit-learn pipelines
- random forest / gradient boosting
- conformal prediction intervals

Useful sources/tools:

- Nixtla MLForecast
- Darts
- sktime

EdgeGDE fit:

- strong if EdgeGDE has useful covariates
- good for tenant-level and segment-level series
- more controllable than foundation models
- easier to explain than deep models
- good production candidate

Risks:

- requires feature engineering discipline
- needs proper rolling-origin validation
- can leak future information if covariates are not guarded

### 4.3 Neural forecasting models

Candidates:

- N-BEATS
- N-HiTS
- TFT
- DeepAR-style models
- PyTorch Forecasting
- NeuralForecast
- Darts

Useful sources/tools:

- Nixtla NeuralForecast
- PyTorch Forecasting
- Darts

EdgeGDE fit:

- useful if there are many related series and enough history
- good when covariates and seasonality are complex
- better than simple baselines when data volume supports training

Risks:

- heavier than EdgeGDE should host directly
- harder to debug
- requires training/evaluation pipeline
- can overfit small tenant series

### 4.4 Foundation time-series models

Candidates:

- TimesFM 2.5
- Chronos-2
- Chronos-Bolt
- Moirai / Uni2TS

Useful sources/tools:

- TimesFM 2.5 PyTorch checkpoint
- BigQuery ML TimesFM
- Chronos-2
- Moirai

EdgeGDE fit:

- useful as async external inference
- not suitable inside Cloudflare Workers
- must be evaluated against baselines
- should never be treated as authoritative truth

Risks:

- operational complexity
- inference cost
- model/version governance
- covariate behavior varies by model
- open checkpoints may not be officially supported

### 4.5 Managed forecasting services

Candidates:

- BigQuery ML TimesFM
- Amazon Forecast
- SageMaker deployment for Chronos-2

Useful sources/tools:

- BigQuery ML TimesFM docs
- Amazon Forecast docs

EdgeGDE fit:

- best if the user already wants a managed cloud analytics backend
- reduces model ops burden
- still needs EdgeGDE projection and audit layer

Risks:

- vendor lock-in
- cost
- data movement
- latency
- privacy review

## 5. Source Notes

### TimesFM 2.5

Source:

- https://github.com/google-research/timesfm
- https://huggingface.co/google/timesfm-2.5-200m-pytorch
- https://cloud.google.com/bigquery/docs/timesfm-model

Observed facts:

- TimesFM is a pretrained time-series foundation model from Google Research.
- The open Hugging Face checkpoint is the third open model checkpoint.
- The open checkpoint is not an officially supported Google product.
- BigQuery ML provides the officially supported TimesFM path.
- BigQuery states TimesFM forecast results are comparable to conventional statistical methods such as ARIMA.
- BigQuery recommends ARIMA_PLUS or ARIMA_PLUS_XREG when more tuning options are needed.

Implication for EdgeGDE:

TimesFM 2.5 is a strong candidate, but not the default winner.

### Chronos-2

Source:

- https://huggingface.co/amazon/chronos-2
- https://github.com/amazon-science/chronos-forecasting

Observed facts:

- Chronos-2 is a 120M-parameter encoder-only time-series foundation model.
- It supports univariate, multivariate, and covariate-informed tasks.
- It produces multi-step quantile forecasts.
- It supports GPU and CPU inference.
- It is Apache 2.0.
- The model card says it is efficient and supports real-time, serverless, or batch inference on AWS.

Implication for EdgeGDE:

Chronos-2 is currently one of the strongest self-hosted foundation model candidates to benchmark, especially if covariate-informed forecasting matters.

### Moirai / Uni2TS

Source:

- https://huggingface.co/Salesforce/moirai-1.0-R-small
- https://github.com/SalesforceAIResearch/uni2ts

Observed facts:

- Moirai is a universal time-series forecasting transformer.
- The model card says it is pre-trained on LOTSA data.
- The release is marked for research purposes only.
- The license shown is CC-BY-NC-4.0.

Implication for EdgeGDE:

Moirai is interesting for research, but not a production recommendation without legal/commercial review.

### MLForecast

Source:

- https://nixtlaverse.nixtla.io/mlforecast/index.html

Observed facts:

- MLForecast is for scalable machine learning time-series forecasting.
- It supports exogenous variables and static covariates.
- It supports probabilistic forecasting with conformal prediction.
- It has familiar sklearn-style fit/predict syntax.
- It supports pandas, polars, spark, dask, and ray.

Implication for EdgeGDE:

MLForecast is a strong practical candidate for production because it handles covariates and scales without requiring a foundation model.

### StatsForecast

Source:

- https://nixtlaverse.nixtla.io/statsforecast/index.html

Observed facts:

- StatsForecast provides statistical and econometric models.
- It includes AutoARIMA, AutoETS, AutoCES, MSTL, Theta, baseline models, and exponential smoothing.
- It supports exogenous variables and probabilistic forecasting.
- It supports Spark, Dask, and Ray.
- It positions itself as fast statistical forecasting.

Implication for EdgeGDE:

StatsForecast is a strong baseline and production candidate for simple/medium complexity forecasting.

### Darts

Source:

- https://unit8co.github.io/darts/

Observed facts:

- Darts is a Python library for forecasting and anomaly detection.
- It contains models from classic ARIMA to deep neural networks.
- It supports backtesting, ensembles, external data, univariate and multivariate series, and probabilistic forecasting.

Implication for EdgeGDE:

Darts is useful as a flexible evaluation and experimentation framework.

### Prophet

Source:

- https://facebook.github.io/prophet/

Observed facts:

- Prophet is a forecasting procedure implemented in R and Python.
- It is fast and provides automated forecasts that can be tuned by hand.
- It emphasizes interpretability and holiday/seasonality handling.

Implication for EdgeGDE:

Prophet is acceptable as a baseline, but not the preferred modern production choice unless explainability and holiday effects are the dominant requirement.

### Amazon Forecast

Source:

- https://docs.aws.amazon.com/forecast/latest/dg/what-is-forecast.html

Observed facts:

- Amazon Forecast is a managed service.
- The docs state it is no longer available to new customers.

Implication for EdgeGDE:

Do not recommend Amazon Forecast for new EdgeGDE implementations.

### sktime

Source:

- https://www.sktime.net/en/stable/

Observed facts:

- sktime is a unified framework for machine learning with time series.
- It supports forecasting, classification, regression, and clustering.

Implication for EdgeGDE:

sktime is a good evaluation framework, not a single forecasting solution.

## 6. Preliminary Ranking for EdgeGDE

This ranking is provisional because EdgeGDE data shape and workload are not yet known.

### 6.1 Best first implementation

Rank 1: StatsForecast + MLForecast baseline harness

Why:

- lowest risk
- low cost
- strong operational fit
- supports baselines, statistical models, ML models, covariates, and probabilistic intervals
- easy to compare against foundation models later

### 6.2 Best managed option

Rank 1: BigQuery ML TimesFM

Why:

- official Google support path
- no self-hosting burden
- simple if EdgeGDE already exports analytics to BigQuery

Caveat:

- requires GCP/data movement
- still needs EdgeGDE projection and audit layer

### 6.3 Best foundation model candidate to benchmark

Rank 1: Chronos-2

Why:

- smaller than TimesFM 2.5
- supports covariate-informed tasks natively
- supports CPU and GPU inference
- Apache 2.0
- strong zero-shot claims
- production deployment path on AWS/SageMaker

Caveat:

- still needs backtesting on EdgeGDE data

### 6.4 TimesFM 2.5

Rank: candidate, not winner

Why:

- strong general-purpose model
- BigQuery has official support
- open checkpoint exists

Caveats:

- open checkpoint is not officially supported by Google
- BigQuery says TimesFM is comparable to ARIMA, not categorically superior
- must be evaluated against baselines
- not suitable inside Cloudflare Workers

### 6.5 Moirai / Uni2TS

Rank: research-only for now

Why:

- interesting architecture
- supports universal time-series forecasting

Caveats:

- CC-BY-NC-4.0 license
- research-purpose language
- not a production recommendation without legal/commercial review

## 7. Recommended Research Path

Phase 1: Define EdgeGDE forecasting targets.

Required decisions:

- what to forecast
- tenant-level vs series-level
- frequency
- horizon
- minimum history
- acceptable latency
- cost ceiling
- explainability requirement
- privacy constraints

Phase 2: Build the evaluation harness.

Minimum candidates:

- seasonal naive
- moving average
- StatsForecast AutoETS / AutoARIMA
- MLForecast with lag features
- optional Chronos-2
- optional TimesFM 2.5 / BigQuery TimesFM

Phase 3: Backtest.

Use rolling-origin validation.

Metrics:

- WAPE
- WMAE
- MAE
- RMSE
- bias
- sMAPE
- quantile coverage
- calibration
- business cost function

Phase 4: Promote by segment.

Do not force one model globally.

Promotion can be:

- per tenant
- per metric
- per horizon
- per segment
- per series class

Phase 5: Store forecasts as projections.

Forecast outputs must include:

- forecast_run_id
- tenant_id
- metric_name
- model_name
- model_version
- checkpoint
- config_hash
- input_snapshot
- generated_at
- horizon
- p10/p50/p90
- point_forecast
- evaluation metrics
- validity window

## 8. Current Recommendation

Do not select TimesFM 2.5 yet.

Do not select any final forecasting model yet.

The correct next step is to build a forecasting evaluation harness and benchmark candidates against EdgeGDE data.

For EdgeGDE v1.0.0, the safest recommendation is:

- use EdgeGDE D1 as the source projection for historical series
- use an external async forecasting service for model execution
- start with StatsForecast + MLForecast baselines
- benchmark Chronos-2 as the leading foundation-model candidate
- benchmark BigQuery ML TimesFM only if GCP/BigQuery is already part of the stack
- keep TimesFM 2.5 as a candidate, not the selected solution
- store all outputs as materialized projections, never as truth

## 9. Open Questions

- What exact metric should EdgeGDE forecast first?
- Is the first forecast tenant-level or global?
- What is the required horizon?
- What is the minimum history available per series?
- Are covariates available?
- Is GCP/BigQuery allowed?
- Is AWS/SageMaker allowed?
- Is CPU-only inference required?
- Are forecasts used for dashboards only, or do they influence decisions?
- What is the maximum acceptable inference cost per run?
- What retention period is required for forecast runs?

## 10. Decision Gate

A forecasting solution can be selected only after:

- the target metric is defined
- a backtest dataset exists
- at least 3 candidate approaches are compared
- business cost metrics are defined
- privacy review is complete
- deployment path is proven
- forecast outputs are stored as versioned materialized projections
