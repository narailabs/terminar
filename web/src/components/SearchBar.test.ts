import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import SearchBar from './SearchBar.svelte';

describe('SearchBar', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ── 1. Renders nothing when isOpen=false ────────────────────────────────

  it('renders nothing when isOpen=false', () => {
    const { container } = render(SearchBar, { props: { isOpen: false } });
    expect(container.querySelector('.search-bar')).toBeNull();
  });

  // ── 2. Renders search input when isOpen=true ────────────────────────────

  it('renders search input when isOpen=true', () => {
    const { container } = render(SearchBar, { props: { isOpen: true } });
    expect(container.querySelector('.search-bar')).toBeTruthy();
    expect(container.querySelector('.search-input')).toBeTruthy();
    expect(
      container.querySelector('.search-input')?.getAttribute('placeholder')
    ).toBe('Search...');
  });

  // ── 3. Dispatches 'search' event after 150ms debounce on input ──────────

  it('dispatches search event after 150ms debounce on input', async () => {
    vi.useFakeTimers();

    const searchHandler = vi.fn();
    const { container } = render(SearchBar, {
      props: { isOpen: true, caseSensitive: false, useRegex: false, onsearch: searchHandler },
    });

    const input = container.querySelector('.search-input') as HTMLInputElement;

    // Simulate typing by setting value then firing input event
    input.value = 'hello';
    // Svelte bind:value won't update from programmatic value change alone,
    // but the input event handler (handleInput) will fire and use the bound `query`.
    // We need to trigger the input event which calls handleInput.
    await fireEvent.input(input, { target: { value: 'hello' } });

    // Should not be called immediately
    expect(searchHandler).not.toHaveBeenCalled();

    // Advance past the 150ms debounce
    vi.advanceTimersByTime(150);

    expect(searchHandler).toHaveBeenCalledTimes(1);
    expect(searchHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.any(String),
        caseSensitive: false,
        useRegex: false,
      })
    );
  });

  // ── 4. Dispatches 'next' on Enter key ───────────────────────────────────

  it('dispatches next event on Enter key', async () => {
    const nextHandler = vi.fn();
    const { container } = render(SearchBar, {
      props: { isOpen: true, onnext: nextHandler },
    });

    const input = container.querySelector('.search-input') as HTMLInputElement;
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(nextHandler).toHaveBeenCalledTimes(1);
  });

  // ── 5. Dispatches 'previous' on Shift+Enter ────────────────────────────

  it('dispatches previous event on Shift+Enter', async () => {
    const previousHandler = vi.fn();
    const { container } = render(SearchBar, {
      props: { isOpen: true, onprevious: previousHandler },
    });

    const input = container.querySelector('.search-input') as HTMLInputElement;
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(previousHandler).toHaveBeenCalledTimes(1);
  });

  // ── 6. Dispatches 'close' on Escape ─────────────────────────────────────

  it('dispatches close event on Escape key', async () => {
    const closeHandler = vi.fn();
    const { container } = render(SearchBar, {
      props: { isOpen: true, onclose: closeHandler },
    });

    const input = container.querySelector('.search-input') as HTMLInputElement;
    await fireEvent.keyDown(input, { key: 'Escape' });

    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  // ── 7. Dispatches 'toggleCaseSensitive' on Aa button click ──────────────

  it('dispatches toggleCaseSensitive event when Aa button is clicked', async () => {
    const toggleHandler = vi.fn();
    const { container } = render(SearchBar, {
      props: { isOpen: true, ontogglecasesensitive: toggleHandler },
    });

    const aaButton = container.querySelector(
      'button[aria-label="Toggle case sensitivity"]'
    ) as HTMLButtonElement;
    expect(aaButton).toBeTruthy();
    await fireEvent.click(aaButton);

    expect(toggleHandler).toHaveBeenCalledTimes(1);
  });

  // ── 8. Dispatches 'toggleRegex' on .* button click ──────────────────────

  it('dispatches toggleRegex event when .* button is clicked', async () => {
    const toggleHandler = vi.fn();
    const { container } = render(SearchBar, {
      props: { isOpen: true, ontoggleregex: toggleHandler },
    });

    const regexButton = container.querySelector(
      'button[aria-label="Toggle regex"]'
    ) as HTMLButtonElement;
    expect(regexButton).toBeTruthy();
    await fireEvent.click(regexButton);

    expect(toggleHandler).toHaveBeenCalledTimes(1);
  });

  // ── 9. Shows "X of Y" match count when query and totalMatches > 0 ──────

  it('shows match count when query exists and totalMatches > 0', async () => {
    vi.useFakeTimers();

    const { container } = render(SearchBar, {
      props: {
        isOpen: true,
        currentMatch: 3,
        totalMatches: 10,
      },
    });

    // Type a query to make it non-empty
    const input = container.querySelector('.search-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'test' } });

    // The match count display depends on the `query` internal variable being non-empty.
    // After the input event, Svelte should update the query binding.
    vi.advanceTimersByTime(150);

    const matchCount = container.querySelector('.match-count');
    expect(matchCount).toBeTruthy();
    expect(matchCount?.textContent).toContain('3 of 10');
  });

  // ── 10. Shows "No matches" when query and totalMatches === 0 ────────────

  it('shows "No matches" when query exists and totalMatches is 0', async () => {
    vi.useFakeTimers();

    const { container } = render(SearchBar, {
      props: {
        isOpen: true,
        currentMatch: 0,
        totalMatches: 0,
      },
    });

    const input = container.querySelector('.search-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'nonexistent' } });

    vi.advanceTimersByTime(150);

    const matchCount = container.querySelector('.match-count');
    expect(matchCount).toBeTruthy();
    expect(matchCount?.textContent).toContain('No matches');
  });

  // ── 11. Close button dispatches 'close' ─────────────────────────────────

  it('dispatches close event when close button is clicked', async () => {
    const closeHandler = vi.fn();
    const { container } = render(SearchBar, {
      props: { isOpen: true, onclose: closeHandler },
    });

    const closeButton = container.querySelector(
      'button[aria-label="Close search"]'
    ) as HTMLButtonElement;
    expect(closeButton).toBeTruthy();
    await fireEvent.click(closeButton);

    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  // ── 12. Previous/Next nav buttons are disabled when totalMatches === 0 ──

  it('disables Previous and Next buttons when totalMatches is 0', () => {
    const { container } = render(SearchBar, {
      props: {
        isOpen: true,
        totalMatches: 0,
      },
    });

    const prevButton = container.querySelector(
      'button[aria-label="Previous match"]'
    ) as HTMLButtonElement;
    const nextButton = container.querySelector(
      'button[aria-label="Next match"]'
    ) as HTMLButtonElement;

    expect(prevButton).toBeTruthy();
    expect(nextButton).toBeTruthy();
    expect(prevButton.disabled).toBe(true);
    expect(nextButton.disabled).toBe(true);
  });
});
