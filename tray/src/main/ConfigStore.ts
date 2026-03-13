// ConfigStore.ts — Persistent configuration stored at ~/.terminar/tray-config.json.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { DEFAULT_CONFIG } from './types.js';
import type { TrayConfig } from './types.js';

export class ConfigStore {
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath =
      configPath ?? join(homedir(), '.terminar', 'tray-config.json');
  }

  /** Path to the config file. */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Load config from disk, returning defaults if the file doesn't exist or
   * contains invalid JSON. Partial JSON is merged over defaults.
   */
  load(): TrayConfig {
    try {
      const contents = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(contents);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /** Save config to disk, creating parent directories as needed. */
  save(config: TrayConfig): void {
    const dir = dirname(this.configPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
}
