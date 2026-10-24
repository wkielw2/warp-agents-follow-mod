import type { AgentInfo } from 'claude-code'

import type { AgentRow, AgentRowStatus, AgentTreeLine } from '../types'

const ACTIVE_STATUSES: readonly AgentRowStatus[] = ['pending', 'running', 'waiting']
const KEEP_ENDED_MS = 5 * 60 * 1000
const MAX_ENDED_ROWS = 10
const MAX_TITLE_LENGTH = 70

export const isActive = (status: AgentRowStatus): boolean => ACTIVE_STATUSES.includes(status)

/** Active, or idle between turns (a teammate waiting for a message): not ended. */
export const isLive = (status: AgentRowStatus): boolean => isActive(status) || status === 'idle'

const isEnded = (status: AgentRowStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'killed'

// Agent names and descriptions are written by the model, so they may carry
// terminal escape sequences, invisible format characters (bidi, zero-width),
// line separators, blank fillers (Hangul) or lone surrogates.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u115f\u1160\u3164\uffa0\p{Cf}\p{Cs}]/gu

export const stripUnsafeChars = (text: string): string => text.replace(UNSAFE_CHARS, '')

const labelOf = (info: AgentInfo): string => stripUnsafeChars(info.name ?? info.type)

const updateRow = (row: AgentRow, info: AgentInfo, now: number): AgentRow => {
  const isResumed = row.endedAt !== undefined && isActive(info.status)
  const endedAt = isEnded(info.status) ? (row.endedAt ?? now) : undefined

  return {
    ...row,
    label: labelOf(info),
    type: stripUnsafeChars(info.type),
    description: stripUnsafeChars(info.description),
    status: info.status,
    startedAt: isResumed ? now : row.startedAt,
    endedAt,
    parentId: info.parentId,
  }
}

const newRow = (info: AgentInfo, now: number): AgentRow => ({
  id: info.id,
  label: labelOf(info),
  type: stripUnsafeChars(info.type),
  description: stripUnsafeChars(info.description),
  status: info.status,
  startedAt: now,
  endedAt: isEnded(info.status) ? now : undefined,
  parentId: info.parentId,
})

const pruneEnded = (rows: AgentRow[], now: number): AgentRow[] => {
  const recentEnded = rows
    .filter(row => row.endedAt !== undefined && now - row.endedAt <= KEEP_ENDED_MS)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, MAX_ENDED_ROWS)
  const keptIds = new Set(recentEnded.map(row => row.id))

  return rows.filter(row => row.endedAt === undefined || keptIds.has(row.id))
}

/**
 * Merges the engine's agent list into the rows the pane shows. Agents the
 * engine already dropped count as completed; ended ones stay a few minutes.
 */
export const mergeAgents = (rows: AgentRow[], infos: AgentInfo[], now: number): AgentRow[] => {
  const infoById = new Map(infos.map(info => [info.id, info]))
  const knownIds = new Set(rows.map(row => row.id))

  const updated = rows.map(row => {
    const info = infoById.get(row.id)
    if (info) return updateRow(row, info, now)
    if (row.endedAt !== undefined) return row

    return { ...row, status: 'completed' as const, endedAt: now }
  })
  const added = infos.filter(info => !knownIds.has(info.id)).map(info => newRow(info, now))

  return pruneEnded([...updated, ...added], now)
}

