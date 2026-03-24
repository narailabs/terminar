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
      ...DEFAULT_CONFIG,
      server_port: 9999,
    };
    store.save(custom);

    const loaded = store.load();
    expect(loaded.server_port).toBe(9999);
  });

  it('merges partial JSON over defaults', () => {
    // Write a partial config file
    writeFileSync(configPath, JSON.stringify({ server_port: 7777 }), 'utf-8');

    const store = new ConfigStore(configPath);
    const config = store.load();

    // Overridden field
    expect(config.server_port).toBe(7777);
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

    store.save({ ...DEFAULT_CONFIG, server_port: 1234 });

    const raw = readFileSync(deepPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.server_port).toBe(1234);
  });

  it('reports correct config path', () => {
    const store = new ConfigStore(configPath);
    expect(store.getConfigPath()).toBe(configPath);
  });
});
