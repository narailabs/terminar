import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import BroadcastBar from '../BroadcastBar.svelte';
import {
  broadcastTargets,
  broadcastEnabled,
  addTarget,
  clearTargets,
  setSessionManager,
  broadcastInput,
} from '../../lib/broadcastStore.svelte';

function createMockManager() {
  return {
    sendInput: vi.fn(),
  };
}

describe('BroadcastBar', () => {
  beforeEach(() => {
    clearTargets();
    broadcastEnabled.value = true;
    setSessionManager(null);
  });

  it('renders input field and send button', () => {
    render(BroadcastBar);

    const input = screen.getByPlaceholderText(/broadcast/i);
    expect(input).toBeTruthy();

    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect(sendBtn).toBeTruthy();
  });

  it('Enter sends input + newline to all targets', async () => {
    const mockManager = createMockManager();
    setSessionManager(mockManager as any);

    addTarget('session-1');
    addTarget('session-2');

    render(BroadcastBar);

    const input = screen.getByPlaceholderText(/broadcast/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'ls -la' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockManager.sendInput).toHaveBeenCalledWith('session-1', 'ls -la\n');
    expect(mockManager.sendInput).toHaveBeenCalledWith('session-2', 'ls -la\n');
  });

  it('Send button sends input + newline to all targets', async () => {
    const mockManager = createMockManager();
    setSessionManager(mockManager as any);

    addTarget('session-1');

    render(BroadcastBar);

    const input = screen.getByPlaceholderText(/broadcast/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'echo hello' } });

    const sendBtn = screen.getByRole('button', { name: /send/i });
    await fireEvent.click(sendBtn);

    expect(mockManager.sendInput).toHaveBeenCalledWith('session-1', 'echo hello\n');
  });

  it('clears input after sending', async () => {
    const mockManager = createMockManager();
    setSessionManager(mockManager as any);

    addTarget('session-1');

    render(BroadcastBar);

    const input = screen.getByPlaceholderText(/broadcast/i) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'test' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(input.value).toBe('');
  });

  it('shows target count', () => {
    addTarget('session-1');
    addTarget('session-2');
    addTarget('session-3');

    render(BroadcastBar);

    const text = screen.getByText(/broadcasting to 3 session/i);
    expect(text).toBeTruthy();
  });

  it('shows zero targets message when none selected', () => {
    render(BroadcastBar);

    const text = screen.getByText(/no targets selected/i);
    expect(text).toBeTruthy();
  });

  it('calls onClose callback on Escape', async () => {
    const onClose = vi.fn();
    render(BroadcastBar, { props: { onClose } });

    const input = screen.getByPlaceholderText(/broadcast/i);
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not send empty input', async () => {
    const mockManager = createMockManager();
    setSessionManager(mockManager as any);

    addTarget('session-1');

    render(BroadcastBar);

    const input = screen.getByPlaceholderText(/broadcast/i) as HTMLInputElement;
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockManager.sendInput).not.toHaveBeenCalled();
  });
});
