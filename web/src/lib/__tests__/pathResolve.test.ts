import { describe, it, expect } from 'vitest';
import { FILE_PATH_REGEX, resolveTerminalPath } from '../pathResolve';

interface Match {
  text: string;
  line: string | undefined;
  col: string | undefined;
}

function matchAll(input: string): Match[] {
  FILE_PATH_REGEX.lastIndex = 0;
  const out: Match[] = [];
  for (const m of input.matchAll(FILE_PATH_REGEX)) {
    out.push({ text: m[1], line: m[2], col: m[3] });
  }
  return out;
}

describe('FILE_PATH_REGEX', () => {
  it('matches absolute path with extension', () => {
    expect(matchAll('/etc/hosts.md')).toEqual([
      { text: '/etc/hosts.md', line: undefined, col: undefined },
    ]);
  });

  it('matches absolute path with no intermediate segments', () => {
    expect(matchAll('/foo.md')).toEqual([
      { text: '/foo.md', line: undefined, col: undefined },
    ]);
  });

  it('matches "./relative" path', () => {
    expect(matchAll('./docs/API.md')).toEqual([
      { text: './docs/API.md', line: undefined, col: undefined },
    ]);
  });

  it('matches "./file" without intermediate dirs', () => {
    expect(matchAll('./README.md')).toEqual([
      { text: './README.md', line: undefined, col: undefined },
    ]);
  });

  it('matches "../relative" path', () => {
    expect(matchAll('../foo/bar.ts')).toEqual([
      { text: '../foo/bar.ts', line: undefined, col: undefined },
    ]);
  });

  it('matches "~/home" relative path', () => {
    expect(matchAll('~/Notes/plan.md')).toEqual([
      { text: '~/Notes/plan.md', line: undefined, col: undefined },
    ]);
  });

  it('matches plain relative path with slash', () => {
    expect(matchAll('wiki-workspace/REPORT.md')).toEqual([
      { text: 'wiki-workspace/REPORT.md', line: undefined, col: undefined },
    ]);
  });

  it('captures :line suffix', () => {
    expect(matchAll('src/main.rs:42')).toEqual([
      { text: 'src/main.rs', line: '42', col: undefined },
    ]);
  });

  it('captures :line:col suffix', () => {
    expect(matchAll('src/main.rs:42:5')).toEqual([
      { text: 'src/main.rs', line: '42', col: '5' },
    ]);
  });

  it('does NOT match bare filename without slash', () => {
    expect(matchAll('README.md')).toEqual([]);
  });

  it('does NOT match http URL tail', () => {
    expect(matchAll('see https://example.com/docs/README.md for more')).toEqual([]);
  });

  it('does NOT match https URL tail', () => {
    expect(matchAll('https://foo.bar/baz.md')).toEqual([]);
  });

  it('does NOT match Windows backslash path', () => {
    expect(matchAll('C:\\foo\\bar.md')).toEqual([]);
  });

  it('does NOT include trailing period in match', () => {
    const matches = matchAll('see ./docs/API.md.');
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('./docs/API.md');
  });

  it('does NOT include trailing closing paren in match', () => {
    const matches = matchAll('(path/to.md)');
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('path/to.md');
  });

  it('matches inside quotes', () => {
    const matches = matchAll('"foo/bar.md"');
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('foo/bar.md');
  });

  it('does NOT match path with unknown extension', () => {
    expect(matchAll('foo/bar.xyz')).toEqual([]);
  });

  it('is case-insensitive on the extension', () => {
    expect(matchAll('foo/BAR.MD')).toEqual([
      { text: 'foo/BAR.MD', line: undefined, col: undefined },
    ]);
  });

  it('matches multiple paths on one line', () => {
    const matches = matchAll('see ./a.md and /tmp/b.ts here');
    expect(matches.map(m => m.text)).toEqual(['./a.md', '/tmp/b.ts']);
  });

  it('matches path with dots in segment names', () => {
    expect(matchAll('src/my.config.yaml')).toEqual([
      { text: 'src/my.config.yaml', line: undefined, col: undefined },
    ]);
  });

  it('matches deeply nested path', () => {
    expect(matchAll('a/b/c/d/e/f.ts')).toEqual([
      { text: 'a/b/c/d/e/f.ts', line: undefined, col: undefined },
    ]);
  });

  it('handles path followed by colon with no digit', () => {
    const matches = matchAll('foo/bar.md: some text');
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('foo/bar.md');
    expect(matches[0].line).toBeUndefined();
  });
});

describe('resolveTerminalPath', () => {
  it('returns absolute path unchanged', () => {
    expect(resolveTerminalPath('/etc/hosts.md', '/home/x')).toBe('/etc/hosts.md');
  });

  it('normalises duplicate slashes in absolute path', () => {
    expect(resolveTerminalPath('/tmp//foo//bar.md', '/home/x')).toBe('/tmp/foo/bar.md');
  });

  it('passes ~/ through for main-process expansion', () => {
    expect(resolveTerminalPath('~/Notes/plan.md', '/home/x')).toBe('~/Notes/plan.md');
  });

  it('passes bare ~ through', () => {
    expect(resolveTerminalPath('~', '/home/x')).toBe('~');
  });

  it('joins relative with cwd', () => {
    expect(resolveTerminalPath('wiki/REPORT.md', '/home/user'))
      .toBe('/home/user/wiki/REPORT.md');
  });

  it('strips "./" in relative path', () => {
    expect(resolveTerminalPath('./docs/API.md', '/home/user'))
      .toBe('/home/user/docs/API.md');
  });

  it('collapses "../" in relative path', () => {
    expect(resolveTerminalPath('../foo/bar.md', '/home/user/project'))
      .toBe('/home/user/foo/bar.md');
  });

  it('returns null for relative path with missing cwd', () => {
    expect(resolveTerminalPath('foo/bar.md', undefined)).toBeNull();
  });

  it('returns null for relative path with empty cwd', () => {
    expect(resolveTerminalPath('foo/bar.md', '')).toBeNull();
  });

  it('returns null for relative path with non-absolute cwd', () => {
    expect(resolveTerminalPath('foo/bar.md', 'not-absolute')).toBeNull();
  });

  it('trims trailing slash on cwd', () => {
    expect(resolveTerminalPath('foo/bar.md', '/home/user/'))
      .toBe('/home/user/foo/bar.md');
  });

  it('returns null for empty input', () => {
    expect(resolveTerminalPath('', '/home/x')).toBeNull();
  });
});
