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

describe('opening at start', () => {
  // Answers what session.start calls beneath the plugin; ps finds no terminal.
  const startBeneath = (on: On) => {
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'agentes' } }))
    on('process.run', () => ({
      value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
  }

  // The pane is opened without being awaited: lets that open settle first.
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))

  test('opens the pane when an interactive session starts', async ($, on) => {
    mock.clock(on)
    const engine = engineBeneath(on, [])
    startBeneath(on)

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await settle()

    expect(engine.opened).toEqual(['agentes'])
  })

  test('leaves the pane closed when the session is not interactive', async ($, on) => {
    mock.clock(on)
    const engine = engineBeneath(on, [])
    startBeneath(on)

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
    await settle()

    expect(engine.opened).toEqual([])
  })

  test('does not open it again when the first agent is spawned', async ($, on) => {
    mock.clock(on)
    const engine = engineBeneath(on, [agent({ id: 'a' })])
    startBeneath(on)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a' }))

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await settle()
    await $.agent.spawn({ prompt: 'Prueba', subagentType: 'revisor' } as never)
    await settle()

    expect(engine.opened).toEqual(['agentes'])
  })

  test('starts the session even when opening the pane fails', async ($, on) => {
    mock.clock(on)
    on('agent.list', () => ({ value: [] }))
    on('ui.status', () => ({ value: undefined }))
    startBeneath(on)
    on('ui.open', () => {
      throw new Error('pane unavailable')
    })

    const started = await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    expect(started).toEqual({ cwd: '/repo' })
  })

  test('does not reopen it after a reload of the plugin', async ($, on) => {
    mock.clock(on)
    const engine = engineBeneath(on, [])
    startBeneath(on)

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await settle()
    // A reload runs session.start again; the session's state keeps what the first load stored.
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await settle()

    expect(engine.opened).toEqual(['agentes'])
  })

  test('opens the pane only on the first spawn when the session is not interactive', async ($, on) => {
    mock.clock(on)
    const engine = engineBeneath(on, [agent({ id: 'a' })])
    startBeneath(on)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a' }))

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
    await $.agent.spawn({ prompt: 'Uno', subagentType: 'revisor' } as never)
    await settle()
    await $.agent.spawn({ prompt: 'Dos', subagentType: 'revisor' } as never)
    await settle()

    expect(engine.opened).toEqual(['agentes'])
  })

  test('opens it once when two agents are spawned at the same time', async ($, on) => {
    mock.clock(on)
    const engine = engineBeneath(on, [agent({ id: 'a' })])
    startBeneath(on)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a' }))

    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: false })
    await Promise.all([
      $.agent.spawn({ prompt: 'Uno', subagentType: 'revisor' } as never),
      $.agent.spawn({ prompt: 'Dos', subagentType: 'revisor' } as never),
    ])
    await settle()

    expect(engine.opened).toEqual(['agentes'])
  })

  test('spawns the agent even when opening the pane fails', async ($, on) => {
    mock.clock(on)
    on('agent.list', () => ({ value: [agent({ id: 'a' })] }))
    on('ui.status', () => ({ value: undefined }))
    on('ui.open', () => {
      throw new Error('pane unavailable')
    })
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a' }))

    const spawned = await $.agent.spawn({ prompt: 'Prueba', subagentType: 'revisor' } as never)

    expect(spawned.agentId).toBe('a')
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

describe('Pane with dismissed agents', () => {
  const MINUTE = 60 * 1000
  const mountPane = ($: Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]) =>
    $.ui.mount({ plugin: 'agentes-activos', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'agentes' })

  test('does not draw an ended agent that left the pane while the engine still lists it', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    engineBeneath(on, [agent({ id: 'done', name: 'documentador', status: 'completed' })])
    await $.command.run(RUN_AGENTES)
    await clock.advance(6 * MINUTE)
    await $.command.run(RUN_AGENTES)

    const pane = await mountPane($)

    expect(await pane.find({ type: 'Text', text: 'documentador' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: 'TERMINADOS' })).toBeUndefined()
  })

  test('counts only the ended agents still shown', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const list = [agent({ id: 'old', name: 'antiguo', status: 'completed' })]
    engineBeneath(on, list)
    await $.command.run(RUN_AGENTES)
    await clock.advance(6 * MINUTE)
    list.push(agent({ id: 'fresh', name: 'reciente', status: 'completed' }))
    await $.command.run(RUN_AGENTES)

    const pane = await mountPane($)

    expect(await pane.find({ type: 'Text', text: 'reciente' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'antiguo' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: '1 terminados' })).toBeDefined()
  })

  test('draws a dismissed agent again when it resumes', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const list = [agent({ id: 'a', name: 'tester', status: 'completed' })]
    engineBeneath(on, list)
    await $.command.run(RUN_AGENTES)
    await clock.advance(6 * MINUTE)
    await $.command.run(RUN_AGENTES)
    list[0] = agent({ id: 'a', name: 'tester', status: 'running' })
    await clock.advance(1000)
    await $.command.run(RUN_AGENTES)

    const pane = await mountPane($)

    expect(await pane.find({ type: 'Text', text: 'tester' })).toBeDefined()
  })

  test('keeps the branch of a running agent whose parent was dismissed', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const list = [agent({ id: 'root', name: 'orquestador', status: 'completed' })]
    engineBeneath(on, list)
    await $.command.run(RUN_AGENTES)
    await clock.advance(6 * MINUTE)
    list.push(agent({ id: 'child', name: 'tester', parentId: 'root' }))
    await $.command.run(RUN_AGENTES)

    const pane = await mountPane($)

    expect(await pane.find({ type: 'Text', text: 'orquestador' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '└─ ' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'tester' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'TERMINADOS' })).toBeUndefined()
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

describe('models map', () => {
  test('drops the model of an agent no longer shown or listed', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const list = [agent({ id: 'a', name: 'tester' })]
    engineBeneath(on, list)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a' }))
    const modelWrites: unknown[] = []
    on('state.set', ($, e, next) => {
      if (e.key === 'models') modelWrites.push(e.value)
      return next(e)
    })

    await $.agent.spawn({ prompt: 'Prueba', subagentType: 'revisor' } as never)
    await $.command.run(RUN_AGENTES)
    // Without session.start no timer runs: /agentes ticks by hand.
    list.length = 0
    await clock.advance(1000)
    await $.command.run(RUN_AGENTES)
    await clock.advance(6 * 60 * 1000)
    await $.command.run(RUN_AGENTES)

    expect(modelWrites).toEqual([{ a: 'claude-opus-5-5' }, {}])
  })
})

