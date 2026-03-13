import * as vscode from 'vscode';
import * as os from 'os';
import { SessionManager, SessionInfo } from './SessionManager';
import { SessionTreeProvider } from './SessionTreeProvider';
import { ServerController } from './ServerController';
import { WebSocketSessionManager, SessionInfo as WsSessionInfo } from './WebSocketAdapter';
import { setupServerErrorHandler } from './errorHandling';

function getSocketPath(): string {
    return `/tmp/vscode-terminar-${os.userInfo().uid}.sock`;
}

class TerminarExtension {
    private manager: SessionManager | WebSocketSessionManager | null = null;
    private remoteManager: WebSocketSessionManager | null = null;
    private treeProvider: SessionTreeProvider | null = null;
    private serverController: ServerController;
    private outputChannel: vscode.OutputChannel;
    private activeTerminals = new Map<string, Terminar>();
    private knownSessions = new Set<string>();

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel("terminar");
        this.outputChannel.appendLine("Extension activated.");

        this.serverController = new ServerController(context.extensionPath);
    }

    async activate(): Promise<void> {
        // Wire up server error handling with retry support
        setupServerErrorHandler(this.serverController, this.outputChannel, () => {
            this.outputChannel.appendLine("Retrying server spawn...");
            this.ensureServerRunning().then(() => {
                this.outputChannel.appendLine("Connected to backend after retry.");
                this.manager!.listSessions();
            }).catch(err => {
                vscode.window.showErrorMessage("Retry failed: " + err);
            });
        });

        // Initialize tree provider with null manager (will be set after connection)
        this.treeProvider = new SessionTreeProvider(null);
        vscode.window.registerTreeDataProvider('terminarSessions', this.treeProvider);

        this.ensureServerRunning().then(() => {
            this.outputChannel.appendLine("Connected to backend.");
            this.manager!.listSessions();
        }).catch(err => {
            vscode.window.showErrorMessage("Failed to start terminar server: " + err);
        });

        this.registerCommands();
    }

    deactivate(): void {
        if (this.manager) {
            this.manager.disconnect();
            this.manager = null;
        }
        if (this.remoteManager) {
            this.remoteManager.disconnect();
            this.remoteManager = null;
        }
        this.activeTerminals.clear();
        this.knownSessions.clear();
        if (this.outputChannel) {
            this.outputChannel.appendLine("Extension deactivated.");
            this.outputChannel.dispose();
        }
        this.treeProvider = null;
    }

    private registerCommands(): void {
        this.context.subscriptions.push(vscode.commands.registerCommand('terminar.newSession', async () => {
            if (this.manager) {
                const env: Record<string, string> = {};
                for (const [key, value] of Object.entries(process.env)) {
                    if (value !== undefined) {
                        env[key] = value;
                    }
                }
                this.manager.createSession(os.homedir(), process.env.SHELL || '/bin/bash', env);
            }
        }));

        this.context.subscriptions.push(vscode.commands.registerCommand('terminar.connectRemote', async () => {
            const host = await vscode.window.showInputBox({ prompt: 'Enter server address (e.g. localhost:6749)', placeHolder: 'localhost:6749' });
            if (!host) return;

            try {
                this.outputChannel.appendLine(`Connecting to ${host}...`);
                vscode.window.showInformationMessage(`Connecting to ${host}...`);

                if (this.remoteManager) {
                    this.remoteManager.disconnect();
                }

                const wsUrl = `wss://${host}/ws`;
                this.remoteManager = new WebSocketSessionManager(wsUrl);

                this.remoteManager.on('sessionList', (sessions: WsSessionInfo[]) => {
                    this.outputChannel.appendLine(`Remote sessions: ${sessions.length}`);
                    for (const s of sessions) {
                        if (!this.knownSessions.has(`remote-${s.id}`)) {
                            this.knownSessions.add(`remote-${s.id}`);
                            this.createRemoteTerminalUI(s.id, s.shell, host);
                        }
                    }
                });

                this.remoteManager.on('output', (sessionId: string, data: string) => {
                    const term = this.activeTerminals.get(`remote-${sessionId}`);
                    if (term) term.write(data);
                });

                this.remoteManager.on('sessionClosed', (sessionId: string) => {
                    this.outputChannel.appendLine(`Remote session ${sessionId} closed`);
                });

                this.remoteManager.on('error', (err: Error) => {
                    this.outputChannel.appendLine(`Remote connection error: ${err.message}`);
                });

                this.remoteManager.on('reconnecting', (attempt: number, delay: number) => {
                    this.outputChannel.appendLine(`Reconnecting to ${host} in ${delay}ms (attempt ${attempt})`);
                });

                this.remoteManager.on('reconnected', () => {
                    this.outputChannel.appendLine(`Reconnected to ${host}`);
                    vscode.window.showInformationMessage(`Reconnected to ${host}`);
                });

                await this.remoteManager.connect();
                this.outputChannel.appendLine(`Connected to remote server ${host}`);
                vscode.window.showInformationMessage(`Connected to ${host}!`);

                this.remoteManager.listSessions();

            } catch (err) {
                this.outputChannel.appendLine(`Error connecting to ${host}: ${err}`);
                vscode.window.showErrorMessage(`Error connecting to ${host}: ${err}`);
            }
        }));
    }

    private setupManager(): SessionManager {
        const newManager = new SessionManager(getSocketPath());

        newManager.on('sessionList', (sessions: SessionInfo[]) => this.updateSessionList(sessions));
        newManager.on('output', (sessionId: string, data: string) => {
            const term = this.activeTerminals.get(sessionId);
            if (term) term.write(data);
        });

        return newManager;
    }

    private async ensureServerRunning(): Promise<void> {
        // Try connecting to an already-running server
        try {
            this.manager = this.setupManager();
            if (this.treeProvider) {
                this.treeProvider.setManager(this.manager);
            }
            await (this.manager as SessionManager).connect();
            return;
        } catch (e) {
            this.outputChannel.appendLine("Connection failed, will spawn server...");
        }

        this.outputChannel.appendLine("Server not found, spawning...");
        await this.serverController.spawn();

        // Wait for server socket to become available
        for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(r => setTimeout(r, 500));
            try {
                this.manager = this.setupManager();
                if (this.treeProvider) {
                    this.treeProvider.setManager(this.manager);
                }
                await (this.manager as SessionManager).connect();
                return;
            } catch {
                // Server not ready yet, retry
            }
        }

        throw new Error('Server failed to start - could not connect to socket');
    }

    private updateSessionList(sessions: SessionInfo[]): void {
        for (const s of sessions) {
            if (!this.knownSessions.has(s.id)) {
                this.knownSessions.add(s.id);
                this.createTerminalUI(s.id, s.shell);
            }
        }
    }

    private createTerminalUI(sessionId: string, shell: string): void {
        const pt = new Terminar(sessionId, false, this);
        this.activeTerminals.set(sessionId, pt);

        const terminal = vscode.window.createTerminal({
            name: `terminar: ${shell}`,
            pty: pt.getPty()
        });

        if (this.manager instanceof SessionManager) {
            this.manager.attach(sessionId);
        }
        terminal.show();
        vscode.commands.executeCommand('workbench.action.terminal.moveToEditor');
    }

    private createRemoteTerminalUI(sessionId: string, shell: string, host: string): void {
        const pt = new Terminar(sessionId, true, this);
        this.activeTerminals.set(`remote-${sessionId}`, pt);

        const terminal = vscode.window.createTerminal({
            name: `terminar Remote (${host}): ${shell}`,
            pty: pt.getPty()
        });

        if (this.remoteManager) {
            this.remoteManager.attach(sessionId);
        }
        terminal.show();
        vscode.commands.executeCommand('workbench.action.terminal.moveToEditor');
    }

    // Public accessors for Terminar PTY to call
    sendInput(sessionId: string, data: string, isRemote: boolean): void {
        if (isRemote && this.remoteManager) {
            this.remoteManager.sendInput(sessionId, data);
        } else if (!isRemote && this.manager) {
            this.manager.sendInput(sessionId, data);
        }
    }

    resize(sessionId: string, cols: number, rows: number, isRemote: boolean): void {
        if (isRemote && this.remoteManager) {
            this.remoteManager.resize(sessionId, cols, rows);
        } else if (!isRemote && this.manager) {
            this.manager.resize(sessionId, cols, rows);
        }
    }
}

class Terminar {
    private writeEmitter = new vscode.EventEmitter<string>();

    constructor(
        private sessionId: string,
        private isRemote: boolean,
        private ext: TerminarExtension,
    ) {}

    public write(data: string) {
        this.writeEmitter.fire(data);
    }

    public getPty(): vscode.Pseudoterminal {
        return {
            onDidWrite: this.writeEmitter.event,
            open: () => {},
            close: () => {},
            handleInput: (data) => {
                this.ext.sendInput(this.sessionId, data, this.isRemote);
            },
            setDimensions: (dims) => {
                this.ext.resize(this.sessionId, dims.columns, dims.rows, this.isRemote);
            }
        };
    }
}

let extensionInstance: TerminarExtension | null = null;

export function activate(context: vscode.ExtensionContext) {
    extensionInstance = new TerminarExtension(context);
    extensionInstance.activate();
}

export function deactivate(): void {
    if (extensionInstance) {
        extensionInstance.deactivate();
        extensionInstance = null;
    }
}
