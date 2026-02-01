import * as vscode from 'vscode';
import * as os from 'os';

const SECTION = 'terminar';

/**
 * Get the configured socket path, or the default if not set.
 */
export function getConfiguredSocketPath(): string {
    const config = vscode.workspace.getConfiguration(SECTION);
    const customPath = config.get<string>('socketPath', '');
    if (customPath) {
        return customPath;
    }
    return `/tmp/vscode-terminar-${os.userInfo().uid}.sock`;
}

/**
 * Get the configured server binary path, or null to use the default.
 */
export function getConfiguredServerPath(): string | null {
    const config = vscode.workspace.getConfiguration(SECTION);
    const customPath = config.get<string>('serverPath', '');
    return customPath || null;
}

/**
 * Get the configured auth token, or null if not configured.
 */
export function getConfiguredAuthToken(): string | null {
    const config = vscode.workspace.getConfiguration(SECTION);
    const token = config.get<string>('authToken', '');
    return token || null;
}

/**
 * Get whether the server should auto-start on extension activation.
 */
export function getAutoStart(): boolean {
    const config = vscode.workspace.getConfiguration(SECTION);
    return config.get<boolean>('autoStart', true);
}
