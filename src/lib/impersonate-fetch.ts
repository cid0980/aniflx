/**
 * Fetch via curl-impersonate for Cloudflare-protected domains.
 * Uses the actual curl-impersonate binary with Chrome 116 TLS fingerprint.
 */
import { execFileSync } from 'child_process';
import { join } from 'path';
import { existsSync, chmodSync } from 'fs';

const CF_DOMAINS = ['anidb.app', 'hls.anidb.app'];

function needsImpersonate(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return CF_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

function getBinaryPath(): string {
  const binPath = join(process.cwd(), 'node_modules', 'node-curl-impersonate', 'bin', 'curl-impersonate-chrome-linux-x86');
  if (!existsSync(binPath)) throw new Error(`curl-impersonate binary not found at ${binPath}`);
  chmodSync(binPath, 0o755);
  return binPath;
}

// Chrome 116 TLS flags from node-curl-impersonate presets
const CHROME_FLAGS = [
  '--ciphers', 'TLS_AES_128_GCM_SHA256,TLS_AES_256_GCM_SHA384,TLS_CHACHA20_POLY1305_SHA256,ECDHE-ECDSA-AES128-GCM-SHA256,ECDHE-RSA-AES128-GCM-SHA256,ECDHE-ECDSA-AES256-GCM-SHA384,ECDHE-RSA-AES256-GCM-SHA384,ECDHE-ECDSA-CHACHA20-POLY1305,ECDHE-RSA-CHACHA20-POLY1305,ECDHE-RSA-AES128-SHA,ECDHE-RSA-AES256-SHA,AES128-GCM-SHA256,AES256-GCM-SHA384,AES128-SHA,AES256-SHA',
  '--http2', '--http2-no-server-push', '--compressed',
  '--tlsv1.2', '--alps', '--tls-permute-extensions', '--cert-compression', 'brotli',
];

const CHROME_HEADERS = [
  '-H', 'sec-ch-ua: "Chromium";v="116", "Not A;Brand";v="99", "Google Chrome";v="116"',
  '-H', 'sec-ch-ua-mobile: ?0',
  '-H', 'sec-ch-ua-platform: Windows',
  '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
  '-H', 'Accept: */*',
  '-H', 'Sec-Fetch-Site: none',
  '-H', 'Sec-Fetch-Mode: navigate',
  '-H', 'Accept-Language: en-US,en;q=0.9',
];

/**
 * Fetch text content via curl-impersonate (for m3u8 playlists, HTML, JSON)
 */
export async function impersonateFetch(url: string): Promise<{ body: string; status: number }> {
  if (!needsImpersonate(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return { body: await res.text(), status: res.status };
  }

  const binPath = getBinaryPath();
  const result = execFileSync(binPath, [
    '-s', '--max-time', '20',
    ...CHROME_FLAGS,
    ...CHROME_HEADERS,
    url,
  ], { maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' });

  return { body: result, status: 200 };
}

/**
 * Fetch binary content via curl-impersonate (for .ts/.xls video segments, encryption keys)
 * Returns raw Buffer to avoid string encoding corruption.
 */
export async function impersonateFetchBinary(url: string): Promise<{ buffer: Buffer; status: number; contentType: string }> {
  const ct = url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' :
    (url.includes('.ts') || url.includes('.xls')) ? 'video/mp2t' :
    url.includes('.key') ? 'application/octet-stream' :
    'application/octet-stream';

  if (!needsImpersonate(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab), status: res.status, contentType: res.headers.get('content-type') || ct };
  }

  const binPath = getBinaryPath();
  // execFileSync with encoding: 'buffer' returns raw Buffer — no string corruption
  const result = execFileSync(binPath, [
    '-s', '--max-time', '30',
    ...CHROME_FLAGS,
    ...CHROME_HEADERS,
    url,
  ], { maxBuffer: 50 * 1024 * 1024 }) as Buffer;

  return { buffer: result, status: 200, contentType: ct };
}
