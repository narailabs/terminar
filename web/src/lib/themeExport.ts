/**
 * Theme export/import utilities.
 *
 * Themes serialize to a JSON format that can contain UI, terminal, or both.
 */

import type { UITheme, TerminalTheme } from './themeTypes';

export interface ExportedTheme {
  name: string;
  type: 'ui' | 'terminal' | 'ui+terminal';
  ui?: UITheme;
  terminal?: TerminalTheme;
}

/**
 * Export one or both theme types to a portable JSON object.
 */
export function exportTheme(opts: {
  ui?: UITheme;
  terminal?: TerminalTheme;
  name?: string;
}): ExportedTheme {
  const { ui, terminal, name } = opts;

  let type: ExportedTheme['type'];
  if (ui && terminal) {
    type = 'ui+terminal';
  } else if (ui) {
    type = 'ui';
  } else {
    type = 'terminal';
  }

  const exportName = name ?? ui?.name ?? terminal?.name ?? 'Unnamed Theme';

  const result: ExportedTheme = { name: exportName, type };
  if (ui) result.ui = { ...ui };
  if (terminal) result.terminal = { ...terminal, ansi: { ...terminal.ansi } };

  return result;
}

/** Generate a unique ID for imported themes. */
function generateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Import a theme from a JSON object.
 * Generates fresh IDs for imported themes to avoid collisions.
 */
export function importTheme(data: ExportedTheme): {
  ui?: UITheme;
  terminal?: TerminalTheme;
} {
  if (!data.name || (!data.ui && !data.terminal)) {
    throw new Error('Invalid theme: must have a name and at least one of ui or terminal');
  }

  const result: { ui?: UITheme; terminal?: TerminalTheme } = {};

  if (data.ui) {
    result.ui = {
      scrollbarThumb: 'rgba(121,121,121,0.4)',
      scrollbarThumbHover: 'rgba(121,121,121,0.7)',
      ...data.ui,
      id: generateId(),
      name: data.ui.name || data.name,
    };
  }

  if (data.terminal) {
    result.terminal = {
      ...data.terminal,
      id: generateId(),
      name: data.terminal.name || data.name,
      ansi: { ...data.terminal.ansi },
    };
  }

  return result;
}
