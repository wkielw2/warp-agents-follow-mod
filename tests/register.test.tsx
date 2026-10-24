import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

const PANE_PROPS = {
  title: 'Agentes',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const RUN_AGENTES = {
  command: 'agentes',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const agent = (overrides: Partial<AgentInfo> & Pick<AgentInfo, 'id'>): AgentInfo => ({
  description: 'Revisar cambios',
  type: 'revisor',
  status: 'running',
  ...overrides,
})

// Stands for the engine beneath the plugin: the agents it lists, the panes
// it opens and the status lines it shows.
const engineBeneath = (on: On, agents: AgentInfo[]) => {
  const opened: string[] = []
  const statuses: (string | undefined)[] = []
  on('agent.list', () => ({ value: agents }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })

  return { opened, statuses }
}

describe('/agentes', () => {
  test('opens the pane, answers and shows the running count', async ($, on) => {
    mock.clock(on, { now: 1000 })
    const engine = engineBeneath(on, [agent({ id: 'a', name: 'tester' })])

    const result = await $.command.run(RUN_AGENTES)

    expect(result.text).toBe('Panel de agentes abierto.')
    expect(engine.opened).toEqual(['agentes'])
    expect(engine.statuses).toEqual(['🤖 1 agente en ejecución'])
  })
})

describe('Pane', () => {
  test('tells there are no agents when none ran', async ($, on) => {
    mock.clock(on)
    engineBeneath(on, [])

    const pane = await $.ui.mount({
      plugin: 'agentes-activos',
      surface: 'terminal',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: 'agentes',
    })

    expect(await pane.find({ type: 'Text', text: 'Sin agentes en ejecución' })).toBeDefined()
  })

  test('draws running agents as a tree and ended ones apart', async ($, on) => {
    mock.clock(on, { now: 1000 })
    engineBeneath(on, [
      agent({ id: 'root', name: 'orquestador' }),
      agent({ id: 'child', name: 'tester', parentId: 'root' }),
      agent({ id: 'done', name: 'documentador', status: 'completed' }),
    ])
    await $.command.run(RUN_AGENTES)

    const pane = await $.ui.mount({
      plugin: 'agentes-activos',
      surface: 'terminal',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: 'agentes',
    })

    expect(await pane.find({ type: 'Text', text: '└─ ' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'tester' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'TERMINADOS' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'documentador' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '1 terminados' })).toBeDefined()
  })
})

describe('tab title', () => {
  test('writes the running agents to the terminal found at start', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const written: string[] = []
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'agentes' } }))
    on('process.run', (_$, e) => {
      const isFindTty = e.argv.length === 3
      if (isFindTty) return { value: { exitCode: 0, stdout: '/dev/ttys010\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      written.push(`${e.argv[4]} > ${e.argv[5]}`)
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.advance(1000)

    expect(written).toEqual(['🤖 1 agente · tester > /dev/ttys010'])
  })

  test('ignores a terminal path that is not a tty', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a' })])
    const calls: string[][] = []
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'agentes' } }))
    on('process.run', (_$, e) => {
      calls.push([...e.argv])
      return { value: { exitCode: 0, stdout: '/etc/passwd\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await clock.advance(1000)

    expect(calls.length).toBe(1)
  })
})
