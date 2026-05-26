import { kv } from '../index'
import type { KvStore } from './publish'
import type { TelemetryEvent } from './telemetry'

export interface MetricsPayload {
  requests_per_minute: number
  avg_latency_ms: number
  p95_latency_ms: number
  error_rate_percent: number
  total_429_responses: number
  tool_usage_counts: Record<string, number>
  agent_request_ratio: number
}

export async function getEdgeMetrics(kvStore?: KvStore): Promise<MetricsPayload> {
  const store = kvStore ?? kv

  const logKeys = await store.list('log:')
  const logs: TelemetryEvent[] = []
  for (const { name } of logKeys.keys) {
    const raw = await store.get(name)
    if (raw) {
      try {
        logs.push(JSON.parse(raw))
      } catch { }
    }
  }

  const n = logs.length
  const windowSec = 60
  const rpm = n / (windowSec / 60)

  let avgLatency = 0
  let p95Latency = 0
  let errorRate = 0
  let total429 = 0
  let agentRatio = 0
  const toolCounts: Record<string, number> = {}

  if (n > 0) {
    const sorted = [...logs].sort((a, b) => a.durationMs - b.durationMs)
    const p95Index = Math.ceil(n * 0.95) - 1

    avgLatency = logs.reduce((s, l) => s + l.durationMs, 0) / n
    p95Latency = sorted[Math.max(0, p95Index)].durationMs
    errorRate = (logs.filter(l => l.statusCode >= 400).length / n) * 100
    total429 = logs.filter(l => l.statusCode === 429).length

    for (const l of logs) {
      const toolId = l.data?.toolId as string | undefined
      if (toolId) {
        toolCounts[toolId] = (toolCounts[toolId] || 0) + 1
      }
    }

    const agentRequests = logs.filter(l => l.data?.isAgentRequest === true).length
    agentRatio = (agentRequests / n) * 100
  }

  return {
    requests_per_minute: Math.round(rpm * 100) / 100,
    avg_latency_ms: Math.round(avgLatency * 100) / 100,
    p95_latency_ms: Math.round(p95Latency * 100) / 100,
    error_rate_percent: Math.round(errorRate * 100) / 100,
    total_429_responses: total429,
    tool_usage_counts: toolCounts,
    agent_request_ratio: Math.round(agentRatio * 100) / 100,
  }
}
