import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigStore } from '../../src/main/ConfigStore.js';
import { DEFAULT_CONFIG } from '../../src/main/types.js';
import type { TrayConfig } from '../../src/main/types.js';

describe('ConfigStore', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `terminar-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, 'tray-config.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when config file does not exist', () => {
    const store = new ConfigStore(configPath);
    const config = store.load();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('saves and loads config', () => {
    const store = new ConfigStore(configPath);
    const custom: TrayConfig = {
      shell: '/bin/zsh',
      log_level: 'debug',
    };
    store.save(custom);

    const loaded = store.load();
    expect(loaded.shell).toBe('/bin/zsh');
    expect(loaded.log_level).toBe('debug');
  });

  it('merges partial JSON over defaults', () => {
    // Write a partial config file
    writeFileSync(configPath, JSON.stringify({ log_level: 'warn' }), 'utf-8');

    const store = new ConfigStore(configPath);
    const config = store.load();

    // Overridden field
    expect(config.log_level).toBe('warn');
    // Default fields preserved
    expect(config.shell).toBeNull();
  });

  it('returns defaults for invalid JSON', () => {
    writeFileSync(configPath, 'not valid json!!!', 'utf-8');

    const store = new ConfigStore(configPath);
    const config = store.load();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('creates parent directories on save', () => {
    const deepPath = join(tmpDir, 'deep', 'nested', 'config.json');
    const store = new ConfigStore(deepPath);

    store.save({ shell: '/bin/bash', log_level: 'info' });

    const raw = readFileSync(deepPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.shell).toBe('/bin/bash');
  });

  it('reports correct config path', () => {
    const store = new ConfigStore(configPath);
    expect(store.getConfigPath()).toBe(configPath);
  });
});
