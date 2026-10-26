import { describe, expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { buildAgentTree, cleanModel, formatElapsed, mergeAgents, modelLabel, staleModelIds, statusText, stripUnsafeChars, tabTitle, titleSequence, ttyFromPs, withoutModels } from '../hooks/agents'
import type { AgentRow } from '../types'

const info = (overrides: Partial<AgentInfo> & Pick<AgentInfo, 'id'>): AgentInfo => ({
  description: 'Revisar cambios',
  type: 'revisor',
  status: 'running',
  ...overrides,
})

const row = (overrides: Partial<AgentRow> & Pick<AgentRow, 'id'>): AgentRow => ({
  label: 'revisor',
  type: 'revisor',
  description: 'Revisar cambios',
  status: 'running',
  startedAt: 0,
  ...overrides,
})

describe('mergeAgents', () => {
  test('adds a new agent with the time it was first seen', async () => {
    const rows = mergeAgents([], [info({ id: 'a', name: 'tester' })], 1000)

    expect(rows).toEqual([
      {
        id: 'a',
        label: 'tester',
        type: 'revisor',
        description: 'Revisar cambios',
        status: 'running',
        startedAt: 1000,
        endedAt: undefined,
      },
    ])
  })

  test('keeps the start time and records the end when an agent completes', async () => {
    const rows = mergeAgents([row({ id: 'a', startedAt: 1000 })], [info({ id: 'a', status: 'completed' })], 5000)

    expect(rows[0]?.startedAt).toBe(1000)
    expect(rows[0]?.endedAt).toBe(5000)
  })

  test('marks an agent the engine dropped as completed', async () => {
    const rows = mergeAgents([row({ id: 'a' })], [], 7000)

    expect(rows[0]?.status).toBe('completed')
    expect(rows[0]?.endedAt).toBe(7000)
  })

  test('drops ended agents after five minutes', async () => {
    const rows = mergeAgents([row({ id: 'a', status: 'completed', endedAt: 0 })], [], 5 * 60 * 1000 + 1)

    expect(rows).toEqual([])
  })

  test('restarts the clock when an ended agent resumes', async () => {
    const rows = mergeAgents(
      [row({ id: 'a', status: 'completed', startedAt: 0, endedAt: 1000 })],
      [info({ id: 'a', status: 'running' })],
      2000,
    )

    expect(rows[0]?.startedAt).toBe(2000)
    expect(rows[0]?.endedAt).toBeUndefined()
  })

  test('strips escape sequences and invisible characters from names and descriptions', async () => {
    const rows = mergeAgents(
      [],
      [info({ id: 'a', name: 'tes\u001b]52;c;eA==\u0007ter\u202e', description: 'Re\u200bvisar\u001b]0;x\u0007' })],
      0,
    )

    expect(rows[0]?.label).toBe('tes]52;c;eA==ter')
    expect(rows[0]?.description).toBe('Revisar]0;x')
  })

  test('keeps an ended agent exactly five minutes after it ended', async () => {
    const rows = mergeAgents([row({ id: 'a', status: 'completed', endedAt: 0 })], [], 5 * 60 * 1000)

    expect(rows.map(one => one.id)).toEqual(['a'])
  })

  test('keeps only the ten most recently ended agents and every active one', async () => {
    const ended = Array.from({ length: 12 }, (_, index) =>
      row({ id: `e${index}`, status: 'completed', endedAt: 1000 + index }),
    )
    const active = row({ id: 'live' })

    const rows = mergeAgents([...ended, active], [info({ id: 'live' })], 2000)

    expect(rows.map(one => one.id)).toEqual(['e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'live'])
  })

  test('does not restamp the end of an agent the engine already dropped', async () => {
    const rows = mergeAgents([row({ id: 'a', status: 'failed', endedAt: 1000 })], [], 9000)

    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.endedAt).toBe(1000)
  })

  test('does not restamp the end while the engine keeps reporting it ended', async () => {
    const rows = mergeAgents(
      [row({ id: 'a', status: 'completed', endedAt: 1000 })],
      [info({ id: 'a', status: 'completed' })],
      9000,
    )

    expect(rows[0]?.endedAt).toBe(1000)
  })

  test('stamps the end of an agent first seen already failed or killed, but not of an idle one', async () => {
    const rows = mergeAgents(
      [],
      [info({ id: 'f', status: 'failed' }), info({ id: 'k', status: 'killed' }), info({ id: 'i', status: 'idle' })],
      3000,
    )

    expect(rows.map(one => [one.id, one.endedAt])).toEqual([
      ['f', 3000],
      ['k', 3000],
      ['i', undefined],
    ])
  })

  test('labels an unnamed agent by its type and follows parent changes', async () => {
    const rows = mergeAgents(
      [row({ id: 'a', label: 'old', parentId: 'p1' })],
      [info({ id: 'a', type: 'explorador', parentId: 'p2' })],
      0,
    )

    expect(rows[0]?.label).toBe('explorador')
    expect(rows[0]?.parentId).toBe('p2')
  })
})

describe('mergeAgents with models', () => {
  test('adds the model the agent was spawned on', async () => {
    const rows = mergeAgents([], [info({ id: 'a' })], 1000, { a: 'claude-opus-5-5' })

    expect(rows[0]?.model).toBe('claude-opus-5-5')
  })

  test('keeps a known model when the map no longer has it', async () => {
    const rows = mergeAgents([row({ id: 'a', model: 'haiku' })], [info({ id: 'a' })], 1000, {})

    expect(rows[0]?.model).toBe('haiku')
  })

  test('leaves the model out when it was not seen spawning', async () => {
    const rows = mergeAgents([], [info({ id: 'a' })], 1000)

    expect(rows[0]?.model).toBeUndefined()
  })

  test('ignores a model that is not text or an inherited property', async () => {
    const models = { a: 42 } as unknown as Record<string, string>
    const rows = mergeAgents([], [info({ id: 'a' }), info({ id: 'toString' })], 1000, models)

    expect(rows.map(one => one.model)).toEqual([undefined, undefined])
  })

  test('strips control characters from the model', async () => {
    const rows = mergeAgents([], [info({ id: 'a' })], 1000, { a: 'opus\u001b[31m' })

    expect(rows[0]?.model).toBe('opus[31m')
  })
})

describe('cleanModel', () => {
  test('cuts a long model to 64 characters', async () => {
    expect(cleanModel('x'.repeat(500))).toBe('x'.repeat(64))
  })

  test('cuts by code points, so an emoji at the limit is not split', async () => {
    const cut = cleanModel('x'.repeat(63) + '😀😀')

    expect(cut).toBe('x'.repeat(63) + '😀')
    expect(Array.from(cut ?? '')).toHaveLength(64)
  })

  test('keeps 64 emoji whole when the model is all emoji', async () => {
    expect(cleanModel('😀'.repeat(100))).toBe('😀'.repeat(64))
  })

  test('keeps a model of exactly 64 characters', async () => {
    expect(cleanModel('x'.repeat(64))).toBe('x'.repeat(64))
  })

  test('trims the spaces left at the edges, also after the cut', async () => {
    expect(cleanModel('  opus  ')).toBe('opus')
    expect(cleanModel('x'.repeat(63) + ' tail')).toBe('x'.repeat(63))
  })

  test('leaves out what is not text or is empty', async () => {
    expect(cleanModel(undefined)).toBeUndefined()
    expect(cleanModel({})).toBeUndefined()
    expect(cleanModel(' \u001b ')).toBeUndefined()
  })
})

describe('staleModelIds', () => {
  test('names the models of agents neither shown nor listed', async () => {
    const models = { shown: 'opus', listed: 'haiku', gone: 'sonnet' }

    expect(staleModelIds(models, [row({ id: 'shown' })], [info({ id: 'listed' })])).toEqual(['gone'])
  })

  test('names every model when nothing is shown or listed', async () => {
    expect(staleModelIds({ a: 'opus' }, [], [])).toEqual(['a'])
  })

  test('names none when every agent is kept', async () => {
    expect(staleModelIds({ a: 'opus', b: 'haiku' }, [row({ id: 'a' })], [info({ id: 'b' })])).toEqual([])
  })
})

describe('withoutModels', () => {
  test('keeps a model saved after the stale ids were found', async () => {
    expect(withoutModels({ gone: 'sonnet', fresh: 'opus' }, ['gone'])).toEqual({ fresh: 'opus' })
  })

  test('does not change the map it receives', async () => {
    const models = { a: 'opus', gone: 'haiku' }
    withoutModels(models, ['gone'])

    expect(models).toEqual({ a: 'opus', gone: 'haiku' })
  })
})

describe('modelLabel', () => {
  test('shortens a full id to family and version', async () => {
    expect(modelLabel('claude-opus-5-5')).toBe('opus 5.5')
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('sonnet 4.5')
    expect(modelLabel('claude-haiku-5-5[1m]')).toBe('haiku 5.5')
  })

  test('shortens Bedrock, Vertex and older ids', async () => {
    expect(modelLabel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('sonnet 4.5')
    expect(modelLabel('anthropic.claude-opus-5-5-v1')).toBe('opus 5.5')
    expect(modelLabel('claude-sonnet-4-5@20250929')).toBe('sonnet 4.5')
    expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('sonnet 3.5')
    expect(modelLabel('claude-3-5-sonnet-v2@20241022')).toBe('sonnet 3.5')
    expect(modelLabel('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('sonnet 3.5')
  })

  test('shows an alias or an unknown id as it is, without the prefix', async () => {
    expect(modelLabel('haiku')).toBe('haiku')
    expect(modelLabel('claude-fable')).toBe('fable')
    expect(modelLabel('gpt-x')).toBe('gpt-x')
  })
})

describe('formatElapsed', () => {
  test('formats seconds, minutes and hours', async () => {
    expect(formatElapsed(42_000)).toBe('42s')
    expect(formatElapsed(185_000)).toBe('3m 05s')
    expect(formatElapsed(3_720_000)).toBe('1h 02m')
  })

  test('shows zero for negative or sub-second spans', async () => {
    expect(formatElapsed(-5000)).toBe('0s')
    expect(formatElapsed(999)).toBe('0s')
  })

  test('switches unit exactly at the minute and the hour', async () => {
    expect(formatElapsed(59_999)).toBe('59s')
    expect(formatElapsed(60_000)).toBe('1m 00s')
    expect(formatElapsed(3_599_999)).toBe('59m 59s')
    expect(formatElapsed(3_600_000)).toBe('1h 00m')
  })
})

describe('statusText and tabTitle', () => {
  test('are undefined with no active agent', async () => {
    const rows = [row({ id: 'a', status: 'completed', endedAt: 1 })]

    expect(statusText(rows)).toBeUndefined()
    expect(tabTitle(rows)).toBeUndefined()
  })

  test('count active agents and list their names once', async () => {
    const rows = [
      row({ id: 'a', label: 'tester' }),
      row({ id: 'b', label: 'revisor', status: 'waiting' }),
      row({ id: 'c', label: 'revisor', status: 'pending' }),
      row({ id: 'd', label: 'documentador', status: 'idle' }),
    ]

    expect(statusText(rows)).toBe('🤖 3 agentes en ejecución')
    expect(tabTitle(rows)).toBe('🤖 3 agentes · tester, revisor')
  })

  test('use the singular for one agent', async () => {
    const rows = [row({ id: 'a', label: 'tester' })]

    expect(statusText(rows)).toBe('🤖 1 agente en ejecución')
    expect(tabTitle(rows)).toBe('🤖 1 agente · tester')
  })

  test('leave a title of exactly seventy characters whole', async () => {
    const prefix = '🤖 1 agente · '
    const label = 'x'.repeat(70 - Array.from(prefix).length)
    const title = tabTitle([row({ id: 'a', label })]) ?? ''

    expect(Array.from(title).length).toBe(70)
    expect(title.endsWith('x')).toBe(true)
  })

  test('strips control characters and truncates long titles', async () => {
    const rows = [row({ id: 'a', label: `x\u001b]0;evil\u0007${'y'.repeat(100)}` })]
    const title = tabTitle(rows) ?? ''

    expect(title.includes('\u001b')).toBe(false)
    expect(title.includes('\u0007')).toBe(false)
    expect(Array.from(title).length).toBe(70)
    expect(title.endsWith('…')).toBe(true)
  })

  test('never splits an emoji when truncating', async () => {
    const rows = [row({ id: 'a', label: '🧪'.repeat(80) })]
    const title = tabTitle(rows) ?? ''

    expect(/\p{Cs}/u.test(title)).toBe(false)
    expect(Array.from(title).length).toBe(70)
  })
})

describe('stripUnsafeChars', () => {
  test('removes C1 escapes, ST-terminated OSC, line separators, blank fillers and lone surrogates', async () => {
    expect(stripUnsafeChars('a\u009b31mb\u001b]8;;x\u001b\\c')).toBe('a31mb]8;;x\\c')
    expect(stripUnsafeChars('uno\u2028dos\u2029tres')).toBe('unodostres')
    expect(stripUnsafeChars('re\u3164vi\u115fsor\uffa0')).toBe('revisor')
    expect(stripUnsafeChars('x\ud800y')).toBe('xy')
  })

  test('keeps regular text and emoji', async () => {
    expect(stripUnsafeChars('🤖 Revisión · ñ')).toBe('🤖 Revisión · ñ')
  })
})

describe('buildAgentTree', () => {
  const shape = (rows: AgentRow[]) => buildAgentTree(rows).map(line => `${line.guide}${line.row.id}`)

  test('nests agents under the agent that spawned them, oldest first', async () => {
    const rows = [
      row({ id: 'root', startedAt: 0 }),
      row({ id: 'b', parentId: 'root', startedAt: 2 }),
      row({ id: 'a', parentId: 'root', startedAt: 1 }),
      row({ id: 'a1', parentId: 'a', startedAt: 3 }),
      row({ id: 'solo', startedAt: 4 }),
    ]

    expect(shape(rows)).toEqual(['root', '├─ a', '│  └─ a1', '└─ b', 'solo'])
  })

  test('keeps the guides going on description lines', async () => {
    const lines = buildAgentTree([
      row({ id: 'root' }),
      row({ id: 'a', parentId: 'root', startedAt: 1 }),
      row({ id: 'b', parentId: 'root', startedAt: 2 }),
    ])

    expect(lines.map(line => line.detailGuide)).toEqual(['│ ', '│    ', '     '])
  })

  test('keeps an ended parent so its running child stays connected', async () => {
    const rows = [
      row({ id: 'parent', status: 'completed', endedAt: 5 }),
      row({ id: 'child', parentId: 'parent', startedAt: 1 }),
      row({ id: 'other-ended', status: 'completed', endedAt: 5 }),
    ]

    expect(shape(rows)).toEqual(['parent', '└─ child'])
  })

  test('treats an agent whose parent is unknown as a root', async () => {
    expect(shape([row({ id: 'orphan', parentId: 'gone' })])).toEqual(['orphan'])
  })

  test('does not hang on a parent loop through an ended agent', async () => {
    const rows = [
      row({ id: 'a', status: 'completed', endedAt: 1, parentId: 'b' }),
      row({ id: 'b', status: 'completed', endedAt: 1, parentId: 'a' }),
      row({ id: 'child', parentId: 'a' }),
    ]

    expect(buildAgentTree(rows).length).toBeLessThanOrEqual(3)
  })

  test('still shows every active agent when parent links form a loop', async () => {
    const rows = [row({ id: 'a', parentId: 'b', startedAt: 1 }), row({ id: 'b', parentId: 'a', startedAt: 2 })]

    expect(shape(rows).map(line => line.replace(/^[│├└─ ]+/u, '')).sort()).toEqual(['a', 'b'])
  })

  test('still shows an active agent that names itself as its parent', async () => {
    expect(shape([row({ id: 'self', parentId: 'self' })])).toEqual(['self'])
  })

  test('shows an idle agent (a teammate waiting for a message) in the tree, not as ended', async () => {
    const rows = [row({ id: 'lead' }), row({ id: 'mate', parentId: 'lead', status: 'idle', startedAt: 1 })]

    expect(shape(rows)).toEqual(['lead', '└─ mate'])
  })

  test('is empty with no active agent', async () => {
    expect(buildAgentTree([row({ id: 'a', status: 'failed', endedAt: 1 })])).toEqual([])
  })
})

describe('ttyFromPs', () => {
  const OWN = 'ps -A -ww -o pid= -o ppid= -o tty= -o command='
  const macTree = `
    1     0 ??       /sbin/launchd
  400     1 ttys010  -zsh
  500   400 ttys010  claude
  600   500 ??       ${OWN}
`

  test('finds the tty of the shell above Claude Code on macOS', async () => {
    expect(ttyFromPs(macTree, OWN)).toBe('/dev/ttys010')
  })

  test('supports Linux procps pts ttys', async () => {
    const out = `
    1     0 ?        /sbin/init
  400     1 pts/3    bash
  500   400 ?        claude
  600   500 ?        ${OWN}
`
    expect(ttyFromPs(out, OWN)).toBe('/dev/pts/3')
  })

  test('matches the own row when argv[0] has an absolute path', async () => {
    const out = macTree.replace(OWN, `/bin/${OWN}`)
    expect(ttyFromPs(out, OWN)).toBe('/dev/ttys010')
  })

  test('returns undefined when the own row is missing', async () => {
    expect(ttyFromPs(macTree.replace(OWN, 'sleep 1'), OWN)).toBeUndefined()
  })

  test('returns undefined when every process up to pid 1 has no tty', async () => {
    const out = `1 0 ?? /sbin/launchd\n500 1 ?? claude\n600 500 ?? ${OWN}`
    expect(ttyFromPs(out, OWN)).toBeUndefined()
  })

  test('does not use the tty of pid 1', async () => {
    const out = `1 0 ttys001 /sbin/launchd\n500 1 ?? claude\n600 500 ?? ${OWN}`
    expect(ttyFromPs(out, OWN)).toBeUndefined()
  })

  test('returns undefined for empty output and ignores headers and garbage', async () => {
    expect(ttyFromPs('', OWN)).toBeUndefined()
    expect(ttyFromPs(`  PID  PPID TTY COMMAND\nnot a row\n${macTree}\n???`, OWN)).toBe('/dev/ttys010')
  })

  test('terminates on a parent cycle', async () => {
    const out = `1 0 ?? /sbin/launchd\n700 600 ?? foo\n600 700 ?? ${OWN}`
    expect(ttyFromPs(out, OWN)).toBeUndefined()
  })

  test('returns undefined when a parent is missing', async () => {
    const out = `1 0 ?? /sbin/launchd\n600 999 ?? ${OWN}`
    expect(ttyFromPs(out, OWN)).toBeUndefined()
  })

  test('does not keep climbing past an unsafe tty', async () => {
    const grand = '300 1 ttys010 -zsh'
    for (const tty of ['console', 'ttys0;x']) {
      const out = `1 0 ?? /sbin/launchd\n${grand}\n500 300 ${tty} claude\n600 500 ?? ${OWN}`
      expect(ttyFromPs(out, OWN)).toBeUndefined()
    }
  })

  test('parses commands with several spaces or tabs and tabs between columns', async () => {
    const out = `1 0 ?? /sbin/launchd\n400\t1\tttys010\t-zsh\n500 400 ttys010   claude\n600 500 ??\t${OWN}\t`
    expect(ttyFromPs(out, OWN)).toBe('/dev/ttys010')
  })

  test('does not match a command with extra spaces inside', async () => {
    const out = macTree.replace(OWN, OWN.replace('-A -ww', '-A  -ww'))
    expect(ttyFromPs(out, OWN)).toBeUndefined()
  })

  test('with several rows of the same command, requires them to agree', async () => {
    const same = `${macTree}\n601 500 ?? ${OWN}`
    expect(ttyFromPs(same, OWN)).toBe('/dev/ttys010')
    const other = `${same}\n450 1 ttys020 -zsh\n602 450 ?? ${OWN}`
    expect(ttyFromPs(other, OWN)).toBeUndefined()
  })
})

describe('titleSequence', () => {
  test('wraps the title in an OSC 0 sequence terminated by BEL', async () => {
    expect(titleSequence('🤖 2 agentes')).toBe('\u001b]0;🤖 2 agentes\u0007')
  })

  test('keeps semicolons and spaces, which are valid inside an OSC title', async () => {
    expect(titleSequence('a; b;c')).toBe('\u001b]0;a; b;c\u0007')
  })

  test('returns an empty title for an empty string', async () => {
    expect(titleSequence('')).toBe('\u001b]0;\u0007')
  })

  test('removes escape, bell and control characters from the title', async () => {
    expect(titleSequence('a\u001b]0;x\u0007b\nc')).toBe('\u001b]0;a]0;xbc\u0007')
  })
})