describe('models map writes', () => {
  const watchModelWrites = (on: On) => {
    const writes: unknown[] = []
    on('state.set', ($, e, next) => {
      if (e.key === 'models') writes.push(e.value)
      return next(e)
    })

    return writes
  }

  test('does not write the state when the spawned model is blank', async ($, on) => {
    mock.clock(on, { now: 1000 })
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    on('agent.spawn', () => ({ model: ' \u001b ', agentId: 'a' }))
    const writes = watchModelWrites(on)

    await $.agent.spawn({ prompt: 'Prueba', subagentType: 'revisor' } as never)

    expect(writes).toEqual([])
  })

  test('saves the spawned model clean and cut', async ($, on) => {
    mock.clock(on, { now: 1000 })
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    on('agent.spawn', () => ({ model: 'opus\u001b' + 'x'.repeat(100), agentId: 'a' }))
    const writes = watchModelWrites(on)

    await $.agent.spawn({ prompt: 'Prueba', subagentType: 'revisor' } as never)

    expect(writes).toEqual([{ a: 'opus' + 'x'.repeat(60) }])
  })

  test('does not prune while every saved model still belongs to an agent', async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    engineBeneath(on, [agent({ id: 'a', name: 'tester' })])
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a' }))
    const writes = watchModelWrites(on)

    await $.agent.spawn({ prompt: 'Prueba', subagentType: 'revisor' } as never)
    await $.command.run(RUN_AGENTES)
    await clock.advance(1000)
    await $.command.run(RUN_AGENTES)

    expect(writes).toEqual([{ a: 'claude-opus-5-5' }])
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

  const start = ($: Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]) =>
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
