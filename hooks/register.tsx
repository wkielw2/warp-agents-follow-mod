import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeKey } from 'claude-code'

import type { AgentRow, AgentRowStatus, AgentTreeLine } from '../types'
import { buildAgentTree, formatElapsed, isActive, isLive, mergeAgents, statusText, stripUnsafeChars, tabTitle } from './agents'

const PANE = 'agentes'
const PANE_TITLE = 'Agentes'
const TICK_MS = 1000
const TITLE_REFRESH_TICKS = 10
const IDLE_TAB_TITLE = 'Claude Code'
const TTY_PATH = /^\/dev\/(ttys?\d+|pts\/\d+)$/

// Walks up from the shell to the first ancestor attached to a terminal
// (the claude process) and prints its device, e.g. /dev/ttys010. `set -f`
// keeps `?`/`??` (no terminal on Linux/macOS) from globbing against the cwd.
const FIND_TTY_SCRIPT =
  'set -f; p=$$; while [ "$p" -gt 1 ]; do set -- $(ps -o ppid= -o tty= -p "$p"); ' +
  '[ -n "$1" ] || exit 1; ' +
  'case "$2" in ""|"?"|"??") ;; *) echo "/dev/$2"; exit 0 ;; esac; p=$1; done; exit 1'
// OSC 0: sets the tab and window title in Warp, iTerm2, Terminal.app and others.
const WRITE_TITLE_SCRIPT = 'printf "\\033]0;%s\\007" "$1" > "$2"'

const agents = atom({ plugin: 'agentes-activos', key: 'agents' } as const, [])
const now = atom({ plugin: 'agentes-activos', key: 'now' } as const, 0)

type StatusStyle = { icon: string; color: ThemeKey; word?: string }

const STATUS_STYLE: Record<AgentRowStatus, StatusStyle> = {
  pending: { icon: '◌', color: 'subtle', word: 'en cola' },
  running: { icon: '◐', color: 'claude' },
  waiting: { icon: '◔', color: 'warning', word: 'esperando' },
  idle: { icon: '○', color: 'subtle', word: 'inactivo' },
  completed: { icon: '✓', color: 'success' },
  failed: { icon: '✗', color: 'error', word: 'falló' },
  killed: { icon: '■', color: 'inactive', word: 'detenido' },
}

// Advances once per tick, so a running agent's icon turns while it works.
const SPINNER_FRAMES = ['◐', '◓', '◑', '◒']

const iconOf = (row: AgentRow, time: number): string =>
  row.status === 'running'
    ? (SPINNER_FRAMES[Math.floor(time / TICK_MS) % SPINNER_FRAMES.length] ?? STATUS_STYLE.running.icon)
    : STATUS_STYLE[row.status].icon

// Per-load session state; a hot reload starts it over.
const session: {
  ttyPath?: string
  lastTitle?: string
  lastStatus?: string
  ticksSinceTitle: number
  isTicking: boolean
  hasAutoOpened: boolean
} = { ticksSinceTitle: 0, isTicking: false, hasAutoOpened: false }

async function findTty($: EngineInterface): Promise<string | undefined> {
  const { exitCode, stdout } = await $.process.run(['sh', '-c', FIND_TTY_SCRIPT], { timeoutMs: 5000 })
  const path = stdout.trim()

  return exitCode === 0 && TTY_PATH.test(path) ? path : undefined
}

async function writeTitle($: EngineInterface, title: string): Promise<void> {
  if (!session.ttyPath) return
  const { exitCode } = await $.process.run(['sh', '-c', WRITE_TITLE_SCRIPT, 'sh', title, session.ttyPath], {
    timeoutMs: 5000,
  })
  if (exitCode !== 0) throw new Error(`title write exited with ${exitCode}`)
}

// Claude Code may rewrite the title on its own, so while agents run the
// title is written again every few ticks, not only when it changes.
async function syncTitle($: EngineInterface, rows: AgentRow[]): Promise<void> {
  const title = tabTitle(rows)
  session.ticksSinceTitle += 1
  const isDue = title !== undefined && session.ticksSinceTitle >= TITLE_REFRESH_TICKS
  if (title === session.lastTitle && !isDue) return

  session.ticksSinceTitle = 0
  const wasShowingAgents = session.lastTitle !== undefined
  if (title !== undefined) await writeTitle($, title)
  else if (wasShowingAgents) await writeTitle($, IDLE_TAB_TITLE)
  // Set only after a write that worked, so a failed one is retried next tick.
  session.lastTitle = title
}

