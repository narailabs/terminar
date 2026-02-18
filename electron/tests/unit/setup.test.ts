import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const projectRoot = resolve(__dirname, '../..');

describe('Project Setup', () => {
  describe('package.json', () => {
    const packageJsonPath = resolve(projectRoot, 'package.json');

    it('should exist and be valid JSON', () => {
      expect(existsSync(packageJsonPath)).toBe(true);
      const content = readFileSync(packageJsonPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should have electron as devDependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.devDependencies?.electron).toBeDefined();
    });

    it('should have type: module for ESM', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.type).toBe('module');
    });
  });

  describe('tsconfig.json', () => {
    const tsconfigPath = resolve(projectRoot, 'tsconfig.json');

    it('should exist and be valid JSON', () => {
      expect(existsSync(tsconfigPath)).toBe(true);
      const content = readFileSync(tsconfigPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should have strict mode enabled', () => {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      expect(tsconfig.compilerOptions?.strict).toBe(true);
    });
  });

  describe('vite.config.ts', () => {
    const viteConfigPath = resolve(projectRoot, 'vite.config.ts');

    it('should exist', () => {
      expect(existsSync(viteConfigPath)).toBe(true);
    });

    it('should import vite-plugin-electron', () => {
      const content = readFileSync(viteConfigPath, 'utf-8');
      expect(content).toMatch(/import.*vite-plugin-electron/);
    });
  });

  describe('electron-builder.yml', () => {
    const builderConfigPath = resolve(projectRoot, 'electron-builder.yml');

    it('should exist', () => {
      expect(existsSync(builderConfigPath)).toBe(true);
    });
  });

  describe('index.html', () => {
    const indexHtmlPath = resolve(projectRoot, 'index.html');

    it('should exist', () => {
      expect(existsSync(indexHtmlPath)).toBe(true);
    });

    it('should have mount point for Svelte app', () => {
      const content = readFileSync(indexHtmlPath, 'utf-8');
      expect(content).toMatch(/id=["']app["']/);
    });
  });
});
