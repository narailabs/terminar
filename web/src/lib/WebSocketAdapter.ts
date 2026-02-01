import { EventEmitter } from 'events';

/**
 * IShellSocket interface from shell-protocol.
 * Duplicated here to avoid direct import from the shell-protocol package
 * until it's properly wired as a dependency.
 */
export interface IShellSocket {
    send(data: string): void;
    close(): void;
    on(event: 'message', listener: (data: string) => void): this;
    on(event: 'open', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (err: any) => void): this;
}

/**
 * Adapts a browser WebSocket to the IShellSocket interface
 * required by ShellClient from the shell-protocol package.
 *
 * This bridges the browser WebSocket API (addEventListener-based)
 * to the Node-style EventEmitter interface that ShellClient expects.
 */
export class WebSocketAdapter extends EventEmitter implements IShellSocket {
    constructor(private ws: WebSocket) {
        super();

        ws.addEventListener('open', () => {
            this.emit('open');
        });

        ws.addEventListener('message', (event: MessageEvent) => {
            this.emit('message', event.data);
        });

        ws.addEventListener('close', () => {
            this.emit('close');
        });

        ws.addEventListener('error', (err: Event) => {
            this.emit('error', err);
        });
    }

    send(data: string): void {
        this.ws.send(data);
    }

    close(): void {
        this.ws.close();
    }
}
