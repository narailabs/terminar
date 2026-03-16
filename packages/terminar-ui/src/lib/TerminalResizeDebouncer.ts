import type { Terminal } from '@xterm/xterm';

/**
 * TerminalResizeDebouncer - Intelligent terminal resize handling
 *
 * - Rows (Y axis): Applied IMMEDIATELY - vertical resize is cheap
 * - Cols (X axis): Debounced 300ms - horizontal reflow is expensive
 * - Buffer-aware: Small buffers (<200 lines) resize immediately
 */
export class TerminalResizeDebouncer {
  private latestCols: number = 0;
  private latestRows: number = 0;
  private colsResizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private isOutputActive: boolean = false;

  private readonly COLS_DEBOUNCE_MS = 300;
  private readonly BUFFER_THRESHOLD = 200;

  constructor(
    private readonly getTerm: () => Terminal | null,
    private readonly onResize: (cols: number, rows: number) => void
  ) {}

  resize(cols: number, rows: number, immediate = false): void {
    const term = this.getTerm();
    if (!term) return;
    if (cols <= 0 || rows <= 0) return;

    const bufferLength = term.buffer.normal.length;
    if (immediate || bufferLength < this.BUFFER_THRESHOLD) {
      this.clearPendingResize();
      this.applyResize(cols, rows);
      return;
    }

    if (cols === this.latestCols && rows !== this.latestRows) {
      this.applyResize(cols, rows);
      return;
    }

    if (rows !== this.latestRows) {
      this.applyResize(this.latestCols || cols, rows);
    }

    if (cols !== this.latestCols) {
      this.latestCols = cols;
      if (this.colsResizeTimeout) clearTimeout(this.colsResizeTimeout);
      const debounceMs = this.isOutputActive ? this.COLS_DEBOUNCE_MS * 2 : this.COLS_DEBOUNCE_MS;
      this.colsResizeTimeout = setTimeout(() => {
        this.colsResizeTimeout = null;
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

  flush(): void {
    this.clearPendingResize();
    if (this.latestCols > 0 && this.latestRows > 0) {
      this.applyResize(this.latestCols, this.latestRows);
    }
  }

  getDimensions(): { cols: number; rows: number } {
    return { cols: this.latestCols, rows: this.latestRows };
  }

  hasPendingResize(): boolean {
    return this.colsResizeTimeout !== null;
  }

  setOutputActive(active: boolean): void {
    this.isOutputActive = active;
  }

  dispose(): void {
    this.clearPendingResize();
  }
}
