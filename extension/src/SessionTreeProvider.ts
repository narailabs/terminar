import * as vscode from 'vscode';
import { SessionManager, SessionInfo } from './SessionManager';

/**
 * Extended session info that may include status field
 */
interface ExtendedSessionInfo extends SessionInfo {
    status?: 'running' | 'idle' | 'error';
}

/**
 * Map a session status to a VS Code ThemeIcon codicon id.
 */
function statusIcon(status?: string): vscode.ThemeIcon {
    switch (status) {
        case 'idle':
            return new vscode.ThemeIcon('debug-pause');
        case 'error':
            return new vscode.ThemeIcon('warning');
        case 'running':
        default:
            return new vscode.ThemeIcon('debug-start');
    }
}

/**
 * Build a detailed tooltip string for a session.
 */
function buildTooltip(session: ExtendedSessionInfo): string {
    const parts: string[] = [];
    parts.push(`Shell: ${session.shell}`);
    parts.push(`ID: ${session.id}`);
    if (session.started_at) {
        parts.push(`Started: ${session.started_at}`);
    }
    if (session.status) {
        parts.push(`Status: ${session.status}`);
    }
    return parts.join('\n');
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null | void> = new vscode.EventEmitter<SessionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private sessions: ExtendedSessionInfo[] = [];
    private manager: SessionManager | null = null;

    constructor(manager: SessionManager | null) {
        if (manager) {
            this.setManager(manager);
        }
    }

    setManager(manager: SessionManager): void {
        this.manager = manager;
        manager.on('sessionList', (sessions: ExtendedSessionInfo[]) => {
            this.sessions = sessions;
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SessionItem): Thenable<SessionItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return Promise.resolve(
                this.sessions.map(s => new SessionItem(
                    s.name || s.shell,
                    s.id,
                    s.shell,
                    vscode.TreeItemCollapsibleState.None,
                    s.started_at,
                    s.status
                ))
            );
        }
    }
}

class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly sessionId: string,
        public readonly shell: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly startedAt?: string,
        public readonly status?: string
    ) {
        super(label, collapsibleState);
        this.tooltip = buildTooltip({
            id: sessionId,
            name: label,
            shell,
            started_at: startedAt || '',
            status: status as any
        });
        this.description = this.shell;
        this.contextValue = 'session';
        this.iconPath = statusIcon(status);
    }
}
