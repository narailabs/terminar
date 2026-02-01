import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';

const projectRoot = resolve(__dirname, '../..');

describe('Project Setup', () => {
  describe('package.json', () => {
    const packageJsonPath = resolve(projectRoot, 'package.json');

    it('should exist and be valid JSON', () => {
      expect(existsSync(packageJsonPath)).toBe(true);
      const content = readFileSync(packageJsonPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should have electron ^28.0.0 as dependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.dependencies?.electron || pkg.devDependencies?.electron).toMatch(/^\^?28\./);
    });

    it('should have electron-store ^8.0.0 as dependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.dependencies?.['electron-store']).toMatch(/^\^?8\./);
    });

    it('should have vite ^5.0.0 as devDependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.devDependencies?.vite).toMatch(/^\^?5\./);
    });

    it('should have vite-plugin-electron ^0.28.0 as devDependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.devDependencies?.['vite-plugin-electron']).toMatch(/^\^?0\.28/);
    });

    it('should have vitest ^1.0.0 as devDependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.devDependencies?.vitest).toMatch(/^\^?1\./);
    });

    it('should have typescript ^5.3.0 as devDependency', () => {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.devDependencies?.typescript).toMatch(/^\^?5\.[3-9]/);
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

    it('should have module set to ESNext or ES2022+', () => {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      const module = tsconfig.compilerOptions?.module?.toLowerCase();
      expect(['esnext', 'es2022', 'es2023', 'nodenext', 'node16']).toContain(module);
    });

    it('should have moduleResolution set correctly for ESM', () => {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      const moduleResolution = tsconfig.compilerOptions?.moduleResolution?.toLowerCase();
      expect(['bundler', 'nodenext', 'node16']).toContain(moduleResolution);
    });

    it('should have strict mode enabled', () => {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      expect(tsconfig.compilerOptions?.strict).toBe(true);
    });

    it('should have esModuleInterop enabled', () => {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      expect(tsconfig.compilerOptions?.esModuleInterop).toBe(true);
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

    it('should configure electron plugin with main entry', () => {
      const content = readFileSync(viteConfigPath, 'utf-8');
      expect(content).toMatch(/entry.*main/i);
    });

    it('should configure electron plugin with preload entry', () => {
      const content = readFileSync(viteConfigPath, 'utf-8');
      expect(content).toMatch(/entry.*preload/i);
    });
  });

  describe('electron-builder.yml', () => {
    const builderConfigPath = resolve(projectRoot, 'electron-builder.yml');

    it('should exist and be valid YAML', () => {
      expect(existsSync(builderConfigPath)).toBe(true);
      const content = readFileSync(builderConfigPath, 'utf-8');
      expect(() => parseYaml(content)).not.toThrow();
    });

    it('should configure macOS with dmg and zip targets', () => {
      const content = readFileSync(builderConfigPath, 'utf-8');
      const config = parseYaml(content);
      const macTargets = config.mac?.target || [];
      // Targets may be objects with {target, arch} or plain strings
      const targetNames = macTargets.map((t: any) => typeof t === 'string' ? t : t.target);
      expect(targetNames).toContain('dmg');
      expect(targetNames).toContain('zip');
    });

    it('should configure Windows with nsis target', () => {
      const content = readFileSync(builderConfigPath, 'utf-8');
      const config = parseYaml(content);
      const winTargets = config.win?.target || [];
      const targetNames = winTargets.map((t: any) => typeof t === 'string' ? t : t.target);
      expect(targetNames).toContain('nsis');
    });

    it('should configure Linux with AppImage and deb targets', () => {
      const content = readFileSync(builderConfigPath, 'utf-8');
      const config = parseYaml(content);
      const linuxTargets = config.linux?.target || [];
      const targetNames = linuxTargets.map((t: any) => typeof t === 'string' ? t : t.target);
      expect(targetNames).toContain('AppImage');
      expect(targetNames).toContain('deb');
    });
  });

  describe('index.html', () => {
    const indexHtmlPath = resolve(projectRoot, 'src/renderer/index.html');

    it('should exist', () => {
      expect(existsSync(indexHtmlPath)).toBe(true);
    });

    it('should have CSP meta tag', () => {
      const content = readFileSync(indexHtmlPath, 'utf-8');
      expect(content).toMatch(/Content-Security-Policy/i);
    });

    it('should have mount point for Svelte app', () => {
      const content = readFileSync(indexHtmlPath, 'utf-8');
      expect(content).toMatch(/id=["']app["']/);
    });

    it('should be valid HTML with doctype', () => {
      const content = readFileSync(indexHtmlPath, 'utf-8');
      expect(content).toMatch(/<!DOCTYPE html>/i);
    });
  });
});
