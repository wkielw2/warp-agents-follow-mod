export type AgentRowStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

export type AgentRow = {
  id: string
  label: string
  type: string
  description: string
  status: AgentRowStatus
  startedAt: number
  endedAt?: number
  /** The agent that spawned this one; absent when the main conversation did. */
  parentId?: string
}

/** One node of the agent tree, with the guides drawn before it. */
export type AgentTreeLine = {
  row: AgentRow
  /** Drawn before the node's icon: `├─ `, `└─ ` and the guides above it. */
  guide: string
  /** Drawn before the node's description line, keeping the guides going. */
  detailGuide: string
}

declare module 'claude-code' {
  interface PluginState {
    'agentes-activos': { agents: AgentRow[]; now: number }
  }
}
