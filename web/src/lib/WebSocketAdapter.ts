import { EventEmitter } from 'events';
import type { IShellSocket } from './shared-protocol';

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
