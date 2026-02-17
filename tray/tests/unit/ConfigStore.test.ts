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
      gateway_port: 9999,
      tls_mode: 'off',
      require_auth: false,
    };
    store.save(custom);

    const loaded = store.load();
    expect(loaded.gateway_port).toBe(9999);
    expect(loaded.tls_mode).toBe('off');
    expect(loaded.require_auth).toBe(false);
  });

  it('merges partial JSON over defaults', () => {
    // Write a partial config file
    writeFileSync(configPath, JSON.stringify({ gateway_port: 7777 }), 'utf-8');

    const store = new ConfigStore(configPath);
    const config = store.load();

    // Overridden field
    expect(config.gateway_port).toBe(7777);
    // Default fields preserved
    expect(config.tls_mode).toBe('auto');
    expect(config.require_auth).toBe(true);
    expect(config.idle_timeout).toBe(1800);
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

    store.save({ ...DEFAULT_CONFIG, gateway_port: 1234 });

    const raw = readFileSync(deepPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.gateway_port).toBe(1234);
  });

  it('reports correct config path', () => {
    const store = new ConfigStore(configPath);
    expect(store.getConfigPath()).toBe(configPath);
  });

  describe('toGatewayArgs', () => {
    it('generates args for default config', () => {
      const args = ConfigStore.toGatewayArgs(DEFAULT_CONFIG);
      expect(args).toContain('--port');
      expect(args).toContain('6749');
      expect(args).toContain('--tls-port');
      expect(args).toContain('8444');
      expect(args).toContain('--idle-timeout');
      expect(args).toContain('1800');
      expect(args).toContain('--audit-level');
      expect(args).toContain('standard');
      expect(args).not.toContain('--no-auto-tls');
    });

    it('adds --no-auto-tls when tls_mode is off', () => {
      const config = { ...DEFAULT_CONFIG, tls_mode: 'off' as const };
      const args = ConfigStore.toGatewayArgs(config);
      expect(args).toContain('--no-auto-tls');
      expect(args).not.toContain('--tls-port');
    });

    it('adds --tls-cert and --tls-key for custom TLS', () => {
      const config = {
        ...DEFAULT_CONFIG,
        tls_mode: 'custom' as const,
        tls_cert: '/path/to/cert.pem',
        tls_key: '/path/to/key.pem',
      };
      const args = ConfigStore.toGatewayArgs(config);
      expect(args).toContain('--tls-cert');
      expect(args).toContain('/path/to/cert.pem');
      expect(args).toContain('--tls-key');
      expect(args).toContain('/path/to/key.pem');
      expect(args).toContain('--tls-port');
    });
  });
});
