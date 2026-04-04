export function isElectronMac(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  // Primary: contextBridge API from preload
  const platform = (window as any).electronAPI?.platform;
  if (platform) return platform === 'darwin';
  // Fallback: navigator-based detection
  return navigator.userAgent.includes('Electron') &&
    (navigator.platform.startsWith('Mac') || navigator.platform === 'MacIntel');
}
