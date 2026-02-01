import * as vscode from 'vscode';
import * as os from 'os';
import { SessionManager, SessionInfo, readTokenFile } from './SessionManager';
import { SessionTreeProvider } from './SessionTreeProvider';
import { ServerController } from './ServerController';
import { WebSocketSessionManager, exchangePairingCode, SessionInfo as WsSessionInfo } from './WebSocketAdapter';
import { setupServerErrorHandler } from './errorHandling';

// Union type for both local and remote session managers
type SessionManagerType = SessionManager | WebSocketSessionManager;

let manager: SessionManagerType | null = null;
let remoteManager: WebSocketSessionManager | null = null;
let treeProvider: SessionTreeProvider | null = null;
let serverController: ServerController;
let outputChannel: vscode.OutputChannel;
const activeTerminals = new Map<string, Terminar>();
const knownSessions = new Set<string>();

function getSocketPath(): string {
    return `/tmp/vscode-terminar-${os.userInfo().uid}.sock`;
}

function setupManager(): SessionManager {
    const token = readTokenFile();
    if (!token) {
        throw new Error('Token file not found. Server may not be running.');
    }

    const newManager = new SessionManager(getSocketPath(), token);

    newManager.on('sessionList', updateSessionList);
    newManager.on('output', (sessionId, data) => {
        const term = activeTerminals.get(sessionId);
        if (term) term.write(data);
    });

    return newManager;
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("termiNar");
    outputChannel.appendLine("Extension activated.");

    serverController = new ServerController(context.extensionPath);

    // Wire up server error handling with retry support
    setupServerErrorHandler(serverController, outputChannel, () => {
        outputChannel.appendLine("Retrying server spawn...");
        ensureServerRunning(context).then(() => {
            outputChannel.appendLine("Connected to backend after retry.");
            manager!.listSessions();
        }).catch(err => {
            vscode.window.showErrorMessage("Retry failed: " + err);
        });
    });

    // Initialize tree provider with null manager (will be set after connection)
    treeProvider = new SessionTreeProvider(null);
    vscode.window.registerTreeDataProvider('terminarSessions', treeProvider);

    ensureServerRunning(context).then(() => {
        outputChannel.appendLine("Connected to backend.");
        manager!.listSessions();
    }).catch(err => {
        vscode.window.showErrorMessage("Failed to start termiNar server: " + err);
    });

    context.subscriptions.push(vscode.commands.registerCommand('terminar.newSession', async () => {
        if (manager) {
            // Filter out undefined values from process.env
            const env: Record<string, string> = {};
            for (const [key, value] of Object.entries(process.env)) {
                if (value !== undefined) {
                    env[key] = value;
                }
            }
            manager.createSession(os.homedir(), process.env.SHELL || '/bin/bash', env);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('terminar.connectRemote', async () => {
        const host = await vscode.window.showInputBox({ prompt: 'Enter server address (e.g. localhost:3000)', placeHolder: 'localhost:3000' });
        if (!host) return;

        const code = await vscode.window.showInputBox({ prompt: 'Enter 6-digit pairing code', placeHolder: '123456' });
        if (!code) return;

        try {
            outputChannel.appendLine(`Attempting to pair with ${host}...`);
            vscode.window.showInformationMessage(`Pairing with ${host}...`);

            // Exchange pairing code for token
            const token = await exchangePairingCode(host, code);
            outputChannel.appendLine('Pairing successful, connecting via WebSocket...');

            // Disconnect existing remote connection if any
            if (remoteManager) {
                remoteManager.disconnect();
            }

            // Create WebSocket connection
            const wsUrl = `ws://${host}/ws`;
            remoteManager = new WebSocketSessionManager(wsUrl, token);

            // Set up event handlers
            remoteManager.on('sessionList', (sessions: WsSessionInfo[]) => {
                outputChannel.appendLine(`Remote sessions: ${sessions.length}`);
                for (const s of sessions) {
                    if (!knownSessions.has(`remote-${s.id}`)) {
                        knownSessions.add(`remote-${s.id}`);
                        createRemoteTerminalUI(s.id, s.shell, host);
                    }
                }
            });

            remoteManager.on('output', (sessionId: string, data: string) => {
                const term = activeTerminals.get(`remote-${sessionId}`);
                if (term) term.write(data);
            });

            remoteManager.on('sessionClosed', (sessionId: string) => {
                outputChannel.appendLine(`Remote session ${sessionId} closed`);
            });

            remoteManager.on('error', (err: Error) => {
                outputChannel.appendLine(`Remote connection error: ${err.message}`);
            });

            remoteManager.on('reconnecting', (attempt: number, delay: number) => {
                outputChannel.appendLine(`Reconnecting to ${host} in ${delay}ms (attempt ${attempt})`);
            });

            remoteManager.on('reconnected', () => {
                outputChannel.appendLine(`Reconnected to ${host}`);
                vscode.window.showInformationMessage(`Reconnected to ${host}`);
            });

            // Connect
            await remoteManager.connect();
            outputChannel.appendLine(`Connected to remote server ${host}`);
            vscode.window.showInformationMessage(`Connected to ${host}!`);

            // List sessions
            remoteManager.listSessions();

        } catch (err) {
            outputChannel.appendLine(`Error connecting to ${host}: ${err}`);
            vscode.window.showErrorMessage(`Error connecting to ${host}: ${err}`);
        }
    }));
}

async function ensureServerRunning(context: vscode.ExtensionContext): Promise<void> {
    // First, try to connect if token already exists (server already running)
    const existingToken = readTokenFile();
    if (existingToken) {
        try {
            manager = setupManager();
            if (treeProvider) {
                treeProvider.setManager(manager);
            }
            await manager.connect();
            return;
        } catch (e) {
            outputChannel.appendLine("Connection failed, will spawn server...");
        }
    }

    // Server not running - spawn it
    outputChannel.appendLine("Server not found, spawning...");
    await spawnServer(context);

    // Wait for server to start and write token file
    for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 500));
        const token = readTokenFile();
        if (token) {
            manager = setupManager();
            if (treeProvider) {
                treeProvider.setManager(manager);
            }
            await manager.connect();
            return;
        }
    }

    throw new Error('Server failed to start - token file not created');
}

