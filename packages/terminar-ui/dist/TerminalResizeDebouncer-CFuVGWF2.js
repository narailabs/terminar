class a {
  constructor(e, t) {
    this.getTerm = e, this.onResize = t;
  }
  latestCols = 0;
  latestRows = 0;
  colsResizeTimeout = null;
  isOutputActive = !1;
  COLS_DEBOUNCE_MS = 300;
  BUFFER_THRESHOLD = 200;
  resize(e, t, i = !1) {
    const s = this.getTerm();
    if (!s || e <= 0 || t <= 0) return;
    const l = s.buffer.normal.length;
    if (i || l < this.BUFFER_THRESHOLD) {
      this.clearPendingResize(), this.applyResize(e, t);
      return;
    }
    if (e === this.latestCols && t !== this.latestRows) {
      this.applyResize(e, t);
      return;
    }
    if (t !== this.latestRows && this.applyResize(this.latestCols || e, t), e !== this.latestCols) {
      this.latestCols = e, this.colsResizeTimeout && clearTimeout(this.colsResizeTimeout);
      const h = this.isOutputActive ? this.COLS_DEBOUNCE_MS * 2 : this.COLS_DEBOUNCE_MS;
      this.colsResizeTimeout = setTimeout(() => {
        this.colsResizeTimeout = null, this.applyResize(this.latestCols, this.latestRows);
      }, h);
    }
  }
  applyResize(e, t) {
    this.latestCols = e, this.latestRows = t, this.onResize(e, t);
  }
  clearPendingResize() {
    this.colsResizeTimeout && (clearTimeout(this.colsResizeTimeout), this.colsResizeTimeout = null);
  }
  flush() {
    this.clearPendingResize(), this.latestCols > 0 && this.latestRows > 0 && this.applyResize(this.latestCols, this.latestRows);
  }
  getDimensions() {
    return { cols: this.latestCols, rows: this.latestRows };
  }
  hasPendingResize() {
    return this.colsResizeTimeout !== null;
  }
  setOutputActive(e) {
    this.isOutputActive = e;
  }
  dispose() {
    this.clearPendingResize();
  }
}
export {
  a as T
};
//# sourceMappingURL=TerminalResizeDebouncer-CFuVGWF2.js.map
