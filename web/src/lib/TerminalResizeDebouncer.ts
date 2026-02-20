import type { Terminal } from '@xterm/xterm';

/**
 * TerminalResizeDebouncer - Intelligent terminal resize handling
 *
 * Mirrors VS Code's approach from terminalResizeDebouncer.ts:
 * - Rows (Y axis): Applied IMMEDIATELY - vertical resize is cheap
 * - Cols (X axis): Debounced 100ms - horizontal reflow is expensive
 * - Buffer-aware: Small buffers (<200 lines) resize immediately
 *
 * This prevents TUI corruption during resize while still allowing
 * dynamic sizing.
 */
export class TerminalResizeDebouncer {
  private latestCols: number = 0;
  private latestRows: number = 0;
  private colsResizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private isOutputActive: boolean = false;

  // Configuration
  // Increased debounce from 100ms to 300ms to prevent TUI corruption during rapid resize
  private readonly COLS_DEBOUNCE_MS = 300;
  private readonly BUFFER_THRESHOLD = 200;

  constructor(
    private readonly getTerm: () => Terminal | null,
    private readonly onResize: (cols: number, rows: number) => void
  ) {}

  /**
   * Request a resize. Handles debouncing based on buffer size and axis.
   *
   * @param cols - Target column count
   * @param rows - Target row count
   * @param immediate - Force immediate resize (for initial sizing or visibility changes)
   */
  resize(cols: number, rows: number, immediate = false): void {
    const term = this.getTerm();
    if (!term) return;

    // Validate dimensions
    if (cols <= 0 || rows <= 0) return;

    // Small buffer or immediate flag: resize both immediately
    const bufferLength = term.buffer.normal.length;
    if (immediate || bufferLength < this.BUFFER_THRESHOLD) {
      this.clearPendingResize();
      this.applyResize(cols, rows);
      return;
    }

    // Large buffer: use smart debouncing

    // If only rows changed, apply immediately (cheap operation)
    if (cols === this.latestCols && rows !== this.latestRows) {
      this.applyResize(cols, rows);
      return;
    }

    // Rows: apply immediately if changed
    if (rows !== this.latestRows) {
      // Apply with current cols, new rows
      this.applyResize(this.latestCols || cols, rows);
    }

    // Cols: debounce if changed
    // When output is active, use a longer debounce to prevent TUI corruption
    if (cols !== this.latestCols) {
      this.latestCols = cols;

      if (this.colsResizeTimeout) {
        clearTimeout(this.colsResizeTimeout);
      }

      // Use longer debounce when output is active to let TUI finish rendering
      const debounceMs = this.isOutputActive ? this.COLS_DEBOUNCE_MS * 2 : this.COLS_DEBOUNCE_MS;

      this.colsResizeTimeout = setTimeout(() => {
        this.colsResizeTimeout = null;
        // Only apply if output has settled
        this.applyResize(this.latestCols, this.latestRows);
      }, debounceMs);
    }
  }

  private applyResize(cols: number, rows: number): void {
    this.latestCols = cols;
    this.latestRows = rows;
    this.onResize(cols, rows);
  }

  private clearPendingResize(): void {
    if (this.colsResizeTimeout) {
      clearTimeout(this.colsResizeTimeout);
      this.colsResizeTimeout = null;
    }
  }

  /**
   * Flush any pending resize immediately.
   * Call when terminal becomes visible or needs immediate sync.
   */
  flush(): void {
    this.clearPendingResize();
    if (this.latestCols > 0 && this.latestRows > 0) {
      this.applyResize(this.latestCols, this.latestRows);
    }
  }

  /**
   * Get current dimensions.
   */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this.latestCols, rows: this.latestRows };
  }

  /**
   * Check if there's a pending resize.
   */
  hasPendingResize(): boolean {
    return this.colsResizeTimeout !== null;
  }

  /**
   * Set output activity state.
   * When output is active, column resizes are blocked to prevent TUI corruption.
   */
  setOutputActive(active: boolean): void {
    this.isOutputActive = active;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.clearPendingResize();
  }
}
