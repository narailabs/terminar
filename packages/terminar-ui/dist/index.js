import { T as m } from "./TerminalResizeDebouncer-CFuVGWF2.js";
function a(n = null) {
  return {
    type: "pane",
    id: crypto.randomUUID(),
    sessionId: n
  };
}
function l(n, t, r) {
  const e = t.map(() => 1 / t.length);
  return {
    type: "split",
    id: crypto.randomUUID(),
    direction: n,
    children: t,
    ratios: r || e
  };
}
function u(n, t) {
  return {
    id: crypto.randomUUID(),
    name: n,
    root: a(t || null)
  };
}
function s(n) {
  return {
    tabs: [u("Terminal 1", n)],
    activeTabId: ""
  };
}
function f(n, t) {
  if (n.type === "pane")
    return n.id === t ? n : null;
  for (const r of n.children) {
    const e = f(r, t);
    if (e) return e;
  }
  return null;
}
function c(n, t) {
  if (n.type === "pane") return null;
  for (let r = 0; r < n.children.length; r++) {
    const e = n.children[r];
    if (e.id === t)
      return { parent: n, index: r };
    if (e.type === "split") {
      const i = c(e, t);
      if (i) return i;
    }
  }
  return null;
}
function o(n) {
  return n.type === "pane" ? [n] : n.children.flatMap(o);
}
function p(n) {
  const t = /* @__PURE__ */ new Set();
  for (const r of n.tabs)
    for (const e of o(r.root))
      e.sessionId && t.add(e.sessionId);
  return Array.from(t);
}
export {
  m as TerminalResizeDebouncer,
  s as createDefaultWorkspace,
  a as createPane,
  l as createSplit,
  u as createTab,
  f as findPane,
  c as findParent,
  o as getAllPanes,
  p as getWorkspaceSessionIds
};
//# sourceMappingURL=index.js.map
