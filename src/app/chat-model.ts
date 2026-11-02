/** Durable messages in the local parallel chat; task execution remains owned by Engine tickets. */
export interface ChatMessage {
  id: string
  role: 'human' | 'agent'
  text: string
  at: string
  target: 'auto' | 'new' | string
  phase: 'received' | 'routing' | 'dispatched' | 'answered' | 'failed'
  rootId?: string
  ticketId?: string
  title?: string
  reply?: string
  routedAt?: string
  error?: string
  routeSessionId?: string
}

/** Short, tool-free interpretation of a chat message, before any work is authorized. */
export interface ChatRoute {
  kind: 'new' | 'followup' | 'reply'
  target: string | null
  title: string
  reply: string
}
