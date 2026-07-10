// Centralized env var access. Loads .env once; each caller pulls only the
// variables it actually needs (via requireEnv/optionalEnv) so that, e.g.,
// running the detection engine's tests never fails because a self-play-only
// variable is unset.

import "dotenv/config";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export function requireEnvBigInt(name: string): bigint {
  const raw = requireEnv(name);
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
}

export function requireEnvInt(name: string): number {
  const raw = requireEnv(name);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  return n;
}
