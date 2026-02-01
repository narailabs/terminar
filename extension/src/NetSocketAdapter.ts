import * as net from 'net';
import { IShellSocket } from '@narai/terminar-protocol/dist/client';
import { EventEmitter } from 'events';

/**
 * NetSocketAdapter using length-prefixed framing protocol.
 *
 * Frame format: 4-byte big-endian length + JSON payload
 * This prevents protocol corruption when JSON contains newlines or binary data.
 */
export class NetSocketAdapter extends EventEmitter implements IShellSocket {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private socket: net.Socket) {
    super();

    socket.on('connect', () => this.emit('open'));
    socket.on('close', () => this.emit('close'));
    socket.on('error', (err) => this.emit('error', err));

    socket.on('data', (data: Buffer) => {
      // Append new data to buffer
      this.buffer = Buffer.concat([this.buffer, data]);
      this.parseFrames();
    });
  }

  /**
   * Parse length-prefixed frames from the buffer.
   * Frame format: [4 bytes: length (BE uint32)][N bytes: JSON payload]
   */
  private parseFrames(): void {
    while (this.buffer.length >= 4) {
      // Read the length prefix (4 bytes, big-endian)
      const length = this.buffer.readUInt32BE(0);

      // Check if we have the complete frame
      if (this.buffer.length < 4 + length) {
        break; // Wait for more data
      }

      // Extract the JSON payload
      const json = this.buffer.subarray(4, 4 + length).toString('utf-8');

      // Remove processed frame from buffer
      this.buffer = this.buffer.subarray(4 + length);

      // Emit the message
      if (json.trim()) {
        this.emit('message', json);
      }
    }
  }

  /**
   * Send data with length-prefixed framing.
   */
  send(data: string): void {
    const payload = Buffer.from(data, 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    this.socket.write(Buffer.concat([header, payload]));
  }

  close(): void {
    this.socket.destroy();
  }
}