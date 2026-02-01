import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConnectionStatus from './ConnectionStatus.svelte';

describe('ConnectionStatus Component', () => {
  it('should show "Connected" text when state is connected', () => {
    render(ConnectionStatus, { props: { state: 'connected' } });
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('should show "Connecting..." text when state is connecting', () => {
    render(ConnectionStatus, { props: { state: 'connecting' } });
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('should show "Disconnected" text when state is disconnected', () => {
    render(ConnectionStatus, { props: { state: 'disconnected' } });
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  it('should show reconnection countdown when state is reconnecting', () => {
    render(ConnectionStatus, {
      props: {
        state: 'reconnecting',
        reconnectAttempt: 3,
        reconnectDelay: 5000,
      },
    });
    expect(screen.getByText(/Reconnecting in 5s/)).toBeTruthy();
    expect(screen.getByText(/attempt 3/)).toBeTruthy();
  });

  it('should show reconnect button when disconnected and onReconnect is provided', () => {
    const onReconnect = vi.fn();
    render(ConnectionStatus, {
      props: {
        state: 'disconnected',
        onReconnect,
      },
    });
    const button = screen.getByText('Reconnect');
    expect(button).toBeTruthy();
  });

  it('should not show reconnect button when connected', () => {
    const onReconnect = vi.fn();
    render(ConnectionStatus, {
      props: {
        state: 'connected',
        onReconnect,
      },
    });
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  it('should not show reconnect button when disconnected but no onReconnect', () => {
    render(ConnectionStatus, {
      props: {
        state: 'disconnected',
      },
    });
    expect(screen.queryByText('Reconnect')).toBeNull();
  });

  it('should call onReconnect when reconnect button is clicked', async () => {
    const onReconnect = vi.fn();
    render(ConnectionStatus, {
      props: {
        state: 'disconnected',
        onReconnect,
      },
    });
    const button = screen.getByText('Reconnect');
    await fireEvent.click(button);
    expect(onReconnect).toHaveBeenCalled();
  });

  it('should have a status indicator element', () => {
    render(ConnectionStatus, { props: { state: 'connected' } });
    const indicator = document.querySelector('.status-indicator');
    expect(indicator).toBeTruthy();
  });

  it('should apply connected CSS class when connected', () => {
    render(ConnectionStatus, { props: { state: 'connected' } });
    const container = document.querySelector('.connection-status');
    expect(container?.classList.contains('status-connected')).toBe(true);
  });

  it('should apply disconnected CSS class when disconnected', () => {
    render(ConnectionStatus, { props: { state: 'disconnected' } });
    const container = document.querySelector('.connection-status');
    expect(container?.classList.contains('status-disconnected')).toBe(true);
  });

  it('should apply connecting CSS class when connecting', () => {
    render(ConnectionStatus, { props: { state: 'connecting' } });
    const container = document.querySelector('.connection-status');
    expect(container?.classList.contains('status-connecting')).toBe(true);
  });

  it('should apply connecting CSS class when reconnecting', () => {
    render(ConnectionStatus, {
      props: {
        state: 'reconnecting',
        reconnectAttempt: 1,
        reconnectDelay: 1000,
      },
    });
    const container = document.querySelector('.connection-status');
    expect(container?.classList.contains('status-connecting')).toBe(true);
  });
});
