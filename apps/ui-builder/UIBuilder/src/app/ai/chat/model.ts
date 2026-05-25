import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

import type { AIProviderID } from '@open-pencil/core/constants'
import { apiKey as storedApiKey } from '@/app/ai/chat/storage'

/**
 * Custom OpenRouter LanguageModel using Tauri invoke proxy (Rust-backed HTTP).
 * Always attempts invoke first, falls back to window.fetch on failure.
 * No IS_TAURI check — invoke either works or it doesn't.
 */
let invokeFn: ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null = null
let proxyReady: boolean | null = null

async function ensureProxy(): Promise<boolean> {
  if (proxyReady !== null) return proxyReady
  try {
    const core = await import('@tauri-apps/api/core')
    invokeFn = core.invoke
    proxyReady = true
    return true
  } catch {
    proxyReady = false
    return false
  }
}

async function proxyChatCompletion(
  apiKey: string,
  baseURL: string,
  body: Record<string, unknown>
): Promise<Response> {
  if (await ensureProxy()) {
    // Use Rust-native HTTP proxy — no webview interference
    const fn = invokeFn
    if (!fn) {
      // invoke not initialized, fallback
      return fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    }
    const result = await fn('proxy_http_request', {
      url: `${baseURL}/chat/completions`,
      method: 'POST',
      headers: [
        ['Authorization', `Bearer ${apiKey}`],
        ['Content-Type', 'application/json'],
      ],
      body: JSON.stringify(body),
    }) as { status: number; headers: string[][]; body: string }

    return new Response(result.body, {
      status: result.status,
      headers: Object.fromEntries(
        result.headers.map(([k, v]: string[]) => [k, v])
      ),
    })
  }
  // Fallback: browser fetch
  return fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}
function createDirectOpenRouterModel(apiKey: string, modelId: string): LanguageModel {
  const baseURL = 'https://openrouter.ai/api/v1'

  function buildMessages(prompt: { role: string; content: unknown }[]) {
    return prompt.map((msg) => {
      let content = ''
      if (Array.isArray(msg.content)) {
        content = msg.content
          .map((p: { type?: string; text?: string }) => { const t = p.text; return p.type === 'text' && t ? t : ''; })
          .join('')
      } else if (typeof msg.content === 'string') {
        content = msg.content
      }
      return { role: msg.role, content }
    })
  }

  return {
    specificationVersion: 'v3',
    provider: 'openrouter.chat',
    modelId,
    defaultObjectGenerationMode: 'tool',
    supportsImageUrls: true,
    supportedUrls: {},

    async doGenerate(options: {
      prompt: { role: string; content: unknown }[];
      maxOutputTokens?: number;
      temperature?: number;
      abortSignal?: AbortSignal;
    }) {
      const body = {
        model: modelId,
        messages: buildMessages(options.prompt),
        max_tokens: options.maxOutputTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        stream: false,
      }
      const response = await proxyChatCompletion(apiKey, baseURL, body)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error?.message || `HTTP ${response.status}: ${JSON.stringify(data).slice(0,200)}`)
      }
      const choice = data.choices?.[0]
      return {
        content: [{ type: 'text' as const, text: choice?.message?.content || '' }],
        finishReason: { unified: (choice?.finish_reason || 'stop') as 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown', raw: undefined },
        usage: {
          inputTokens: { total: data.usage?.prompt_tokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: data.usage?.completion_tokens, text: undefined, reasoning: undefined },
        },
        response: { headers: {}, body: data },
        warnings: [],
      }
    },

    async doStream(options: {
      prompt: { role: string; content: unknown }[];
      maxOutputTokens?: number;
      temperature?: number;
      abortSignal?: AbortSignal;
    }) {
      const body = {
        model: modelId,
        messages: buildMessages(options.prompt),
        max_tokens: options.maxOutputTokens ?? 4096,
        temperature: options.temperature ?? 0.7,
        stream: true,
        stream_options: { include_usage: true },
      }
      const response = await proxyChatCompletion(apiKey, baseURL, body)
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error?.message || `HTTP ${response.status}`)
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let buffer = ''
      let usage: Record<string, number> | undefined = undefined

      const stream = new ReadableStream({
        async pull(controller) {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) {
              controller.enqueue({
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: undefined },
                usage: {
                  inputTokens: { total: usage?.prompt_tokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: usage?.completion_tokens, text: undefined, reasoning: undefined },
                },
              })
              controller.close()
              return
            }
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const json = line.slice(6).trim()
              if (json === '[DONE]') continue
              try {
                const parsed = JSON.parse(json)
                if (parsed.usage) usage = parsed.usage
                const delta = parsed.choices?.[0]?.delta?.content
                if (delta) {
                  controller.enqueue({ type: 'text-delta' as const, id: '0', delta })
                }
              } catch (e) {
                console.warn('[Stream] Parse error', e)
              }
            }
          }
        },
      })

      return {
        stream,
        request: { body },
        response: { headers: {} },
      }
    },
  } as LanguageModel
}

export type ModelConfig = {
  providerID: AIProviderID
  apiKey: string
  modelID: string
  customModelID: string
  customBaseURL: string
  customAPIType: 'completions' | 'responses'
}

export function resolveLanguageModelID(
  config: Pick<ModelConfig, 'providerID' | 'modelID' | 'customModelID'>
) {
  const customModelID = config.customModelID.trim()
  if (config.providerID === 'openrouter') return customModelID || config.modelID
  if (config.providerID === 'openai-compatible' || config.providerID === 'anthropic-compatible') {
    return customModelID
  }
  return config.modelID
}

export function createLanguageModel(config: ModelConfig): LanguageModel {
  const effectiveModelID = resolveLanguageModelID(config)

  switch (config.providerID) {
    case 'openrouter': {
      const key = storedApiKey.value
      if (!key) throw new Error('[Hermes] API key is empty')
      return createDirectOpenRouterModel(key, effectiveModelID)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: storedApiKey.value })
      return anthropic(effectiveModelID)
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey: config.apiKey })
      return openai(effectiveModelID)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: config.apiKey })
      return google(effectiveModelID)
    }
    case 'deepseek': {
      const deepseek = createDeepSeek({ apiKey: config.apiKey })
      return deepseek(effectiveModelID)
    }
    case 'zai': {
      const zai = createAnthropic({
        apiKey: config.apiKey,
        baseURL: 'https://api.z.ai/api/anthropic'
      })
      return zai(effectiveModelID)
    }
    case 'minimax': {
      const minimax = createOpenAI({
        apiKey: config.apiKey,
        baseURL: 'https://api.minimax.io/v1'
      })
      return minimax.chat(effectiveModelID)
    }
    case 'openai-compatible': {
      const custom = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.customBaseURL
      })
      return config.customAPIType === 'responses'
        ? custom.responses(effectiveModelID)
        : custom.chat(effectiveModelID)
    }
    case 'anthropic-compatible': {
      const custom = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.customBaseURL
      })
      return custom(effectiveModelID)
    }
    default: {
      if (config.providerID.startsWith('acp:')) {
        throw new Error('ACP providers do not use direct API models')
      }
      throw new Error(`Unknown provider: ${config.providerID}`)
    }
  }
}
