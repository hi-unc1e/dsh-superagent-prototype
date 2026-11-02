/** Local parallel-chat intake, durable routing receipts, and Source replies sharing the existing ticket executor. */
import { z } from 'zod'
import { family } from '../kv.ts'
import type { SourceKind } from '../sources/kind.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import type { Engine, OutboundMessage, Trigger } from '../core/index.ts'
import { ticketStage } from '../core/stage.ts'
import type { Store } from './store.ts'
import type { ChatMessage, ChatRoute } from './chat-model.ts'

const SOURCE = 'parallel-chat'
const messages = family<ChatMessage>('chat/message:')
const Config = z.object({
  accept: z.boolean().default(false),
  routingConcurrency: z.number().int().min(1).max(8).default(4),
  routingTimeoutSeconds: z.number().int().min(5).max(120).default(45),
}).strict()
export const ChatInput = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(12000),
  target: z.union([z.enum(['auto', 'new']), z.string().uuid()]).default('auto'),
}).strict()
const label = (zh: string, en: string) => ({ zh, en })
interface ChatHost {
  store: Pick<Store, 'get' | 'set' | 'keys' | 'atomic' | 'tickets' | 'triggers' | 'threads' | 'settings'>
  engine: Pick<Engine, 'receive' | 'decide' | 'attach'>
  sources: SourceRegistry
  lifetime: AbortSignal
  configured(): boolean
  requestPass(): void
  classify(id: string, input: string, signal: AbortSignal): Promise<ChatRoute>
}