async function tick($: EngineInterface): Promise<void> {
  if (session.isTicking) return
  session.isTicking = true
  try {
    const [previous, infos, time] = await Promise.all([read($, agents), $.agent.list(), $.clock.now()])
    const rows = mergeAgents(previous, infos, time)
    const hasChanged = JSON.stringify(rows) !== JSON.stringify(previous)

    if (hasChanged) await update($, agents, () => rows)
    if (hasChanged || rows.some(row => isLive(row.status))) await update($, now, () => time)

    const status = statusText(rows)
    if (status !== session.lastStatus) {
      session.lastStatus = status
      $.ui.status(status)
    }
    await syncTitle($, rows)
  } catch {
    // A failed tick (agent list, state or title write) is retried on the next one.
  } finally {
    session.isTicking = false
  }
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: PANE_TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'agentes',
      description: 'Muestra el panel de subagentes en ejecución',
    })
    // Not awaited: session.start holds the first prompt, and `ps` may be slow.
    void findTty($)
      .then(path => {
        session.ttyPath = path
      })
      .catch(() => undefined)
    $.clock.every(TICK_MS, () => tick($))

    return started
  })

  on('command.run', { command: 'agentes' }, async $ => {
    await openPane($)
    await tick($)

    return { text: 'Panel de agentes abierto.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId === undefined) return spawned

    if (!session.hasAutoOpened) {
      session.hasAutoOpened = true
      void openPane($)
    }
    void tick($)

    return spawned
  }).catch(($, e, next) => next(e)) // never block a spawn because the panel failed

  on('session.end', async ($, e, next) => {
    if (session.lastTitle !== undefined) await writeTitle($, IDLE_TAB_TITLE).catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [rows, time] = await Promise.all([read($, agents), read($, now)])
    const active = rows.filter(row => isActive(row.status))
    const tree = buildAgentTree(rows)
    const inTree = new Set(tree.map(line => line.row.id))
    const ended = rows
      .filter(row => !isLive(row.status) && !inTree.has(row.id))
      .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
    const elapsedOf = (row: AgentRow) => formatElapsed((row.endedAt ?? time) - row.startedAt)

    // An ended agent stays in the tree, dimmed, while a child of it still runs;
    // an idle one is shown there too, with its status word.
    const treeRow = ({ row, guide, detailGuide }: AgentTreeLine) => {
      const style = STATUS_STYLE[row.status]
      const isRowActive = isActive(row.status)
      const label = stripUnsafeChars(row.label)
      // Rows saved by an earlier version of the mod have no type.
      const type = stripUnsafeChars(row.type ?? row.label)
      const description = stripUnsafeChars(row.description)

      return (
        <Box key={row.id} flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" flexShrink={1}>
              <Text dimColor>{guide}</Text>
              <Text color={style.color}>{iconOf(row, time)} </Text>
              <Text bold={isRowActive} dimColor={!isRowActive} wrap="truncate-end">
                {label}
              </Text>
              {type !== label && <Text dimColor wrap="truncate-end"> {type}</Text>}
              {style.word && <Text color={style.color}> · {style.word}</Text>}
            </Box>
            <Text tabular color={isRowActive ? 'claude' : undefined} dimColor={!isRowActive}>
              {' '}
              {elapsedOf(row)}
            </Text>
          </Box>
          {description !== '' && (
            <Box flexDirection="row">
              <Text dimColor>{detailGuide}</Text>
              <Text dimColor wrap="truncate-end">{description}</Text>
            </Box>
          )}
        </Box>
      )
    }

    const endedRow = (row: AgentRow) => {
      const style = STATUS_STYLE[row.status]
      const label = stripUnsafeChars(row.label)
      const description = stripUnsafeChars(row.description)

      return (
        <Box key={row.id} flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" flexShrink={1}>
            <Text color={style.color}>{style.icon} </Text>
            <Text dimColor wrap="truncate-end">
              {label}
              {style.word ? ` · ${style.word}` : ''}
              {description ? ` · ${description}` : ''}
            </Text>
          </Box>
          <Text tabular dimColor> {elapsedOf(row)}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold color={active.length > 0 ? 'claude' : 'subtle'}>{active.length}</Text>
          <Text bold> en ejecución</Text>
          {ended.length > 0 && <Text dimColor>{`  ·  ${ended.length} terminados`}</Text>}
        </Box>
        <Text dimColor>{'─'.repeat(Math.max(0, e.props.bodyColumns))}</Text>
        {active.length === 0 ? (
          <Text dimColor>Sin agentes en ejecución. Aparecerán aquí al lanzarse.</Text>
        ) : (
          <Box flexDirection="column">{tree.map(treeRow)}</Box>
        )}
        {ended.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor bold>
              TERMINADOS
            </Text>
            {ended.map(endedRow)}
          </Box>
        )}
      </Box>
    )
  })
}