export const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  if (hours > 0) return `${hours}h ${pad(minutes)}m`
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`

  return `${seconds}s`
}

const countLabel = (count: number): string => (count === 1 ? '1 agente' : `${count} agentes`)

/** Status line text, or undefined when no agent is active. */
export const statusText = (rows: AgentRow[]): string | undefined => {
  const active = rows.filter(row => isActive(row.status))
  if (active.length === 0) return undefined

  return `🤖 ${countLabel(active.length)} en ejecución`
}

/** Terminal tab title, or undefined when no agent is active. */
export const tabTitle = (rows: AgentRow[]): string | undefined => {
  const active = rows.filter(row => isActive(row.status))
  if (active.length === 0) return undefined

  const names = [...new Set(active.map(row => row.label))].join(', ')
  const title = stripUnsafeChars(`🤖 ${countLabel(active.length)} · ${names}`)

  // Cut by code points so an emoji is never split into a lone surrogate.
  const chars = Array.from(title)

  return chars.length > MAX_TITLE_LENGTH ? `${chars.slice(0, MAX_TITLE_LENGTH - 1).join('')}…` : title
}

const ancestorsOf = (row: AgentRow, byId: Map<string, AgentRow>): AgentRow[] => {
  const ancestors: AgentRow[] = []
  const seen = new Set([row.id])
  let parent = row.parentId === undefined ? undefined : byId.get(row.parentId)
  while (parent && !seen.has(parent.id)) {
    ancestors.push(parent)
    seen.add(parent.id)
    parent = parent.parentId === undefined ? undefined : byId.get(parent.parentId)
  }

  return ancestors
}

/**
 * Lays out the live agents (active or idle) as a tree by who spawned whom.
 * Ended ancestors of a live agent are kept so the branch stays connected.
 */
export const buildAgentTree = (rows: AgentRow[]): AgentTreeLine[] => {
  const byId = new Map(rows.map(row => [row.id, row]))
  const included = new Map<string, AgentRow>()
  for (const row of rows.filter(one => isLive(one.status))) {
    for (const node of [row, ...ancestorsOf(row, byId)]) included.set(node.id, node)
  }

  const childrenOf = new Map<string | undefined, AgentRow[]>()
  for (const row of included.values()) {
    const parentKey = row.parentId !== undefined && included.has(row.parentId) ? row.parentId : undefined
    childrenOf.set(parentKey, [...(childrenOf.get(parentKey) ?? []), row])
  }
  for (const children of childrenOf.values()) children.sort((a, b) => a.startedAt - b.startedAt)

  const lines: AgentTreeLine[] = []
  const visited = new Set<string>()
  const visit = (row: AgentRow, guide: string, childPrefix: string) => {
    visited.add(row.id)
    const children = (childrenOf.get(row.id) ?? []).filter(child => !visited.has(child.id))
    lines.push({ row, guide, detailGuide: childPrefix + (children.length > 0 ? '│ ' : '  ') })
    children.forEach((child, index) => {
      const isLast = index === children.length - 1
      visit(child, childPrefix + (isLast ? '└─ ' : '├─ '), childPrefix + (isLast ? '   ' : '│  '))
    })
  }
  for (const root of childrenOf.get(undefined) ?? []) visit(root, '', '')
  // Parent links that loop leave no root to reach them: show them as roots.
  const unreached = [...included.values()].filter(row => !visited.has(row.id))
  for (const row of unreached.sort((a, b) => a.startedAt - b.startedAt)) {
    if (!visited.has(row.id)) visit(row, '', '')
  }

  return lines
}

const TTY_PATH = /^\/dev\/(ttys?\d+|pts\/\d+)$/
const NO_TTY = new Set(['?', '??'])
const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*\S)\s*$/

type PsRow = { pid: number; ppid: number; tty: string; command: string }

const parsePsRows = (psOutput: string): Map<number, PsRow> => {
  const rows = new Map<number, PsRow>()
  for (const line of psOutput.split('\n')) {
    const match = PS_ROW.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    if (!rows.has(pid)) rows.set(pid, { pid, ppid: Number(match[2]), tty: match[3], command: match[4] })
  }

  return rows
}

// Walks up from `start` to the first process with a tty; an unsafe tty ends the walk.
const ttyAbove = (start: PsRow, byPid: Map<number, PsRow>): string | undefined => {
  const seen = new Set<number>()
  let current: PsRow | undefined = start
  while (current && current.pid > 1 && !seen.has(current.pid)) {
    seen.add(current.pid)
    if (!NO_TTY.has(current.tty)) {
      const path = `/dev/${current.tty}`

      return TTY_PATH.test(path) ? path : undefined
    }
    current = byPid.get(current.ppid)
  }

  return undefined
}

/**
 * Finds the terminal of Claude Code in the output of
 * `ps -A -ww -o pid= -o ppid= -o tty= -o command=`. The row of that same ps
 * (matched by its exact command line, with or without a path in argv[0]) is a
 * descendant of Claude Code; from that row it goes up through the parents to
 * the first process with a tty, which must be a valid one.
 * Returns undefined when it is missing, ambiguous or unsafe.
 */
export const ttyFromPs = (psOutput: string, ownCommand: string): string | undefined => {
  const byPid = parsePsRows(psOutput)
  const own = [...byPid.values()].filter(row => row.command.replace(/^\S*\//, '') === ownCommand)
  const results = new Set(own.map(row => ttyAbove(row, byPid)))

  return results.size === 1 ? [...results][0] : undefined
}

/** OSC sequence that sets the terminal tab title; the title is stripped of control characters. */
export const titleSequence = (title: string): string => `\u001b]0;${stripUnsafeChars(title)}\u0007`