/** One persisted chat stream with independently interpreted messages and explicit links to worker tickets. */
export class ParallelChat {
  readonly kind: SourceKind
  private readonly active = new Map<string, Promise<void>>()
  private readonly lifetime = new AbortController()
  constructor(private readonly host: ChatHost) {
    this.kind = {
      kind: SOURCE, title: label('并行会话', 'Parallel chat'),
      description: label('在同一聊天流里提交任务、补充要求并接收结果', 'Submit tasks and follow-ups in one chat stream'),
      schema: Config, health: [], fields: [
        { key: 'accept', type: 'switch', label: label('接收本机会话消息', 'Accept local chat messages') },
        { key: 'routingConcurrency', type: 'number', min: 1, max: 8, advanced: true,
          label: label('同时理解的消息数', 'Concurrent interpretations') },
        { key: 'routingTimeoutSeconds', type: 'number', min: 5, max: 120, advanced: true,
          label: label('理解超时（秒）', 'Interpretation timeout (seconds)') },
      ],
      scope: (_input, config) => config.accept ? { listened: true, observed: false } : { listened: false, reason: 'source_disabled' },
      policy: {
        schema: z.object({ allowed: z.array(z.object({ id: z.string(), name: z.string().optional() }).strict()).default([]) }).strict(),
        fields: [{ key: 'allowed', type: 'rows', label: label('操作者', 'Operators'),
          columns: [{ key: 'id', type: 'text', label: label('标识', 'ID') }] }],
        explicit: label('本机并行会话内提交的请求', 'Requests submitted in local parallel chat'),
      },
      channel: {
        allowed: (_address, config) => config.accept === true,
        send: async (_host, message) => { this.reply(message); return 'sent' },
        link: () => ({ url: '', label: label('并行会话', 'Parallel chat') }),
      },
      threadContext: {
        messageId: trigger => trigger.id,
        read: async (_commands, trigger) => {
          const items = this.all().filter(item => item.rootId === trigger.meta.rootId).slice(-50)
            .map(item => ({ id: `${SOURCE}:${item.id}`, from: item.role === 'human' ? 'Henry' : 'Agent',
              at: item.at, text: item.text, ...item.role === 'agent' ? { bot: true as const } : {} }))
          return { messages: items, body: { messages: items } }
        },
      },
    }
  }
  private config() { return Config.parse(this.host.sources.instance(SOURCE)?.config ?? {}) }
  private all(): ChatMessage[] {
    return this.host.store.keys(messages).flatMap(key => this.host.store.get(key) ?? []).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  }
  private get(id: string) { return this.host.store.get(messages(id)) }
  private save(message: ChatMessage) { this.host.store.set(messages(message.id), message) }
  /** Current chat messages plus authoritative ticket stages, never inferred from acknowledgement text. */
  view() {
    const items = this.all()
    const tickets = [...new Set(items.flatMap(item => item.ticketId ? [item.ticketId] : []))].flatMap(id => {
      const ticket = this.host.store.tickets.get(id)
      return ticket ? [{ id, title: ticket.title, ...ticketStage(ticket), updatedAt: ticket.updatedAt,
        attention: ticket.attention?.question, error: ticket.delivery?.error,
        outcome: ticket.ended?.outcome, sessionId: `worker-${ticket.id}` }] : []
    })
    return { enabled: this.config().accept, paused: this.host.store.settings().paused,
      messages: items.slice(-200), tickets, maxWorkers: this.host.store.settings().executor.maxWorkers }
  }
  /** Persist input and return immediately; interpretation and dispatch run outside the HTTP request. */
  submit(value: unknown): ChatMessage {
    const input = ChatInput.parse(value)
    if (!this.config().accept || !this.host.configured()) throw new Error('Parallel chat is not enabled or setup is incomplete')
    const existing = this.get(input.id)
    if (existing && (existing.text !== input.text || existing.target !== input.target)) throw new Error('Message ID already has different content')
    if (input.target !== 'auto' && input.target !== 'new' && !this.get(input.target)) throw new Error('Unknown follow-up target')
    const message = existing ?? { ...input, role: 'human' as const, at: new Date().toISOString(), phase: 'received' as const }
    if (!existing) this.save(message)
    if (message.phase === 'failed') this.save({ ...message, phase: 'received', error: undefined })
    this.kick()
    return this.get(input.id)!
  }
  /** Resume pending interpretations after startup without replaying already dispatched messages. */
  kick(): void {
    if (this.lifetime.signal.aborted || this.host.lifetime.aborted || !this.config().accept || !this.host.configured()) return
    for (const message of this.all()) {
      if (this.active.size >= this.config().routingConcurrency) break
      if (!['received', 'routing'].includes(message.phase) || this.active.has(message.id)) continue
      const task = Promise.resolve().then(() => this.route(message)).catch(error => {
        const latest = this.get(message.id)!
        this.save({ ...latest, phase: 'failed', error: error instanceof Error ? error.message : String(error) })
      }).finally(() => { this.active.delete(message.id); this.kick() })
      this.active.set(message.id, task)
    }
  }
  private async route(message: ChatMessage): Promise<void> {
    const signal = AbortSignal.any([this.host.lifetime, this.lifetime.signal,
      AbortSignal.timeout(this.config().routingTimeoutSeconds * 1000)])
    const sessionId = `chat-route-${message.id}`
    this.save({ ...message, phase: 'routing', routeSessionId: sessionId })
    // Interpretation sees only messages preceding this one; concurrent new requests cannot target one another cyclically.
    const preceding = this.all().filter(item => item.at < message.at || item.at === message.at && item.id < message.id).slice(-24)
    const context = preceding.map(item => ({ id: item.id, role: item.role, text: item.text.slice(0, 3000),
      rootId: item.rootId, phase: item.phase, ticket: item.ticketId ? this.view().tickets.find(ticket => ticket.id === item.ticketId) : undefined }))
    let route: ChatRoute
    if (message.target === 'new') route = { kind: 'new', target: null, title: message.text.slice(0, 80), reply: '' }
    else if (message.target !== 'auto') route = { kind: 'followup', target: message.target, title: '', reply: '' }
    else route = await this.host.classify(sessionId, JSON.stringify({ preceding: context, current: message.text }), signal)
    signal.throwIfAborted()
    if (route.kind === 'reply') {
      this.save({ ...this.get(message.id)!, phase: 'answered', reply: route.reply, routedAt: new Date().toISOString() })
      return
    }
    let rootId = message.id
    if (route.kind === 'followup') {
      const parent = preceding.find(item => item.id === route.target && item.role === 'human')
      if (!parent) throw new Error('Could not identify the task; choose a task with Follow up')
      await this.active.get(parent.id)
      signal.throwIfAborted()
      const latest = this.get(parent.id)!
      if (!latest.ticketId) throw new Error('The original message has no task yet; retry after it is dispatched')
      rootId = latest.rootId ?? parent.id
    }
    const thread = { source: SOURCE, id: rootId }
    const trigger: Trigger = {
      id: `${SOURCE}:${message.id}`, source: SOURCE, threads: [thread],
      actor: { source: SOURCE, id: 'Henry' }, human: true, addressed: 'direct',
      at: message.at, text: message.text, meta: { rootId },
      channel: { source: SOURCE, thread: `${SOURCE}:${rootId}`, address: { rootId } },
    }
    // Both commands commit in one transaction so the ordinary assessor cannot race this local dispatch.
    this.host.store.atomic(() => {
      this.host.engine.receive(trigger)
      let ticketId: string
      if (route.kind === 'followup') {
        const root = this.get(rootId)!
        if (!root.ticketId) throw new Error('The original task is unavailable')
        ticketId = root.ticketId
        this.host.engine.attach(ticketId, trigger.id)
      } else {
        const decision = this.host.engine.decide(trigger.id, { kind: 'accept', title: route.title, scope: message.text,
          name: `chat-${message.id.slice(0, 8)}`, reason: { code: 'explicitRouted' } })
        if (!decision.ticketId || decision.kind !== 'accept') throw new Error('Task was refused by the current policy')
        ticketId = decision.ticketId
      }
      this.host.store.threads.describe(`${SOURCE}:${rootId}`, { label: route.title || this.get(rootId)?.title || message.text.slice(0, 80) })
      this.save({ ...this.get(message.id)!, phase: 'dispatched', rootId, ticketId,
        title: route.title || this.get(rootId)?.title, routedAt: new Date().toISOString() })
    })
    this.host.requestPass()
  }
  private reply(message: OutboundMessage): void {
    const id = `reply:${message.id}`
    if (this.get(id)) return
    const rootId = this.all().find(item => item.ticketId === message.ticketId)?.rootId
    this.save({ id, role: 'agent', text: message.text, at: new Date().toISOString(), target: 'auto',
      phase: 'answered', rootId, ticketId: message.ticketId })
  }
  /** Cancel routing calls and wait for their durable settlements before the owning Store closes. */
  async stop(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled([...this.active.values()])
  }
}
