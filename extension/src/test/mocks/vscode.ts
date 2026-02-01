export const TreeItemCollapsibleState = {
    None: 0,
    Collapsed: 1,
    Expanded: 2
};

export class TreeItem {
    public tooltip?: string;
    public description?: string;
    public contextValue?: string;
    public iconPath?: any;
    constructor(public label: string, public collapsibleState: number) {}
}

export class ThemeIcon {
    constructor(public readonly id: string) {}
}

export class EventEmitter {
    private listeners: Function[] = [];

    event = (listener: any) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
    };

    fire(data: any) {
        this.listeners.forEach(l => l(data));
    }
}

export const window = {
    createOutputChannel: (name: string) => ({
        appendLine: () => {},
        show: () => {},
        dispose: () => {}
    }),
    registerTreeDataProvider: () => ({ dispose: () => {} }),
    showErrorMessage: () => Promise.resolve(),
    showInformationMessage: () => Promise.resolve(),
    showInputBox: () => Promise.resolve('mock-input'),
    createTerminal: () => ({
        show: () => {},
        dispose: () => {},
        sendText: () => {}
    })
};

export const commands = {
    registry: new Map<string, Function>(),
    registerCommand: (command: string, callback: (...args: any[]) => any) => {
        commands.registry.set(command, callback);
        return { dispose: () => commands.registry.delete(command) };
    },
    executeCommand: (command: string, ...args: any[]) => {
        const cb = commands.registry.get(command);
        if (cb) return cb(...args);
        return Promise.resolve();
    }
};

// Simulated settings store for testing
const settingsStore: Record<string, any> = {};

export const workspace = {
    getConfiguration: (section?: string) => ({
        get: <T>(key: string, defaultValue?: T): T | undefined => {
            const fullKey = section ? `${section}.${key}` : key;
            if (fullKey in settingsStore) {
                return settingsStore[fullKey] as T;
            }
            return defaultValue;
        },
        update: (key: string, value: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            settingsStore[fullKey] = value;
            return Promise.resolve();
        }
    }),
    // Test helper to set/reset config values
    _setConfigValue: (key: string, value: any) => { settingsStore[key] = value; },
    _resetConfig: () => { Object.keys(settingsStore).forEach(k => delete settingsStore[k]); }
};
