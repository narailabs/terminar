'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'terminar.js');

describe('cli', () => {
  it('should print version with --version flag', () => {
    const output = execFileSync('node', [CLI_PATH, '--version'], {
      encoding: 'utf-8',
    }).trim();
    assert.match(output, /^terminar v\d+\.\d+\.\d+$/);
  });

  it('should print version with -v flag', () => {
    const output = execFileSync('node', [CLI_PATH, '-v'], {
      encoding: 'utf-8',
    }).trim();
    assert.match(output, /^terminar v\d+\.\d+\.\d+$/);
  });

  it('should print usage with --help flag', () => {
    const output = execFileSync('node', [CLI_PATH, '--help'], {
      encoding: 'utf-8',
    });
    assert.ok(output.includes('Usage: terminar'));
    assert.ok(output.includes('server start'));
    assert.ok(output.includes('server stop'));
  });

  it('should exit with error for unknown command', () => {
    assert.throws(() => {
      execFileSync('node', [CLI_PATH, 'nonexistent'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    });
  });

  it('should exit with error for missing server subcommand', () => {
    assert.throws(() => {
      execFileSync('node', [CLI_PATH, 'server'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    });
  });
});
