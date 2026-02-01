import { describe, it, expect } from 'vitest';
import {
  matchAgent,
  getBuiltinAgents,
  createRegistry,
  type AgentDefinition,
} from './agentRegistry';

describe('agentRegistry', () => {
  // Test 1: matchAgent('claude') returns Claude Code agent definition
  it("matchAgent('claude') returns Claude Code agent definition", () => {
    const agent = matchAgent('claude');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('claude-code');
    expect(agent!.displayName).toBe('Claude Code');
    expect(agent!.processNames).toContain('claude');
    expect(agent!.color).toBe('#D97706');
    expect(agent!.icon).toBe('C');
  });

  // Test 2: matchAgent('gemini') returns Gemini CLI agent definition
  it("matchAgent('gemini') returns Gemini CLI agent definition", () => {
    const agent = matchAgent('gemini');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('gemini-cli');
    expect(agent!.displayName).toBe('Gemini CLI');
    expect(agent!.color).toBe('#4285F4');
    expect(agent!.icon).toBe('G');
  });

  // Test 3: matchAgent('codex') returns Codex CLI agent definition
  it("matchAgent('codex') returns Codex CLI agent definition", () => {
    const agent = matchAgent('codex');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('codex-cli');
    expect(agent!.displayName).toBe('Codex CLI');
    expect(agent!.color).toBe('#10A37F');
    expect(agent!.icon).toBe('X');
  });

  // Test 4: matchAgent('cursor-agent') returns Cursor Agent definition
  it("matchAgent('cursor-agent') returns Cursor Agent definition", () => {
    const agent = matchAgent('cursor-agent');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('cursor-agent');
    expect(agent!.displayName).toBe('Cursor Agent');
    expect(agent!.color).toBe('#7C3AED');
    expect(agent!.icon).toBe('U');
  });

  // Test 5: matchAgent('cursor') also returns Cursor Agent (multiple process names)
  it("matchAgent('cursor') also returns Cursor Agent definition", () => {
    const agent = matchAgent('cursor');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('cursor-agent');
  });

  // Test 6: matchAgent('aider') returns Aider definition
  it("matchAgent('aider') returns Aider definition", () => {
    const agent = matchAgent('aider');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('aider');
    expect(agent!.displayName).toBe('Aider');
    expect(agent!.color).toBe('#22C55E');
    expect(agent!.icon).toBe('A');
  });

  // Test 7: matchAgent('q') returns Amazon Q definition
  it("matchAgent('q') returns Amazon Q definition", () => {
    const agent = matchAgent('q');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('amazon-q');
    expect(agent!.displayName).toBe('Amazon Q');
    expect(agent!.color).toBe('#FF9900');
    expect(agent!.icon).toBe('Q');
  });

  // Test 8: matchAgent('copilot') returns GitHub Copilot definition
  it("matchAgent('copilot') returns GitHub Copilot definition", () => {
    const agent = matchAgent('copilot');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('github-copilot');
    expect(agent!.displayName).toBe('GitHub Copilot');
    expect(agent!.color).toBe('#6E40C9');
    expect(agent!.icon).toBe('P');
  });

  // Test 9: matchAgent('gh-copilot') also returns GitHub Copilot
  it("matchAgent('gh-copilot') also returns GitHub Copilot definition", () => {
    const agent = matchAgent('gh-copilot');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('github-copilot');
  });

  // Test 10: matchAgent('node') returns null (not an agent)
  it("matchAgent('node') returns null for non-agent process", () => {
    expect(matchAgent('node')).toBeNull();
  });

  // Test 11: matchAgent('zsh') returns null (shell, not an agent)
  it("matchAgent('zsh') returns null for shell process", () => {
    expect(matchAgent('zsh')).toBeNull();
  });

  // Test 12: matchAgent('vim') returns null (editor, not an agent)
  it("matchAgent('vim') returns null for editor process", () => {
    expect(matchAgent('vim')).toBeNull();
  });

  // Test 13: matchAgent('') returns null (empty string)
  it("matchAgent('') returns null for empty string", () => {
    expect(matchAgent('')).toBeNull();
  });

  // Test 14: matchAgent(null) handles null gracefully
  it('matchAgent(null) handles null gracefully', () => {
    expect(matchAgent(null as unknown as string)).toBeNull();
  });

  // Test 15: getBuiltinAgents() returns array with 7 built-in agents
  it('getBuiltinAgents() returns 7 built-in agents', () => {
    const agents = getBuiltinAgents();
    expect(agents).toHaveLength(7);
    const ids = agents.map((a) => a.id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('gemini-cli');
    expect(ids).toContain('codex-cli');
    expect(ids).toContain('cursor-agent');
    expect(ids).toContain('aider');
    expect(ids).toContain('amazon-q');
    expect(ids).toContain('github-copilot');
  });

  // Test 16: Custom agent can be added via createRegistry
  it('custom agent can be added via createRegistry', () => {
    const custom: AgentDefinition = {
      id: 'my-agent',
      displayName: 'My Agent',
      processNames: ['my-agent-proc'],
      color: '#FF0000',
      icon: 'M',
    };
    const registry = createRegistry([custom]);
    const all = registry.getAll();
    expect(all.find((a) => a.id === 'my-agent')).toBeDefined();
  });

  // Test 17: Custom agent matches by its process names
  it('custom agent matches by its process names', () => {
    const custom: AgentDefinition = {
      id: 'my-agent',
      displayName: 'My Agent',
      processNames: ['my-agent-proc'],
      color: '#FF0000',
      icon: 'M',
    };
    const registry = createRegistry([custom]);
    const matched = registry.matchAgent('my-agent-proc');
    expect(matched).not.toBeNull();
    expect(matched!.id).toBe('my-agent');
  });

  // Test 18: Custom agent overrides built-in agent with same id
  it('custom agent overrides built-in agent with same id', () => {
    const custom: AgentDefinition = {
      id: 'claude-code',
      displayName: 'Custom Claude',
      processNames: ['claude'],
      color: '#FF0000',
      icon: 'Z',
    };
    const registry = createRegistry([custom]);
    const agent = registry.matchAgent('claude');
    expect(agent).not.toBeNull();
    expect(agent!.displayName).toBe('Custom Claude');
    expect(agent!.color).toBe('#FF0000');
    expect(agent!.icon).toBe('Z');
  });

  // Test 19: Custom agent can override just the color of a built-in agent
  it('custom agent can override just the color of a built-in agent', () => {
    const custom: AgentDefinition = {
      id: 'claude-code',
      displayName: 'Claude Code',
      processNames: ['claude'],
      color: '#00FF00',
      icon: 'C',
    };
    const registry = createRegistry([custom]);
    const agent = registry.matchAgent('claude');
    expect(agent).not.toBeNull();
    expect(agent!.color).toBe('#00FF00');
    // Rest should remain
    expect(agent!.displayName).toBe('Claude Code');
    expect(agent!.icon).toBe('C');
  });

  // Test 20: Process name matching is case-insensitive
  it('process name matching is case-insensitive', () => {
    expect(matchAgent('Claude')).not.toBeNull();
    expect(matchAgent('CLAUDE')).not.toBeNull();
    expect(matchAgent('Gemini')).not.toBeNull();
    expect(matchAgent('AIDER')).not.toBeNull();
  });
});
