import { createHash, createHmac } from "node:crypto";
import * as secp256k1 from "@noble/secp256k1";
import * as dagCbor from "@ipld/dag-cbor";
import type { Logger } from "../lib/logger.js";

// ---------------------------------------------------------------------------
// Configure @noble/secp256k1 v3 sync hashes (required for sync sign/verify)
// Uses Node.js built-in crypto instead of @noble/hashes dependency.
// ---------------------------------------------------------------------------

secp256k1.hashes.hmacSha256 = (key: Uint8Array, message: Uint8Array) => {
  return new Uint8Array(createHmac("sha256", key).update(message).digest());
};

secp256k1.hashes.sha256 = (message: Uint8Array) => {
  return new Uint8Array(createHash("sha256").update(message).digest());
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PLC_DIRECTORY_URL = "https://plc.directory";

/**
 * Multicodec prefix for secp256k1 public keys.
 * Varint-encoded 0xe7 = [0xe7, 0x01].
 */
const SECP256K1_MULTICODEC_PREFIX = new Uint8Array([0xe7, 0x01]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for generating a PLC DID. */
export interface GenerateDidParams {
  /** Community handle, e.g. "community.barazo.forum" */
  handle: string;
  /** Community service endpoint, e.g. "https://community.barazo.forum" */
  serviceEndpoint: string;
  /** PLC directory URL. Defaults to https://plc.directory */
  plcDirectoryUrl?: string;
}

/** Result of PLC DID generation. */
export interface GenerateDidResult {
  /** The generated DID, e.g. "did:plc:abc123..." */
  did: string;
  /** Hex-encoded signing private key */
  signingKey: string;
  /** Hex-encoded rotation private key */
  rotationKey: string;
}

/** PLC genesis operation (unsigned). */
export interface PlcGenesisOperation {
  type: "plc_operation";
  rotationKeys: string[];
  verificationMethods: {
    atproto: string;
  };
  alsoKnownAs: string[];
  services: {
    atproto_pds: {
      type: "AtprotoPersonalDataServer";
      endpoint: string;
    };
  };
  prev: null;
}

/** PLC genesis operation with signature. */
export interface SignedPlcOperation extends PlcGenesisOperation {
  sig: string;
}

/** PLC DID service interface for dependency injection and testing. */
export interface PlcDidService {
  generateDid(params: GenerateDidParams): Promise<GenerateDidResult>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Base32 encode bytes using RFC 4648 lowercase alphabet, no padding.
 * Used for PLC DID computation.
 */
export function base32Encode(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const char = alphabet[(value >>> bits) & 31];
      if (char !== undefined) output += char;
    }
  }

  if (bits > 0) {
    const char = alphabet[(value << (5 - bits)) & 31];
    if (char !== undefined) output += char;
  }

  return output;
}

/**
 * Encode a compressed secp256k1 public key as a did:key string.
 *
 * Format: "did:key:z" + base58btc(multicodec_prefix + compressed_pubkey)
 *
 * The multicodec prefix for secp256k1 is 0xe7 (varint-encoded as [0xe7, 0x01]).
 * Base58btc uses the 'z' multibase prefix.
 */
export function compressedPubKeyToDidKey(pubKey: Uint8Array): string {
  // Concatenate multicodec prefix + compressed public key
  const prefixed = new Uint8Array(
    SECP256K1_MULTICODEC_PREFIX.length + pubKey.length,
  );
  prefixed.set(SECP256K1_MULTICODEC_PREFIX, 0);
  prefixed.set(pubKey, SECP256K1_MULTICODEC_PREFIX.length);

  // Base58btc encode (with 'z' multibase prefix)
  const encoded = base58btcEncode(prefixed);
  return `did:key:z${encoded}`;
}

/**
 * Base58btc encoding using the Bitcoin alphabet.
 */
export function base58btcEncode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  // Count leading zeros
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeros++;
  }

  // Convert bytes to a BigInt
  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }

  // Encode to base58
  let encoded = "";
  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    const char = ALPHABET[remainder] ?? "";
    encoded = char + encoded;
  }

  // Add leading '1's for each leading zero byte
  return "1".repeat(leadingZeros) + encoded;
}

/**
 * Build a PLC genesis operation (unsigned).
 */
export function buildGenesisOperation(
  signingPubKeyDidKey: string,
  rotationPubKeyDidKey: string,
  handle: string,
  serviceEndpoint: string,
): PlcGenesisOperation {
  return {
    type: "plc_operation",
    rotationKeys: [rotationPubKeyDidKey],
    verificationMethods: {
      atproto: signingPubKeyDidKey,
    },
    alsoKnownAs: [`at://${handle}`],
    services: {
      atproto_pds: {
        type: "AtprotoPersonalDataServer",
        endpoint: serviceEndpoint,
      },
    },
    prev: null,
  };
}

