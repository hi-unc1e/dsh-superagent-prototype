/** Local parallel-chat intake and durable routing receipts. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Engine } from '../src/core/index.ts'
import { ParallelChat } from '../src/app/chat.ts'
import { Store } from '../src/app/store.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function chat() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-superagent-chat-'))
  directories.push(directory)
  const store = new Store(join(directory, 'orchestrator.sqlite'))
  const sources = new SourceRegistry(() => store.settings())
  store.saveSettings(SettingsSchema.parse({
    ...store.settings(),
    policy: { ...store.settings().policy, sources: { 'parallel-chat': { allowed: [{ id: 'Henry' }] } } },
    sources: { 'parallel-chat': { enabled: true, config: { accept: true } } },
  }))
  const engine = new Engine({
    repo: store,
    scope: sources,
    policy: () => settingsPolicy(store.settings(), sources),
    assessor: { request: () => {} },
    executor: { start: async () => {}, deliver: async () => {}, stop: async () => {} },
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} },
  })
  const input = new ParallelChat({
    store,
    engine,
    sources,
    lifetime: new AbortController().signal,
    configured: () => true,
    requestPass: () => {},
    classify: () => { throw new Error('explicit targets must not invoke the classifier') },
  })
  sources.register(input.kind)
  return { input, store, engine, stop: () => store.close() }
}

it('routes an explicit follow-up to its ticket worker instead of attaching a trigger the ticket already owns', async () => {
  const { input, store, engine, stop } = chat()
  try {
    const rootId = crypto.randomUUID()
    input.submit({ id: rootId, text: 'Analyze Duckee read-only.', target: 'new' })
    await vi.waitFor(() => expect(input.view().messages.at(-1)).toMatchObject({ phase: 'dispatched', ticketId: expect.any(String) }))
    const root = input.view().messages.at(-1)!
    const created = store.tickets.get(root.ticketId!)!
    const assignment = created.assignments.at(-1)!
    const inputIds = [...created.undelivered]
    engine.assignmentStarted(created.id, assignment.id)
    engine.inputsDelivered(created.id, assignment.id, inputIds)
    engine.inputsRead(created.id, inputIds)
    engine.report(created.id, { state: 'ready', summary: 'Done' })
    expect(store.tickets.get(created.id)?.ended).toMatchObject({ outcome: 'completed' })

    const followupId = crypto.randomUUID()
    input.submit({ id: followupId, text: 'Also check the old save migration.', target: rootId })
    await vi.waitFor(() => expect(input.view().messages.at(-1)).toMatchObject({ phase: 'dispatched', rootId, ticketId: root.ticketId }))

    const triggerId = `parallel-chat:${followupId}`
    expect(store.triggers.disposition(triggerId)).toMatchObject({ fanout: [root.ticketId] })
    const resumed = store.tickets.get(root.ticketId!)!
    expect(resumed.ended).toBeUndefined()
    expect(resumed.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resumed', triggerId }),
      expect.objectContaining({ kind: 'trigger', triggerId }),
    ]))
    expect(input.view().messages.at(-1)).not.toHaveProperty('error')
  } finally {
    await input.stop()
    stop()
  }
})
