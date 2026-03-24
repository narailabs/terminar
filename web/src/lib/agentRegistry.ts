/**
 * Agent Registry for terminar (F9a)
 *
 * Detects AI coding agents by their process name and provides
 * display metadata (name, color, icon) for UI rendering.
 */

export interface AgentDefinition {
  id: string;
  displayName: string;
  processNames: string[];
  color: string;
  icon: string;
}

const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    processNames: ['claude'],
    color: '#D97706',
    icon: 'C',
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    processNames: ['gemini'],
    color: '#4285F4',
    icon: 'G',
  },
  {
    id: 'codex-cli',
    displayName: 'Codex CLI',
    processNames: ['codex'],
    color: '#10A37F',
    icon: 'X',
  },
  {
    id: 'cursor-agent',
    displayName: 'Cursor Agent',
    processNames: ['cursor-agent', 'cursor'],
    color: '#7C3AED',
    icon: 'U',
  },
  {
    id: 'aider',
    displayName: 'Aider',
    processNames: ['aider'],
    color: '#22C55E',
    icon: 'A',
  },
  {
    id: 'amazon-q',
    displayName: 'Amazon Q',
    processNames: ['q'],
    color: '#FF9900',
    icon: 'Q',
  },
  {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    processNames: ['copilot', 'gh-copilot'],
    color: '#6E40C9',
    icon: 'P',
  },
];

/**
 * Build a lookup map from lowercase process name to agent definition.
 */
function buildLookup(agents: AgentDefinition[]): Map<string, AgentDefinition> {
  const map = new Map<string, AgentDefinition>();
  for (const agent of agents) {
    for (const name of agent.processNames) {
      map.set(name.toLowerCase(), agent);
    }
  }
  return map;
}

const defaultLookup = buildLookup(BUILTIN_AGENTS);

/**
 * Match a process name against built-in agents.
 * Returns the matching AgentDefinition or null.
 */
export function matchAgent(processName: string): AgentDefinition | null {
  if (!processName) return null;
  return defaultLookup.get(processName.toLowerCase()) ?? null;
}

/**
 * Returns a copy of the built-in agent definitions.
 */
export function getBuiltinAgents(): AgentDefinition[] {
  return [...BUILTIN_AGENTS];
}

/**
 * Create a registry with optional custom agents.
 * Custom agents with the same id as a built-in agent override it.
 */
export function createRegistry(customAgents?: AgentDefinition[]) {
  const agentMap = new Map<string, AgentDefinition>();

  // Add built-ins first
  for (const agent of BUILTIN_AGENTS) {
    agentMap.set(agent.id, agent);
  }

  // Override/add custom agents
  if (customAgents) {
    for (const agent of customAgents) {
      agentMap.set(agent.id, agent);
    }
  }

  const allAgents = [...agentMap.values()];
  const lookup = buildLookup(allAgents);

  return {
    matchAgent(processName: string): AgentDefinition | null {
      if (!processName) return null;
      return lookup.get(processName.toLowerCase()) ?? null;
    },

    getAll(): AgentDefinition[] {
      return [...allAgents];
    },
  };
}
