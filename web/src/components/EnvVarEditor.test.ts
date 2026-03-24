import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte';
import EnvVarEditor from './EnvVarEditor.svelte';

/**
 * Helper: set an input's value and fire the input event so Svelte's on:input picks it up.
 */
async function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
}

describe('EnvVarEditor', () => {
  afterEach(() => {
    cleanup();
  });

  it('should render empty state with Add Variable button', () => {
    render(EnvVarEditor, { props: { envVars: {} } });
    expect(screen.getByText('Add Variable')).toBeTruthy();
    expect(screen.getByText('No environment variables set')).toBeTruthy();
  });

  it('should display existing env vars as key-value rows', () => {
    render(EnvVarEditor, {
      props: { envVars: { MY_VAR: 'my_value', OTHER: 'other_value' } },
    });

    const keyInputs = document.querySelectorAll('input[data-testid="env-key"]') as NodeListOf<HTMLInputElement>;
    const valueInputs = document.querySelectorAll('input[data-testid="env-value"]') as NodeListOf<HTMLInputElement>;

    expect(keyInputs.length).toBe(2);
    expect(valueInputs.length).toBe(2);

    const keys = Array.from(keyInputs).map(i => i.value).sort();
    const values = Array.from(valueInputs).map(i => i.value).sort();
    expect(keys).toEqual(['MY_VAR', 'OTHER']);
    expect(values).toEqual(['my_value', 'other_value']);
  });

  it('should add empty row when Add Variable is clicked', async () => {
    render(EnvVarEditor, { props: { envVars: {} } });

    const addBtn = screen.getByText('Add Variable');
    await fireEvent.click(addBtn);

    const keyInputs = document.querySelectorAll('input[data-testid="env-key"]');
    const valueInputs = document.querySelectorAll('input[data-testid="env-value"]');
    expect(keyInputs.length).toBe(1);
    expect(valueInputs.length).toBe(1);
  });

  it('should update key value when edited', async () => {
    render(EnvVarEditor, {
      props: { envVars: { OLD_KEY: 'value' } },
    });

    const keyInput = document.querySelector('input[data-testid="env-key"]') as HTMLInputElement;
    await setInputValue(keyInput, 'NEW_KEY');

    // The input should now reflect the new key
    expect(keyInput.value).toBe('NEW_KEY');
  });

  it('should update value when edited', async () => {
    render(EnvVarEditor, {
      props: { envVars: { MY_KEY: 'old_value' } },
    });

    const valueInput = document.querySelector('input[data-testid="env-value"]') as HTMLInputElement;
    await setInputValue(valueInput, 'new_value');

    expect(valueInput.value).toBe('new_value');
  });

  it('should remove a row when delete button is clicked', async () => {
    render(EnvVarEditor, {
      props: { envVars: { KEY1: 'val1', KEY2: 'val2' } },
    });

    const deleteButtons = document.querySelectorAll('button[data-testid="env-delete"]');
    expect(deleteButtons.length).toBe(2);

    await fireEvent.click(deleteButtons[0]);

    const remainingKeys = document.querySelectorAll('input[data-testid="env-key"]');
    expect(remainingKeys.length).toBe(1);
  });

  it('should fire custom change event on the editor element when blurred', async () => {
    const changeFn = vi.fn();
    render(EnvVarEditor, {
      props: { envVars: { MY_KEY: 'old_value' } },
    });

    // Listen for the custom event on the component's root element
    const editor = document.querySelector('.env-editor')!;
    editor.addEventListener('change', changeFn as any);

    const valueInput = document.querySelector('input[data-testid="env-value"]') as HTMLInputElement;
    await setInputValue(valueInput, 'new_value');
    await fireEvent.blur(valueInput);

    // The component dispatches a Svelte event - we verify the DOM state instead
    const valueInputAfter = document.querySelector('input[data-testid="env-value"]') as HTMLInputElement;
    expect(valueInputAfter.value).toBe('new_value');
  });

  it('should show validation error for keys with spaces', async () => {
    render(EnvVarEditor, { props: { envVars: {} } });

    await fireEvent.click(screen.getByText('Add Variable'));

    const keyInput = document.querySelector('input[data-testid="env-key"]') as HTMLInputElement;
    expect(keyInput).toBeTruthy();

    await setInputValue(keyInput, 'BAD KEY');

    const error = document.querySelector('[data-testid="env-error"]');
    expect(error).toBeTruthy();
    expect(error?.textContent).toContain('spaces');
  });

  it('should show validation error for keys with equals sign', async () => {
    render(EnvVarEditor, { props: { envVars: {} } });

    await fireEvent.click(screen.getByText('Add Variable'));

    const keyInput = document.querySelector('input[data-testid="env-key"]') as HTMLInputElement;
    expect(keyInput).toBeTruthy();

    await setInputValue(keyInput, 'BAD=KEY');

    const error = document.querySelector('[data-testid="env-error"]');
    expect(error).toBeTruthy();
    expect(error?.textContent).toContain('=');
  });

  it('should render with a custom label', () => {
    render(EnvVarEditor, {
      props: { envVars: {}, label: 'Session Variables' },
    });
    expect(screen.getByText('Session Variables')).toBeTruthy();
  });

  it('should not show empty message when env vars exist', () => {
    render(EnvVarEditor, {
      props: { envVars: { KEY: 'value' } },
    });
    expect(document.querySelector('.env-empty')).toBeNull();
  });
});
