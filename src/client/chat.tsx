/** A single composer and interleaved conversation with explicit, independently advancing task cards. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiResponse } from '../app/api.ts'
import type { ChatMessage } from '../app/chat-model.ts'
import { usePoll } from './api.ts'
import { Button, Icon, Tag } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { MarkdownLite } from './widgets.tsx'
import STYLES from './chat.css?raw'

type Task = ApiResponse<'GET chat'>['tickets'][number]

/** Stable chronological task letters: A, B, ... Z, AA, AB. */
function taskLetter(index: number): string {
  let value = index
  let text = ''
  do { text = String.fromCharCode(65 + value % 26) + text; value = Math.floor(value / 26) - 1 } while (value >= 0)
  return text
}

/** Render ticket status from Engine state, separately from receipt and interpretation status. */
function TaskState({ task }: { task: Task }) {
  const { t } = usePanel()
  const key = task.stage === 'working' ? task.action === 'queued' ? 'queued' : 'working'
    : task.stage === 'person' ? 'person' : task.stage
  return <Tag tone={key === 'working' ? 'info' : key === 'person' ? 'warning' : 'quiet'}>{t(`chat.${key}`)}</Tag>
}

/** Parallel chat panel; sends only wait for a durable receipt, never for interpretation or worker completion. */
export function ParallelChatPage() {
  const { t, call, openSession, notify } = usePanel()
  const { data, error, reload } = usePoll(() => call('GET chat'), [call], 1000)
  const [draft, setDraft] = useState('')
  const [target, setTarget] = useState('auto')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string>()
  const request = useRef<{ id: string; text: string; target: string }>()
  const locked = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const feed = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const tasks = data?.tickets ?? []
  const items = data?.messages ?? []
  const roots = items.filter(item => item.role === 'human' && item.rootId === item.id && item.ticketId)
  useEffect(() => {
    if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight
  }, [data])
  const choose = (id: string) => { setTarget(id); input.current?.focus() }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || locked.current) return
    const value = request.current?.text === text && request.current.target === target ? request.current
      : { id: crypto.randomUUID(), text, target }
    request.current = value
    locked.current = true; setSending(true); setSendError(undefined)
    try {
      await call('POST chat/messages', { body: value })
      request.current = undefined
      setDraft(current => current.trim() === text ? '' : current)
      setTarget(current => current === value.target ? 'auto' : current)
      follow.current = true
      await reload()
    } catch (failure) { setSendError(errorText(failure)) }
    finally { locked.current = false; setSending(false) }
  }
  const retry = async (message: ChatMessage) => {
    try {
      await call('POST chat/messages', { body: { id: message.id, text: message.text, target: message.target } })
      await reload()
    } catch (failure) { notify(errorText(failure)) }
  }
  const active = tasks.filter(task => task.stage !== 'ended')
  const selected = roots.find(item => item.id === target)
  const labels = new Map(roots.map((root, index) => [root.id, taskLetter(index)]))
  const labelOf = (rootId: string | undefined) => rootId ? labels.get(rootId) : undefined
  return <section className="dt-chat" aria-label={t('chat.title')}>
    <style>{STYLES}</style>
    <header className="dt-chat-head">
      <div><h1>{t('chat.title')} <Tag>{t('chat.experimental')}</Tag></h1><p>{t('chat.subtitle')}</p></div>
      <span className="dt-hint">{t('chat.capacity', { count: data?.maxWorkers ?? '—' })}</span>
    </header>
    <div className="dt-chat-body">
      <div className="dt-chat-main">
        <div ref={feed} className="dt-chat-feed" onScroll={event => {
          const node = event.currentTarget
          follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
        }}>
          {(!data || error) && <p className={error ? 'dt-error' : 'dt-hint'} role="status">{error?.message ?? t('loading')}
            {error && <Button size="sm" onClick={() => { void reload() }}>{t('chat.retry')}</Button>}</p>}
          {data && !data.enabled && <p className="dt-banner">{t('chat.disabled')}</p>}
          {data?.paused && <p className="dt-banner">{t('chat.paused')}</p>}
          {data && !items.length && <div className="dt-chat-empty">
            <Icon name="message" size={28} /><h2>{t('chat.emptyTitle')}</h2><p>{t('chat.emptyBody')}</p>
            <div className="dt-chat-examples">{(['play', 'save'] as const).map(key =>
              <Button key={key} variant="outline" onClick={() => { setDraft(t(`chat.example.${key}`)); input.current?.focus() }}>
                {t(`chat.exampleLabel.${key}`)}
              </Button>)}</div>
          </div>}
          <ol className="dt-chat-messages">{items.map(message => {
            const root = items.find(item => item.id === message.rootId)
            const task = tasks.find(item => item.id === message.ticketId)
            return <li key={message.id} className="dt-chat-message" data-role={message.role}>
              <div className="dt-chat-message-meta"><span>{message.role === 'human' ? 'Henry' : t('chat.agent')}</span>
                <time dateTime={message.at}>{new Date(message.at).toLocaleTimeString(t('lang') === 'zh' ? 'zh-CN' : 'en', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                {root && <span>{t('chat.threadLabel', { label: labels.get(root.id), title: root.title })}</span>}
              </div>
              <div className="dt-chat-bubble">{message.role === 'agent' ? <MarkdownLite text={message.text} /> : message.text}</div>
              {message.role === 'human' && <div className="dt-chat-receipt" role="status">
                <Icon name={message.phase === 'failed' ? 'alert' : message.phase === 'routing' ? 'running' : 'decision'} size={14} />
                <span>{message.phase === 'dispatched' ? t(message.rootId === message.id ? 'chat.dispatched' : 'chat.attached')
                  : t(`chat.${message.phase}`)}</span>
                {message.routedAt && <span>{((Date.parse(message.routedAt) - Date.parse(message.at)) / 1000).toFixed(1)} s</span>}
                {message.phase === 'dispatched' && <button type="button" onClick={() => choose(message.rootId!)}>
                  {t('chat.followupNamed', { label: labels.get(message.rootId!) })}
                </button>}
                {message.phase === 'failed' && <button type="button" onClick={() => { void retry(message) }}>{t('chat.retry')}</button>}
              </div>}
              {message.error && <p className="dt-error">{message.error}</p>}
              {message.reply && <div className="dt-chat-answer"><MarkdownLite text={message.reply} /></div>}
              {task && message.rootId === message.id && <div className="dt-chat-inline-task"><TaskState task={task} />
                <span>{t('chat.taskLabel', { label: labels.get(message.rootId), title: task.title })}</span></div>}
            </li>
          })}</ol>
        </div>
        <form className="dt-chat-composer" onSubmit={event => { void submit(event) }}>
          <div className="dt-chat-target">
            <label htmlFor="dt-chat-target">{t('chat.sendAs')}</label>
            <select id="dt-chat-target" value={target} onChange={event => setTarget(event.target.value)}>
              <option value="auto">{t('chat.auto')}</option><option value="new">{t('chat.new')}</option>
              {roots.map(item => <option key={item.id} value={item.id}>{t('chat.toTask', { label: labels.get(item.id), title: item.title })}</option>)}
            </select>
          </div>
          {selected && <p className="dt-hint">{t('chat.targetHint', { label: labels.get(selected.id), title: selected.title })}</p>}
          <textarea ref={input} value={draft} onChange={event => setDraft(event.target.value)} rows={3} maxLength={12000}
            aria-label={t('chat.input')} placeholder={t('chat.placeholder')}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault(); event.currentTarget.form?.requestSubmit()
              }
            }} />
          {sendError && <p className="dt-error" role="alert">{sendError}</p>}
          <div className="dt-chat-send"><span className="dt-hint">{t('chat.sendHint')}</span>
            <Button type="submit" variant="primary" disabled={!draft.trim() || sending || !data?.enabled}>
              {t(sending ? 'chat.receiving' : 'chat.send')}
            </Button></div>
        </form>
      </div>
      <aside className="dt-chat-tasks" aria-label={t('chat.tasks')}>
        <h2>{t('chat.tasks')} <span>{active.length}</span></h2>
        {!tasks.length && <p className="dt-hint">{t('chat.noTasks')}</p>}
        {[...tasks].reverse().map(task => {
          const root = roots.find(item => item.ticketId === task.id)
          return <article key={task.id} className="dt-chat-task">
            <TaskState task={task} /><h3>{root ? t('chat.taskLabel', { label: labels.get(root.id), title: task.title }) : task.title}</h3>
            {task.attention && <p>{task.attention}</p>}
            {task.error && <p className="dt-error">{task.error}</p>}
            <div className="dt-actions">
              {root && <Button size="sm" variant="outline" onClick={() => choose(root.id)}>
                {t('chat.followupNamed', { label: labels.get(root.id) })}
              </Button>}
              <Button size="sm" onClick={() => { openSession(task.sessionId).catch(failure => notify(errorText(failure))) }}>{t('chat.inspect')}</Button>
            </div>
          </article>
        })}
      </aside>
    </div>
  </section>
}
