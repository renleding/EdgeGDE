/**
 * EdgeGDE — SSE Broadcast Module
 * In-memory subscriber set for real-time hot lead alerts.
 * Module-level state is shared within the same Worker isolate.
 *
 * @packageDocumentation
 */

interface SseSubscriber {
  writer: WritableStreamDefaultWriter
  tenantId: string
  connectedAt: number
}

const subscribers = new Set<SseSubscriber>()

/** Add an SSE subscriber for a given tenant */
export function addSubscriber(writer: WritableStreamDefaultWriter, tenantId: string): void {
  subscribers.add({ writer, tenantId, connectedAt: Date.now() })
}

/** Remove an SSE subscriber */
export function removeSubscriber(writer: WritableStreamDefaultWriter): void {
  for (const sub of subscribers) {
    if (sub.writer === writer) {
      subscribers.delete(sub)
      break
    }
  }
}

/** Broadcast an event to all subscribers for a given tenant */
export function broadcast(tenantId: string, event: string, data: unknown): void {
  const encoder = new TextEncoder()
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const encoded = encoder.encode(message)

  for (const sub of subscribers) {
    if (sub.tenantId !== tenantId) continue
    try {
      sub.writer.write(encoded)
    } catch {
      // Subscriber disconnected — will be cleaned up on next sweep
      subscribers.delete(sub)
    }
  }
}

/** Get active connection count */
export function activeConnectionCount(): number {
  return subscribers.size
}
