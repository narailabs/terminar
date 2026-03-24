/**
 * SSH private key parser for Ed25519 keys in OpenSSH format.
 * Uses Web Crypto API for signing - the key never leaves the browser.
 */

export interface ParsedSshKey {
  publicKeyStr: string;
  algorithm: string;
  signFn: (nonce: string) => Promise<string>;
}

export async function parseSshPrivateKey(pem: string): Promise<ParsedSshKey> {
  const lines = pem.trim().split('\n');
  if (!lines[0].includes('OPENSSH PRIVATE KEY') && !lines[0].includes('BEGIN')) {
    throw new Error('Unsupported key format. Please use an OpenSSH private key.');
  }

  // Extract base64 content between header/footer
  const b64Lines = lines.filter(l => !l.startsWith('-----')).join('');
  const keyData = Uint8Array.from(atob(b64Lines), c => c.charCodeAt(0));

  // Parse OpenSSH private key format
  // Format: "openssh-key-v1\0" + cipher + kdf + kdf_options + num_keys + public_key + private_key
  const decoder = new TextDecoder();
  const magic = decoder.decode(keyData.slice(0, 15));
  if (magic !== 'openssh-key-v1\0') {
    throw new Error('Not an OpenSSH private key format');
  }

  let offset = 15;

  function readString(): Uint8Array {
    const len = new DataView(keyData.buffer, keyData.byteOffset + offset, 4).getUint32(0);
    offset += 4;
    const data = keyData.slice(offset, offset + len);
    offset += len;
    return data;
  }

  const ciphername = decoder.decode(readString());
  const _kdfname = readString(); // kdf name
  const _kdfoptions = readString(); // kdf options
  const numKeys = new DataView(keyData.buffer, keyData.byteOffset + offset, 4).getUint32(0);
  offset += 4;

  if (ciphername !== 'none') {
    throw new Error('Encrypted SSH keys are not supported in the browser. Please use an unencrypted key.');
  }
  if (numKeys !== 1) {
    throw new Error('Multi-key SSH files are not supported');
  }

  // Read public key blob
  const pubKeyBlob = readString();
  // Read private key section
  const privSection = readString();

  // Parse public key blob to get algorithm
  let pkOffset = 0;
  function readPubString(): Uint8Array {
    const len = new DataView(pubKeyBlob.buffer, pubKeyBlob.byteOffset + pkOffset, 4).getUint32(0);
    pkOffset += 4;
    const data = pubKeyBlob.slice(pkOffset, pkOffset + len);
    pkOffset += len;
    return data;
  }

  const algorithm = decoder.decode(readPubString());
  if (algorithm !== 'ssh-ed25519') {
    throw new Error(`Unsupported key algorithm: ${algorithm}. Only ssh-ed25519 is supported in the browser.`);
  }

  const _pubKeyBytes = readPubString(); // 32 bytes for ed25519

  // Build the OpenSSH public key string (algorithm + base64 blob)
  const publicKeyStr = `ssh-ed25519 ${btoa(String.fromCharCode(...pubKeyBlob))}`;

  // Parse private section to get the seed (private key bytes)
  let privOffset = 0;
  function readPrivString(): Uint8Array {
    const len = new DataView(privSection.buffer, privSection.byteOffset + privOffset, 4).getUint32(0);
    privOffset += 4;
    const data = privSection.slice(privOffset, privOffset + len);
    privOffset += len;
    return data;
  }

  // Check numbers (random uint32 repeated twice)
  const check1 = new DataView(privSection.buffer, privSection.byteOffset, 4).getUint32(0);
  const check2 = new DataView(privSection.buffer, privSection.byteOffset + 4, 4).getUint32(0);
  if (check1 !== check2) {
    throw new Error('Key decryption failed (checkints do not match). Key may be encrypted.');
  }
  privOffset = 8;

  const _privAlgo = readPrivString(); // algorithm again
  const _privPubKey = readPrivString(); // public key again
  const privKeyFull = readPrivString(); // 64 bytes: seed (32) + pubkey (32)
  const seed = privKeyFull.slice(0, 32); // ed25519 seed

  // Import the key into Web Crypto for signing
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    seed,
    { name: 'Ed25519' },
    false,
    ['sign'],
  ).catch(() => {
    throw new Error('Your browser does not support Ed25519 signing. Try a recent Chrome or Firefox.');
  });

  const signFn = async (nonce: string): Promise<string> => {
    const nonceBytes = Uint8Array.from(atob(nonce), c => c.charCodeAt(0));
    const signature = await crypto.subtle.sign('Ed25519', cryptoKey, nonceBytes);
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  };

  return { publicKeyStr, algorithm, signFn };
}
