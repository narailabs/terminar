import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

// Mock xterm and addons (Pane -> Terminal -> xterm dependency chain)
vi.mock('xterm', () => ({
  Terminal: vi.fn().mockImplementation(function() {
    return {
      open: vi.fn(),
      loadAddon: vi.fn(),
      write: vi.fn(),
      onData: vi.fn(),
      dispose: vi.fn(),
      clear: vi.fn(),
      reset: vi.fn(),
      resize: vi.fn(),
      focus: vi.fn(),
      scrollToBottom: vi.fn(),
      getSelection: vi.fn().mockReturnValue(''),
      selectAll: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      cols: 80,
      rows: 24,
      options: {
        fontSize: 14,
        fontFamily: 'Menlo',
        cursorStyle: 'block',
        cursorBlink: true,
        lineHeight: 1.0,
        theme: {},
      },
      buffer: {
        normal: { length: 0 },
        active: { length: 0, viewportY: 0, baseY: 0 },
      },
      unicode: {
        activeVersion: '6',
      },
    };
  }),
}));

vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function() {
    return { fit: vi.fn(), proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }) };
  }),
}));

vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: vi.fn() }));
vi.mock('xterm-addon-unicode11', () => ({ Unicode11Addon: vi.fn() }));

vi.mock('xterm-addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(function() {
    return {
      dispose: vi.fn(),
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clearDecorations: vi.fn(),
      onDidChangeResults: vi.fn(),
    };
  }),
}));

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

import SplitContainer from './SplitContainer.svelte';
import type { Pane as PaneNode, SplitContainer as SplitContainerType } from '../lib/workspaceTypes';

describe('SplitContainer', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a Pane when node type is pane', () => {
    const node: PaneNode = { type: 'pane', id: 'pane-1', sessionId: null };
    const { container } = render(SplitContainer, { props: { node } });

    // Pane component renders a div with class "pane"
    expect(container.querySelector('.pane')).toBeTruthy();
  });

  it('renders split container with horizontal direction', () => {
    const node: SplitContainerType = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      children: [
        { type: 'pane', id: 'p1', sessionId: null },
        { type: 'pane', id: 'p2', sessionId: null },
      ],
      ratios: [0.5, 0.5],
    };
    const { container } = render(SplitContainer, { props: { node } });

    const splitEl = container.querySelector('.split-container');
    expect(splitEl).toBeTruthy();
    expect(splitEl?.classList.contains('horizontal')).toBe(true);
    expect(splitEl?.classList.contains('vertical')).toBe(false);
  });

  it('renders split container with vertical direction', () => {
    const node: SplitContainerType = {
      type: 'split',
      id: 'split-1',
      direction: 'vertical',
      children: [
        { type: 'pane', id: 'p1', sessionId: null },
        { type: 'pane', id: 'p2', sessionId: null },
      ],
      ratios: [0.5, 0.5],
    };
    const { container } = render(SplitContainer, { props: { node } });

    const splitEl = container.querySelector('.split-container');
    expect(splitEl).toBeTruthy();
    expect(splitEl?.classList.contains('vertical')).toBe(true);
    expect(splitEl?.classList.contains('horizontal')).toBe(false);
  });

  it('renders correct number of children and handles (2 children = 1 handle)', () => {
    const node: SplitContainerType = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      children: [
        { type: 'pane', id: 'p1', sessionId: null },
        { type: 'pane', id: 'p2', sessionId: null },
      ],
      ratios: [0.5, 0.5],
    };
    const { container } = render(SplitContainer, { props: { node } });

    // Each child is in a .split-child div
    const splitChildren = container.querySelectorAll('.split-child');
    expect(splitChildren.length).toBe(2);

    // There should be exactly 1 handle between 2 children
    const handles = container.querySelectorAll('.split-handle');
    expect(handles.length).toBe(1);
  });

  it('applies correct flex-basis style on split children accounting for handle size', () => {
    const node: SplitContainerType = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      children: [
        { type: 'pane', id: 'p1', sessionId: null },
        { type: 'pane', id: 'p2', sessionId: null },
      ],
      ratios: [0.6, 0.4],
    };
    const { container } = render(SplitContainer, { props: { node } });

    const splitChildren = container.querySelectorAll('.split-child');
    expect(splitChildren.length).toBe(2);

    // getFlexBasis(ratio, handleCount) = `calc(${ratio * 100}% - ${handleSize * handleCount * ratio}px)`
    // handleSize = 4, handleCount = 1 (2 children - 1)
    // child 0: ratio=0.6 => calc(60% - 2.4px)
    // child 1: ratio=0.4 => calc(40% - 1.6px)
    const style0 = (splitChildren[0] as HTMLElement).style.cssText;
    const style1 = (splitChildren[1] as HTMLElement).style.cssText;

    expect(style0).toContain('calc(60% - 2.4px)');
    expect(style1).toContain('calc(40% - 1.6px)');
  });
});