/**
 * Sign a PLC genesis operation with the rotation key.
 *
 * Steps:
 * 1. CBOR-encode the unsigned operation
 * 2. SHA-256 hash the CBOR bytes
 * 3. Sign the hash with the rotation private key (prehash disabled since we hash manually)
 * 4. Encode signature as base64url
 */
export function signGenesisOperation(
  operation: PlcGenesisOperation,
  rotationPrivKey: Uint8Array,
): SignedPlcOperation {
  const cborBytes = dagCbor.encode(operation);
  const hash = createHash("sha256").update(cborBytes).digest();

  // secp256k1 v3 sign() returns compact Bytes directly.
  // prehash: false because we already SHA-256 hashed the CBOR bytes.
  const sigBytes = secp256k1.sign(new Uint8Array(hash), rotationPrivKey, {
    prehash: false,
  });
  const sig = Buffer.from(sigBytes).toString("base64url");

  return { ...operation, sig };
}

/**
 * Compute the PLC DID from a signed genesis operation.
 *
 * DID = "did:plc:" + base32lower(sha256(cbor(signedOp))[:15])
 *
 * The first 15 bytes (120 bits) of the SHA-256 hash are base32-encoded
 * to produce a 24-character identifier.
 */
export function computeDidFromSignedOperation(
  signedOp: SignedPlcOperation,
): string {
  const cborBytes = dagCbor.encode(signedOp);
  const hash = createHash("sha256").update(cborBytes).digest();
  const truncated = hash.subarray(0, 15);
  const encoded = base32Encode(new Uint8Array(truncated));
  return `did:plc:${encoded}`;
}

/**
 * Submit a signed PLC operation to plc.directory.
 */
async function submitToPlcDirectory(
  did: string,
  signedOp: SignedPlcOperation,
  plcDirectoryUrl: string,
  logger: Logger,
): Promise<void> {
  const url = `${plcDirectoryUrl}/${did}`;

  logger.info({ did, plcDirectoryUrl }, "Submitting PLC genesis operation");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedOp),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error(
      { did, status: response.status, body },
      "PLC directory rejected genesis operation",
    );
    throw new Error(
      `PLC directory returned ${String(response.status)}: ${body}`,
    );
  }

  logger.info({ did }, "PLC DID registered successfully");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PLC DID service for generating and registering community DIDs.
 *
 * The service generates secp256k1 key pairs (signing + rotation),
 * constructs a PLC genesis operation, signs it, submits to plc.directory,
 * and returns the generated DID with private keys.
 *
 * @param logger - Pino logger instance
 * @returns PlcDidService with generateDid method
 */
export function createPlcDidService(logger: Logger): PlcDidService {
  async function generateDid(
    params: GenerateDidParams,
  ): Promise<GenerateDidResult> {
    const plcDirectoryUrl =
      params.plcDirectoryUrl ?? DEFAULT_PLC_DIRECTORY_URL;

    logger.info(
      { handle: params.handle, serviceEndpoint: params.serviceEndpoint },
      "Generating PLC DID for community",
    );

    // 1. Generate key pairs (v3: utils.randomSecretKey)
    const signingPrivKey = secp256k1.utils.randomSecretKey();
    const signingPubKey = secp256k1.getPublicKey(signingPrivKey, true);

    const rotationPrivKey = secp256k1.utils.randomSecretKey();
    const rotationPubKey = secp256k1.getPublicKey(rotationPrivKey, true);

    // 2. Encode public keys as did:key
    const signingDidKey = compressedPubKeyToDidKey(signingPubKey);
    const rotationDidKey = compressedPubKeyToDidKey(rotationPubKey);

    // 3. Build genesis operation
    const genesisOp = buildGenesisOperation(
      signingDidKey,
      rotationDidKey,
      params.handle,
      params.serviceEndpoint,
    );

    // 4. Sign with rotation key
    const signedOp = signGenesisOperation(genesisOp, rotationPrivKey);

    // 5. Compute DID
    const did = computeDidFromSignedOperation(signedOp);

    // 6. Submit to plc.directory
    await submitToPlcDirectory(did, signedOp, plcDirectoryUrl, logger);

    // 7. Return DID and hex-encoded private keys
    return {
      did,
      signingKey: Buffer.from(signingPrivKey).toString("hex"),
      rotationKey: Buffer.from(rotationPrivKey).toString("hex"),
    };
  }

  return { generateDid };
}
