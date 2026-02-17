#!/usr/bin/env node
// Generate tray icons for macOS and general use.
// Creates a simple ">_" terminal prompt icon.
// macOS template images: black on transparent, named *Template*.png

import { createWriteStream } from 'fs';
import { mkdirSync } from 'fs';
import { deflateSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Create a PNG buffer from raw RGBA pixel data */
function createPNG(width, height, rgba) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT chunk — add filter byte (0 = None) before each row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx] = rgba[srcIdx];     // R
      rawData[dstIdx + 1] = rgba[srcIdx + 1]; // G
      rawData[dstIdx + 2] = rgba[srcIdx + 2]; // B
      rawData[dstIdx + 3] = rgba[srcIdx + 3]; // A
    }
  }
  const compressed = deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Draw a ">_" terminal prompt icon.
 * For template images: black (0,0,0) on transparent background.
 */
function drawTerminalIcon(size) {
  const rgba = new Uint8Array(size * size * 4);

  // Helper to set a pixel
  const setPixel = (x, y, r, g, b, a) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    rgba[idx] = r;
    rgba[idx + 1] = g;
    rgba[idx + 2] = b;
    rgba[idx + 3] = a;
  };

  // Draw a thick line from (x0,y0) to (x1,y1)
  const drawLine = (x0, y0, x1, y1, thickness) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      for (let tx = -thickness; tx <= thickness; tx++) {
        for (let ty = -thickness; ty <= thickness; ty++) {
          if (tx * tx + ty * ty <= thickness * thickness) {
            setPixel(Math.round(cx + tx), Math.round(cy + ty), 0, 0, 0, 255);
          }
        }
      }
    }
  };

  // Draw a filled rectangle
  const fillRect = (x, y, w, h) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        setPixel(x + dx, y + dy, 0, 0, 0, 255);
      }
    }
  };

  if (size === 16) {
    // 16x16: ">" chevron + "_" underscore
    // Chevron ">" - left side
    drawLine(3, 3, 7, 7, 1);   // top-right diagonal
    drawLine(3, 11, 7, 7, 1);  // bottom-right diagonal

    // Underscore "_" - right side
    fillRect(9, 11, 5, 2);
  } else if (size === 32) {
    // 32x32: scaled up version
    drawLine(6, 6, 14, 15, 1.8);   // top-right diagonal
    drawLine(6, 24, 14, 15, 1.8);  // bottom-right diagonal

    // Underscore
    fillRect(17, 22, 10, 3);
  } else if (size === 128) {
    // 128x128: large version
    drawLine(24, 24, 56, 60, 5);
    drawLine(24, 96, 56, 60, 5);

    // Underscore
    fillRect(68, 88, 40, 8);
  } else if (size === 256) {
    // 256x256: extra large
    drawLine(48, 48, 112, 120, 10);
    drawLine(48, 192, 112, 120, 10);

    // Underscore
    fillRect(136, 176, 80, 16);
  }

  return Buffer.from(rgba.buffer);
}

// Generate icons
const iconsDir = join(__dirname, '..', 'icons');

const sizes = [
  { size: 16, filename: 'iconTemplate.png' },
  { size: 32, filename: 'iconTemplate@2x.png' },
  { size: 32, filename: '32x32.png' },
  { size: 128, filename: '128x128.png' },
  { size: 256, filename: '128x128@2x.png' },
  { size: 256, filename: 'icon.png' },
];

for (const { size, filename } of sizes) {
  const pixels = drawTerminalIcon(size);
  const png = createPNG(size, size, pixels);
  const outPath = join(iconsDir, filename);
  const ws = createWriteStream(outPath);
  ws.write(png);
  ws.end();
  console.log(`Generated ${filename} (${size}x${size}, ${png.length} bytes)`);
}

console.log('\nDone! Template images for macOS tray created.');
