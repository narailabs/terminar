import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createKeyEventHandler } from './keyEventHandler';
import { KeyBindingRegistry } from './keybindings';

function makeKeyEvent(overrides: Partial<KeyboardEvent> & { type: string }): KeyboardEvent {
  return {
    key: '',
    code: '',
    type: overrides.type,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe('createKeyEventHandler', () => {
  let registry: KeyBindingRegistry;
  let dispatch: ReturnType<typeof vi.fn>;
  let handler: (event: KeyboardEvent) => boolean;

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    registry = new KeyBindingRegistry();
    dispatch = vi.fn(() => true);
    handler = createKeyEventHandler(registry, dispatch);
  });

  it('returns true for keyup events (passes through to terminal)', () => {
    const event = makeKeyEvent({ type: 'keyup', key: 'f', ctrlKey: true });
    expect(handler(event)).toBe(true);
  });

  it('returns true for keydown with no matching binding', () => {
    const event = makeKeyEvent({ type: 'keydown', key: 'z', ctrlKey: true });
    expect(handler(event)).toBe(true);
  });

  it('returns false for keydown matching a keybinding (intercepted)', () => {
    const event = makeKeyEvent({ type: 'keydown', key: 'f', ctrlKey: true });
    expect(handler(event)).toBe(false);
  });

  it('calls dispatch with correct action name when key matches', () => {
    const event = makeKeyEvent({ type: 'keydown', key: 'f', ctrlKey: true });
    handler(event);
    expect(dispatch).toHaveBeenCalledWith('search.open');
  });

  it('calls event.preventDefault() when key is intercepted', () => {
    const event = makeKeyEvent({ type: 'keydown', key: 'f', ctrlKey: true });
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not call dispatch for unmatched keys', () => {
    const event = makeKeyEvent({ type: 'keydown', key: 'z' });
    handler(event);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
