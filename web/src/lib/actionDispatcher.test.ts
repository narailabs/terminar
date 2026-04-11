import { describe, it, expect, vi } from 'vitest';
import { createActionDispatcher, type ActionCallbacks } from './actionDispatcher';

function makeCallbacks(): ActionCallbacks {
  return {
    onSearchOpen: vi.fn(),
    onSearchClose: vi.fn(),
    onSessionNew: vi.fn(),
    onSidebarToggle: vi.fn(),
    onPaneClose: vi.fn(),
    onSplitHorizontal: vi.fn(),
    onSplitVertical: vi.fn(),
    onPaneFocus: vi.fn(),
    onPaneNext: vi.fn(),
    onPanePrevious: vi.fn(),
    onTabNext: vi.fn(),
    onTabPrevious: vi.fn(),
  };
}

describe('createActionDispatcher', () => {
  it('dispatches search.open to onSearchOpen', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    dispatch('search.open');
    expect(callbacks.onSearchOpen).toHaveBeenCalledOnce();
  });

  it('dispatches search.close to onSearchClose', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    dispatch('search.close');
    expect(callbacks.onSearchClose).toHaveBeenCalledOnce();
  });

  it('dispatches session.new to onSessionNew', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    dispatch('session.new');
    expect(callbacks.onSessionNew).toHaveBeenCalledOnce();
  });

  it('dispatches sidebar.toggle to onSidebarToggle', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    dispatch('sidebar.toggle');
    expect(callbacks.onSidebarToggle).toHaveBeenCalledOnce();
  });

  it('dispatches pane.close to onPaneClose', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    dispatch('pane.close');
    expect(callbacks.onPaneClose).toHaveBeenCalledOnce();
  });

  it('dispatches split.horizontal to onSplitHorizontal', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    dispatch('split.horizontal');
    expect(callbacks.onSplitHorizontal).toHaveBeenCalledOnce();
  });

  it('dispatches split.vertical to onSplitVertical', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    dispatch('split.vertical');
    expect(callbacks.onSplitVertical).toHaveBeenCalledOnce();
  });

  it('returns false for unknown action and calls no callbacks', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    const result = dispatch('unknown.action');
    expect(result).toBe(false);
    expect(callbacks.onSearchOpen).not.toHaveBeenCalled();
    expect(callbacks.onSearchClose).not.toHaveBeenCalled();
    expect(callbacks.onSessionNew).not.toHaveBeenCalled();
    expect(callbacks.onSidebarToggle).not.toHaveBeenCalled();
    expect(callbacks.onPaneClose).not.toHaveBeenCalled();
    expect(callbacks.onSplitHorizontal).not.toHaveBeenCalled();
    expect(callbacks.onSplitVertical).not.toHaveBeenCalled();
  });

  it('returns true when action is dispatched successfully', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    expect(dispatch('search.open')).toBe(true);
    expect(dispatch('search.close')).toBe(true);
    expect(dispatch('session.new')).toBe(true);
    expect(dispatch('sidebar.toggle')).toBe(true);
    expect(dispatch('pane.close')).toBe(true);
    expect(dispatch('split.horizontal')).toBe(true);
    expect(dispatch('split.vertical')).toBe(true);
  });

  it('can dispatch the same action multiple times', () => {
    const callbacks = makeCallbacks();
    const dispatch = createActionDispatcher(callbacks);
    dispatch('search.open');
    dispatch('search.open');
    dispatch('search.open');
    expect(callbacks.onSearchOpen).toHaveBeenCalledTimes(3);
  });
});
