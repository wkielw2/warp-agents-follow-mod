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

describe('model', () => {
  test('shows the model each agent was spawned on', async ($, on) => {
    mock.clock(on, { now: 1000 })
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a' }))

    await $.agent.spawn({ prompt: 'Prueba', subagentType: 'revisor' } as never)
    await $.command.run(RUN_AGENTES)

    const pane = await $.ui.mount({
      plugin: 'agentes-activos',
      surface: 'terminal',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: 'agentes',
    })

    expect(await pane.find({ type: 'Text', text: 'opus 5.5' })).toBeDefined()
  })
})

describe('tab title', () => {
  const TITLE = '\u001b]0;🤖 1 agente · tester\u0007'
  const processResult = (exitCode: number, stdout = '', isStdoutTruncated = false) => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated, isStderrTruncated: false },
  })

  // Answers `process.run`: a synthetic process table for ps (our own row uses
  // the exact argv we sent) and a recorder for tee.
  const processesBeneath = (
    on: On,
    options: {
      psExitCode?: number
      isPsTruncated?: boolean
      tty?: string
      teeExitCodes?: number[]
      doesPsThrow?: boolean
      teeThrowsAt?: number[]
    } = {},
  ) => {
    const { psExitCode = 0, isPsTruncated = false, tty = 'ttys010', teeExitCodes = [], doesPsThrow = false, teeThrowsAt = [] } = options
    const calls: string[][] = []
    const writes: { argv: string[]; stdin?: string }[] = []
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'agentes' } }))
    on('process.run', (_$, e) => {
      calls.push([...e.argv])
      if (e.argv[0] === 'ps') {
        if (doesPsThrow) throw new Error('ps unavailable')
        const table = [
          '    1     0 ??       /sbin/launchd',
          `  400     1 ${tty}  -zsh`,
          `  500   400 ${tty}  claude`,
          `  600   500 ??       ${e.argv.join(' ')}`,
        ].join('\n')

        return processResult(psExitCode, table, isPsTruncated)
      }
      writes.push({ argv: [...e.argv], stdin: e.init?.stdin })
      if (teeThrowsAt.includes(writes.length - 1)) throw new Error('tee unavailable')

      return processResult(teeExitCodes[writes.length - 1] ?? 0)
    })

    return { calls, writes }
  }

  const start = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
    $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  test('writes the running agents to the terminal found at start', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const { calls, writes } = processesBeneath(on)

    await start($)
    await clock.advance(1000)

    expect(writes).toEqual([{ argv: ['tee', '/dev/ttys010'], stdin: TITLE }])
    expect(calls.filter(argv => argv[0] === 'ps').length).toBe(1)
    expect(calls.some(argv => argv[0] === 'sh')).toBe(false)
  })

  test('writes nothing when no terminal is found', async ($, on) => {
    const clock = mock.clock(on)
    const engine = engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const { calls } = processesBeneath(on, { tty: '??' })

    await start($)
    await clock.advance(1000)

    expect(calls.map(argv => argv[0])).toEqual(['ps'])
    expect(engine.statuses).toEqual(['🤖 1 agente en ejecución'])
  })

  test('writes nothing when ps fails', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const { writes } = processesBeneath(on, { psExitCode: 1 })

    await start($)
    await clock.advance(1000)

    expect(writes).toEqual([])
  })

  test('writes nothing when the ps output is truncated', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const { writes } = processesBeneath(on, { isPsTruncated: true })

    await start($)
    await clock.advance(1000)

    expect(writes).toEqual([])
  })

  test('retries after a failed write', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const { writes } = processesBeneath(on, { teeExitCodes: [1, 0] })

    await start($)
    await clock.advance(1000)
    await clock.advance(1000)

    expect(writes).toEqual([
      { argv: ['tee', '/dev/ttys010'], stdin: TITLE },
      { argv: ['tee', '/dev/ttys010'], stdin: TITLE },
    ])
  })

  test('retries a failed refresh on the next tick, not a full refresh later', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    // First write works, then ticks 2-10 write nothing, the refresh on tick 11 fails.
    const { writes } = processesBeneath(on, { teeExitCodes: [0, 1, 0] })

    await start($)
    await clock.advance(1000)
    await clock.advance(9000)
    expect(writes.length).toBe(1)

    await clock.advance(1000)
    expect(writes.length).toBe(2)

    await clock.advance(1000)
    expect(writes.length).toBe(3)
  })

  test('writes nothing and keeps the status line when ps throws', async ($, on) => {
    const clock = mock.clock(on)
    const engine = engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const { calls, writes } = processesBeneath(on, { doesPsThrow: true })

    await start($)
    await clock.advance(1000)
    await clock.advance(1000)

    expect(writes).toEqual([])
    expect(calls.map(argv => argv[0])).toEqual(['ps'])
    expect(engine.statuses).toEqual(['🤖 1 agente en ejecución'])
  })

  test('retries on the next tick when tee throws instead of exiting non-zero', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const { writes } = processesBeneath(on, { teeThrowsAt: [0] })

    await start($)
    await clock.advance(1000)
    await clock.advance(1000)
    await clock.advance(1000)

    expect(writes.map(write => write.stdin)).toEqual([TITLE, TITLE])
  })

  test('sends a title with ; and spaces untouched and without control characters', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'a;b \u0007c\u001b[31m\td' })])
    const { writes } = processesBeneath(on)

    await start($)
    await clock.advance(1000)

    expect(writes.map(write => write.stdin)).toEqual(['\u001b]0;🤖 1 agente · a;b c[31md\u0007'])
  })

  test('goes back to "Claude Code" once the agents end, and only once', async ($, on) => {
    const clock = mock.clock(on)
    const list = [agent({ id: 'a', name: 'tester' })]
    engineBeneath(on, list)
    const { writes } = processesBeneath(on)

    await start($)
    await clock.advance(1000)
    list[0] = agent({ id: 'a', name: 'tester', status: 'completed' })
    await clock.advance(1000)
    await clock.advance(1000)
    await clock.advance(11000)

    expect(writes.map(write => write.stdin)).toEqual([TITLE, '\u001b]0;Claude Code\u0007'])
  })

  test('restores "Claude Code" on session end if a title was set', async ($, on) => {
    const clock = mock.clock(on)
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    const { writes } = processesBeneath(on)
    on('session.end', () => ({ sessionId: 's1' }))

    await start($)
    await clock.advance(1000)
    await $.session.end({ sessionId: 's1' } as never)

    expect(writes.map(write => write.stdin)).toEqual([TITLE, '\u001b]0;Claude Code\u0007'])
  })
})
