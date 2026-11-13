import { useState } from 'react'
import { Card, CardBody, Tabs, Tab, Button, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea, Accordion, AccordionItem } from '@heroui/react'

type State = 'review' | 'running' | 'queued' | 'done'
type Task = { id: number; title: string; project: string; agent: string; state: State; summary: string; result: string; events: string[] }
const seed: Task[] = [
  { id: 1, title: '导出 4K 时，第 2 段卡顿', project: 'HaloCam', agent: 'Codex', state: 'review', summary: '修复已完成，等你看看播放效果。', result: '调整了视频缓冲。12 项测试通过，已保留验收分支。', events: ['GitHub 反馈进入看板', 'Codex 在独立目录中修复', '自动测试通过，提交验收'] },
  { id: 2, title: '博客里还有 3 张图片打不开', project: '博客', agent: 'DSH', state: 'review', summary: '已找到失效链接，需要你决定是否替换。', result: '原图仍可恢复。建议保留原图，更新链接。', events: ['收到你的反馈', 'DSH 检查了图片链接', '提出恢复原图的方案'] },
  { id: 3, title: '相册时间轴排序错乱', project: 'HaloCam', agent: 'Codex', state: 'running', summary: '正在修复日期排序，你可以继续提别的事。', result: '正在检查不同机型的日期解析，还没有验收结果。', events: ['收到 GitHub 反馈', '已复现排序问题', '正在修改并补充测试'] },
  { id: 4, title: '缩短博客构建时间', project: '博客', agent: 'DSH', state: 'running', summary: '代码调整完成，正在等待测试结果。', result: '测试尚未结束，完成后再提交验收。', events: ['从会话收下任务', '修改构建配置', '等待测试结果'] },
  { id: 5, title: '安卓发版检查', project: 'HaloCam', agent: 'DSH', state: 'queued', summary: '等待测试手机空闲，其他任务继续执行。', result: '检查清单已备好。设备空闲后继续，不需要你重新派活。', events: ['生成检查清单', '准备工作完成', '等待共享设备'] },
  { id: 6, title: '调整 PRO 页文案', project: 'HaloCam', agent: 'DSH', state: 'done', summary: '你已验收通过。', result: '完成三处文案调整，验收记录已保留。', events: ['收到反馈', '完成修改', 'Henry 验收通过'] },
]
const labels: Record<State, string> = { review: '等你判断', running: '正在执行', queued: '等待资源', done: '已完成' }
const routines = [
  { name: '日记累进阅读与教练分析', schedule: '每天 08:00 · 上海时间', detail: '补读新增和修订日记，形成教练反馈。无新内容时不发评论。' },
  { name: 'SG 线路巡检', schedule: '周期待确认 · 08:00', detail: '检查线路、证书和余额；异常才提醒你。原任务标题与调度周期不一致，迁移前需确认。' },
]
export default function App() {
  const [tasks, setTasks] = useState(seed)
  const [tab, setTab] = useState('work')
  const [selected, setSelected] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newText, setNewText] = useState('')
  const [notice, setNotice] = useState('')
  const [large, setLarge] = useState(false)
  const [paused, setPaused] = useState<number[]>([])
  const task = tasks.find(t => t.id === selected)
  const review = tasks.filter(t => t.state === 'review')
  const working = tasks.filter(t => t.state === 'running')
  const queued = tasks.filter(t => t.state === 'queued')
  const done = tasks.filter(t => t.state === 'done')
  function open(t: Task) { setSelected(t.id); setEditing(false); setDraft('') }
  function update(state: State, message: string) {
    setTasks(ts => ts.map(t => t.id === selected ? { ...t, state, summary: message, events: [...t.events, message] } : t))
    setSelected(null); setNotice('演示：' + message)
  }
  function row(t: Task) {
    return <button key={t.id} className="work-row" onClick={() => open(t)}><span><strong>{t.title}</strong><span className="secondary">{t.summary}</span></span><span className={'status ' + t.state}>{labels[t.state]} <span aria-hidden="true">→</span></span></button>
  }
  return <div className={'page' + (large ? ' larger' : '')}>
    <header className="header"><div><p className="eyeline">设计对照 · HeroUI · 演示数据</p><h1>SuperAgent 工作看板</h1></div><div className="header-actions"><Button variant="bordered" className="control" aria-pressed={large} onPress={() => setLarge(!large)}>{large ? '标准字号' : '更大字号'}</Button><Button color="primary" className="control" onPress={() => setAdding(true)}>＋ 记一件事</Button></div></header>
    <div className="nav"><Tabs aria-label="看板视图" selectedKey={tab} onSelectionChange={key => setTab(String(key))} size="lg" variant="underlined" color="primary" classNames={{ tab: 'tab-button', tabList: 'tab-list' }}><Tab key="work" title="工作" /><Tab key="routines" title="固定流程" /><Tab key="done" title={'已完成 ' + done.length} /></Tabs><a className="old-link" href="./prototype.html" target="_blank" rel="noreferrer">打开旧版对比 ↗</a></div>
    {notice && <div className="notice" role="status"><span>{notice}</span><Button variant="light" aria-label="关闭提示" onPress={() => setNotice('')}>关闭</Button></div>}
    {tab === 'work' && <main>
      <section aria-labelledby="review-heading"><div className="section-heading"><h2 id="review-heading">{review.length ? `${review.length} 件事，等你判断` : '暂时没有需要你判断的事'}</h2><p>其余工作正在继续。</p></div>
        <div className="review-list">{review.map(t => <Card key={t.id} shadow="none" className="review-card"><CardBody className="review-body"><div className="review-copy"><p className="project">{t.project}</p><h3>{t.title}</h3><p>{t.summary}</p></div><Button className="review-button control" variant="bordered" onPress={() => open(t)}>查看并判断 <span aria-hidden="true">→</span></Button></CardBody></Card>)}</div>
      </section>
      <section className="running-section" aria-labelledby="running-heading"><div className="section-heading"><h2 id="running-heading">正在执行 <span className="quiet-count">{working.length}</span></h2><p>无需守着，完成后会交给你。</p></div><div className="rows">{working.map(row)}{!working.length && <p>暂时没有执行中的任务。</p>}</div></section>
      <Accordion className="queue-accordion" variant="light"><AccordionItem key="queue" aria-label={'等待资源 ' + queued.length + ' 件'} title={`等待资源 · ${queued.length} 件`} classNames={{ title: 'accordion-title', trigger: 'accordion-trigger' }}><div className="rows">{queued.map(row)}{!queued.length && <p>没有任务在等待。</p>}</div></AccordionItem></Accordion>
    </main>}
    {tab === 'routines' && <main><div className="section-heading"><h2>交代一次，持续执行</h2><p>时间只是唤醒方式；每次结果都回到工作看板。</p></div><div className="routine-list">{routines.map((r,i) => <Card key={r.name} shadow="none" className="routine-card"><CardBody className="routine-body"><div><h3>{r.name}</h3><p className="schedule">{paused.includes(i) ? '已暂停（演示）' : r.schedule}</p><p>{r.detail}</p></div><div className="routine-actions"><Button variant="bordered" className="control" onPress={() => {setTasks(ts => [...ts, { id: Date.now(), title: r.name, project: '固定流程', agent: 'DSH', state: 'queued', summary: '已收下本次手动运行，等待执行。', result: r.detail, events: ['Henry 手动触发本次流程'] }]); setNotice('演示：已加入工作队列，未启动真实流程。')}}>运行一次</Button><Button variant="light" className="control" onPress={() => setPaused(xs => xs.includes(i) ? xs.filter(x => x !== i) : [...xs,i])}>{paused.includes(i) ? '恢复' : '暂停'}</Button></div></CardBody></Card>)}</div></main>}
    {tab === 'done' && <main><div className="section-heading"><h2>已完成的工作</h2><p>决定和结果都留在这里。</p></div><div className="rows">{done.map(row)}</div></main>}
    <footer>此页仅用于对比阅读与操作体验。所有操作只改变当前演示，刷新可还原。</footer>
    <Modal isOpen={!!task} onOpenChange={isOpen => {if (!isOpen) setSelected(null)}} size="2xl" scrollBehavior="inside" classNames={{ base: `task-modal ${task?.state || ''} ${large ? 'modal-large' : ''}`, closeButton: 'modal-close' }}>
      <ModalContent>{task && <><ModalHeader className="detail-header"><span className={'detail-status ' + task.state}>{labels[task.state]} · {task.project}</span><h2>{task.title}</h2></ModalHeader><ModalBody className="detail-body"><p className="detail-summary">{task.summary}</p><div className="result"><h3>{task.state === 'review' ? '已做什么' : task.state === 'running' ? '当前进展' : task.state === 'queued' ? '等待原因' : '结果'}</h3><p>{task.result}</p></div>
      {task.state === 'review' && <p className="decision-note">通过只记录验收结果，不会自动合并或发布。</p>}
      {editing && <Textarea autoFocus label="希望改哪里？" labelPlacement="outside" value={draft} onValueChange={setDraft} minRows={3} classNames={{ input: 'feedback-input', label: 'feedback-label' }} placeholder="写一句就好，其他工作会继续。" />}
      <Accordion variant="light"><AccordionItem key="events" aria-label="查看过程与执行器" title="查看过程与执行器" classNames={{ title: 'accordion-title' }}><p className="executor">执行器：{task.agent}</p><ol className="timeline">{task.events.map((e,i) => <li key={i}>{e}</li>)}</ol></AccordionItem></Accordion>
      </ModalBody><ModalFooter className="detail-footer">{task.state === 'review' ? <>{editing ? <Button color="primary" className="control" isDisabled={!draft.trim()} onPress={() => update('queued','已收到修改意见：' + draft.trim())}>发回修改</Button> : <Button color="primary" className="control" onPress={() => update('done','你已验收通过。')}>通过</Button>}<Button variant="bordered" className="control" onPress={() => setEditing(!editing)}>{editing ? '取消修改' : '要改'}</Button><Button variant="light" className="control" onPress={() => setSelected(null)}>稍后再看</Button></> : <Button variant="bordered" className="control" onPress={() => setSelected(null)}>知道了</Button>}</ModalFooter></>}</ModalContent>
    </Modal>
    <Modal isOpen={adding} onOpenChange={setAdding} size="xl" classNames={{ base: 'task-modal', closeButton: 'modal-close' }}><ModalContent><ModalHeader className="detail-header"><h2>记一件事</h2></ModalHeader><ModalBody><Textarea autoFocus label="需求、Bug，或者一个想法" value={newText} onValueChange={setNewText} minRows={4} classNames={{ input: 'feedback-input' }} /></ModalBody><ModalFooter><Button color="primary" className="control" isDisabled={!newText.trim()} onPress={() => {setTasks(ts => [...ts,{ id: Date.now(), title: newText.trim(), project: '待归类', agent: 'DSH', state: 'queued', summary: '已收下，等待归类与派活。', result: '演示任务已保留在本页。', events: ['从看板输入收到想法'] }]);setNewText('');setAdding(false);setNotice('演示：已收下，你可以继续说下一件事。');setTab('work')}}>收下这件事</Button></ModalFooter></ModalContent></Modal>
  </div>
}