async function spawnServer(context: vscode.ExtensionContext): Promise<void> {
    outputChannel.appendLine("Spawning server...");
    return serverController.spawn();
}

function updateSessionList(sessions: SessionInfo[]) {
    for (const s of sessions) {
        if (!knownSessions.has(s.id)) {
            knownSessions.add(s.id);
            createTerminalUI(s.id, s.shell);
        }
    }
}

function createTerminalUI(sessionId: string, shell: string) {
    const pt = new Terminar(sessionId, false);
    activeTerminals.set(sessionId, pt);

    const terminal = vscode.window.createTerminal({
        name: `termiNar: ${shell}`,
        pty: pt.getPty()
    });

    if (manager && 'attach' in manager) {
        manager.attach(sessionId);
    }
    terminal.show();
    vscode.commands.executeCommand('workbench.action.terminal.moveToEditor');
}

function createRemoteTerminalUI(sessionId: string, shell: string, host: string) {
    const pt = new Terminar(sessionId, true);
    activeTerminals.set(`remote-${sessionId}`, pt);

    const terminal = vscode.window.createTerminal({
        name: `termiNar Remote (${host}): ${shell}`,
        pty: pt.getPty()
    });

    if (remoteManager) {
        remoteManager.attach(sessionId);
    }
    terminal.show();
    vscode.commands.executeCommand('workbench.action.terminal.moveToEditor');
}

class Terminar {
    private writeEmitter = new vscode.EventEmitter<string>();

    constructor(private sessionId: string, private isRemote: boolean = false) {}

    public write(data: string) {
        this.writeEmitter.fire(data);
    }

    public getPty(): vscode.Pseudoterminal {
        const self = this;
        return {
            onDidWrite: this.writeEmitter.event,
            open: () => {},
            close: () => {},
            handleInput: (data) => {
                if (self.isRemote && remoteManager) {
                    remoteManager.sendInput(self.sessionId, data);
                } else if (!self.isRemote && manager) {
                    manager.sendInput(self.sessionId, data);
                }
            },
            setDimensions: (dims) => {
                if (self.isRemote && remoteManager) {
                    remoteManager.resize(self.sessionId, dims.columns, dims.rows);
                } else if (!self.isRemote && manager) {
                    manager.resize(self.sessionId, dims.columns, dims.rows);
                }
            }
        };
    }
}

/**
 * Clean up resources when extension is deactivated
 */
export function deactivate(): void {
    // Disconnect from local server (disables automatic reconnection)
    if (manager) {
        manager.disconnect();
        manager = null;
    }

    // Disconnect from remote server
    if (remoteManager) {
        remoteManager.disconnect();
        remoteManager = null;
    }

    // Clear active terminals map
    activeTerminals.clear();

    // Clear known sessions
    knownSessions.clear();

    // Dispose output channel
    if (outputChannel) {
        outputChannel.appendLine("Extension deactivated.");
        outputChannel.dispose();
    }

    // Clear tree provider reference
    treeProvider = null;
}
