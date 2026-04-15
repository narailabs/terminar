// File-path link detection for the terminal.
// Used by Terminal.svelte to build clickable links from paths in PTY output
// (e.g. "wiki-workspace/REPORT.md", "/etc/hosts.md", "src/main.rs:42:5").

const FILE_EXTENSIONS = [
  'md', 'mdx', 'markdown', 'txt', 'rst', 'org',
  'pdf', 'html', 'htm',
  'json', 'yaml', 'yml', 'toml', 'conf', 'ini', 'env',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'svelte', 'vue',
  'py', 'rs', 'go',
  'c', 'cpp', 'cc', 'h', 'hpp',
  'rb', 'java', 'kt', 'swift',
  'sh', 'bash', 'zsh', 'fish',
  'css', 'scss', 'sass', 'less',
  'log', 'csv', 'tsv', 'xml', 'sql',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
];

const EXT_ALT = FILE_EXTENSIONS.join('|');

// Paths must either carry an explicit prefix (./ ../ ~/ /) or contain at least
// one interior slash. A recognized extension is always required. Optional
// trailing :line or :line:col captures source-location suffixes common in
// compiler / test / grep output.
//
// Lookbehind: reject matches preceded by word char, slash, dash, or dot — this
// prevents URL tails (e.g. "example.com/docs/README.md" inside an http URL)
// from being matched as file paths.
//
// Capture groups:
//   1: path (without :line:col)
//   2: line (optional)
//   3: col  (optional)
export const FILE_PATH_REGEX = new RegExp(
  '(?<![\\w/\\-.])' +
  '(' +
    // Alt 1: explicit path prefix + 0+ interior segments + final file
    '(?:\\.{1,2}\\/|~\\/|\\/)(?:[\\w.\\-]+\\/)*[\\w.\\-]+?\\.(?:' + EXT_ALT + ')' +
    '|' +
    // Alt 2: no prefix, but 1+ interior segments + final file
    '(?:[\\w.\\-]+\\/)+[\\w.\\-]+?\\.(?:' + EXT_ALT + ')' +
  ')' +
  '(?::(\\d+)(?::(\\d+))?)?' +
  '(?!\\w)',
  'gi'
);

/**
 * Resolve a raw path from terminal output against a session cwd.
 * Returns an absolute path string, or null if unresolvable.
 *
 * - Absolute ("/..."): normalized and returned.
 * - Home-relative ("~/..."): returned unchanged; the main process expands ~.
 * - Relative ("./x", "../x", "x/y"): joined with cwd and normalized.
 * - Missing/empty cwd on a relative path → null (no reliable anchor).
 */
export function resolveTerminalPath(raw: string, cwd: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('/')) return normalizePosix(raw);
  if (raw === '~' || raw.startsWith('~/')) return raw;
  if (!cwd || !cwd.startsWith('/')) return null;
  const base = cwd.replace(/\/+$/, '');
  const rel = raw.replace(/^\.\//, '');
  return normalizePosix(base + '/' + rel);
}

/** Collapse "./", "../" and duplicate slashes in a posix-style path. */
function normalizePosix(path: string): string {
  const isAbs = path.startsWith('/');
  const parts = path.split('/').filter(p => p !== '' && p !== '.');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isAbs) out.push('..');
    } else {
      out.push(p);
    }
  }
  const joined = out.join('/');
  if (isAbs) return '/' + joined;
  return joined || '.';
}
