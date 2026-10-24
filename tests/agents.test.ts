import { describe, expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { buildAgentTree, formatElapsed, mergeAgents, statusText, stripUnsafeChars, tabTitle } from '../hooks/agents'
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
