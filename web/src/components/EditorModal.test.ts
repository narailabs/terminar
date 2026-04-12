import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import EditorModal from './EditorModal.svelte';

/** Convenience: render with sensible defaults plus optional overrides. */
function renderModal(overrides: {
  filename?: string;
  initialContents?: string;
  onSave?: (s: string) => void;
  onCancel?: () => void;
} = {}) {
  const onSave = overrides.onSave ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  const result = render(EditorModal, {
    props: {
      filename: overrides.filename ?? '/tmp/foo.txt',
      initialContents: overrides.initialContents ?? '',
      onSave,
      onCancel,
    },
  });
  return { ...result, onSave, onCancel };
}

describe('EditorModal', () => {
  afterEach(() => {
    cleanup();
  });

  // ── 1. Renders basename in the header ───────────────────────────────────
  it('renders the basename of the filename in the header', () => {
    const { container } = renderModal({ filename: '/tmp/foo.txt' });
    const title = container.querySelector('.editor-modal-title');
    expect(title).toBeTruthy();
    expect(title?.textContent).toContain('Edit file:');
    expect(title?.textContent).toContain('foo.txt');
    expect(title?.textContent).not.toContain('/tmp/');
  });

  it('uses the filename as basename when there is no slash', () => {
    const { container } = renderModal({ filename: 'plain.md' });
    const title = container.querySelector('.editor-modal-title');
    expect(title?.textContent).toContain('plain.md');
  });

  // ── 2. Renders initial contents in the textarea ─────────────────────────
  it('renders with the initial contents in the textarea', () => {
    const { container } = renderModal({ initialContents: 'hello world\n' });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe('hello world\n');
  });

  // ── 3. Typing in the textarea updates state ─────────────────────────────
  it('updates internal state when the textarea changes', async () => {
    const { container } = renderModal({ initialContents: 'a' });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'updated text' } });
    expect(textarea.value).toBe('updated text');
  });

  // ── 4. Clicking Save calls onSave with current contents ─────────────────
  it('calls onSave with the current textarea contents when Save is clicked', async () => {
    const { container, onSave } = renderModal({ initialContents: 'first' });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'second' } });

    const saveBtn = container.querySelector('[data-testid="editor-modal-save"]') as HTMLButtonElement;
    expect(saveBtn).toBeTruthy();
    await fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('second');
  });

  // ── 5. Clicking Cancel calls onCancel ───────────────────────────────────
  it('calls onCancel when Cancel is clicked', async () => {
    const { container, onCancel } = renderModal();
    const cancelBtn = container.querySelector('[data-testid="editor-modal-cancel"]') as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    await fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // ── 6. Pressing Escape calls onCancel ───────────────────────────────────
  it('calls onCancel and preventDefault when Escape is pressed on the modal', async () => {
    const { container, onCancel } = renderModal();
    const backdrop = container.querySelector('.editor-modal-backdrop') as HTMLElement;
    expect(backdrop).toBeTruthy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    backdrop.dispatchEvent(event);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(preventSpy).toHaveBeenCalled();
  });

  // ── 7. Ctrl+S / Cmd+S calls onSave with current contents and preventDefault ──
  it('calls onSave with current contents on Ctrl+S and preventDefault', async () => {
    const { container, onSave } = renderModal({ initialContents: 'a' });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'edited' } });

    const backdrop = container.querySelector('.editor-modal-backdrop') as HTMLElement;
    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    backdrop.dispatchEvent(event);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('edited');
    expect(preventSpy).toHaveBeenCalled();
  });

  it('also calls onSave on Cmd+S (metaKey) and preventDefault', async () => {
    const { container, onSave } = renderModal({ initialContents: 'init' });
    const backdrop = container.querySelector('.editor-modal-backdrop') as HTMLElement;
    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    backdrop.dispatchEvent(event);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('init');
    expect(preventSpy).toHaveBeenCalled();
  });

  it('also calls onSave on Cmd+Enter (convenience)', async () => {
    const { container, onSave } = renderModal({ initialContents: 'init' });
    const backdrop = container.querySelector('.editor-modal-backdrop') as HTMLElement;
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    backdrop.dispatchEvent(event);

    expect(onSave).toHaveBeenCalledWith('init');
    expect(preventSpy).toHaveBeenCalled();
  });

  // ── 8. Backdrop click does NOT call onCancel ────────────────────────────
  it('does NOT call onCancel when the backdrop is clicked', async () => {
    const { container, onCancel } = renderModal();
    const backdrop = container.querySelector('.editor-modal-backdrop') as HTMLElement;
    expect(backdrop).toBeTruthy();
    await fireEvent.click(backdrop);
    expect(onCancel).not.toHaveBeenCalled();
  });

  // ── 9. Accessibility checks ─────────────────────────────────────────────
  it('has role="dialog", aria-modal, and aria-labelledby pointing at the heading', () => {
    const { container } = renderModal();
    const backdrop = container.querySelector('.editor-modal-backdrop') as HTMLElement;
    expect(backdrop.getAttribute('role')).toBe('dialog');
    expect(backdrop.getAttribute('aria-modal')).toBe('true');

    const labelledBy = backdrop.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const heading = container.querySelector(`#${labelledBy}`);
    expect(heading).toBeTruthy();
    expect(heading?.textContent).toContain('Edit file:');
  });

  it('auto-focuses the textarea on mount', () => {
    const { container } = renderModal({ initialContents: 'abc' });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
  });
});
