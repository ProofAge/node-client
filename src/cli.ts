import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProofAgeClient } from './client.js';
import { ProofAgeError } from './errors.js';

function loadEnvFile(filePath: string): void {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function loadDotenvFiles(): void {
  const cwd = process.cwd();
  loadEnvFile(resolve(cwd, '.env.local'));
  loadEnvFile(resolve(cwd, '.env'));
}

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';

const ok = (msg: string) => console.log(`${GREEN}✔${RESET} ${msg}`);
const fail = (msg: string) => console.log(`${RED}✘${RESET} ${msg}`);
const warn = (msg: string) => console.log(`${YELLOW}⚠${RESET} ${msg}`);
const hint = (msg: string) => console.log(`  ${DIM}${msg}${RESET}`);

function resolveEnv(flag: string | undefined, envName: string): string | undefined {
  return flag || process.env[envName] || undefined;
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, ...rest] = arg.slice(2).split('=');
      result[key] = rest.join('=');
    } else if (arg.startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      result[arg.slice(2)] = argv[++i];
    }
  }
  return result;
}

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.test') ||
      hostname.endsWith('.local');
  } catch {
    return false;
  }
}

async function verifySetup(args: Record<string, string>): Promise<boolean> {
  console.log();
  console.log(`ProofAge Node SDK — verify-setup`);
  console.log();

  const apiKey = resolveEnv(args['api-key'], 'PROOFAGE_API_KEY');
  const secretKey = resolveEnv(args['secret-key'], 'PROOFAGE_SECRET_KEY');
  const baseUrl = resolveEnv(args['base-url'], 'PROOFAGE_BASE_URL');

  const insecure = args['insecure'] !== undefined || (baseUrl != null && isLocalUrl(baseUrl));
  if (insecure && !process.env['NODE_TLS_REJECT_UNAUTHORIZED']) {
    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
  }

  let hasError = false;

  if (!apiKey) {
    fail('PROOFAGE_API_KEY is not set');
    hint('Set via environment variable or --api-key flag');
    hasError = true;
  }
  if (!secretKey) {
    fail('PROOFAGE_SECRET_KEY is not set');
    hint('Set via environment variable or --secret-key flag');
    hasError = true;
  }

  if (hasError) {
    console.log();
    return false;
  }

  ok('Configuration present');
  if (baseUrl) {
    hint(`Base URL: ${baseUrl}${insecure ? ' (TLS verification skipped)' : ''}`);
  }

  let client: ProofAgeClient;
  try {
    client = new ProofAgeClient({
      apiKey: apiKey!,
      secretKey: secretKey!,
      baseUrl,
      retryAttempts: 1,
      timeout: 15_000,
    });
  } catch (e) {
    fail(`Failed to create client: ${e instanceof Error ? e.message : String(e)}`);
    console.log();
    return false;
  }

  let workspaceData: Record<string, unknown> | null = null;
  try {
    workspaceData = await client.workspace().get();

    if (!workspaceData) {
      fail('Workspace API returned empty response');
      console.log();
      return false;
    }

    ok('Workspace connection successful');

    const name = workspaceData.name as string | undefined;
    if (name) {
      hint(`Workspace: ${name}`);
    }
  } catch (e) {
    if (e instanceof ProofAgeError) {
      fail(`Workspace API error (HTTP ${e.statusCode}): ${e.message}`);
    } else {
      fail(`Workspace API error: ${e instanceof Error ? e.message : String(e)}`);
    }
    hint('Check that your API key and secret key are correct');
    console.log();
    return false;
  }

  const webhookUrl = workspaceData.webhook_url as string | undefined;
  if (webhookUrl) {
    ok(`Webhook URL configured: ${webhookUrl}`);
  } else {
    warn('Webhook URL is not configured');
    hint('You can set webhook_url in your ProofAge workspace settings');
  }

  console.log();
  if (webhookUrl) {
    ok('ProofAge setup verified successfully!');
  } else {
    warn('ProofAge setup partially verified (webhooks not configured)');
  }
  console.log();
  return true;
}

function printUsage(): void {
  console.log(`
Usage: proofage <command> [options]

Commands:
  verify-setup    Check configuration and test workspace connection

Options:
  --api-key       ProofAge API key (or set PROOFAGE_API_KEY env var)
  --secret-key    ProofAge secret key (or set PROOFAGE_SECRET_KEY env var)
  --base-url      ProofAge API base URL (or set PROOFAGE_BASE_URL env var)
  --insecure      Skip TLS certificate verification (auto-enabled for .test/.local)
  --help          Show this help message
`);
}

async function main(): Promise<void> {
  loadDotenvFiles();

  const args = process.argv.slice(2);
  const command = args.find((a) => !a.startsWith('--'));
  const flags = parseArgs(args);

  if (flags['help'] !== undefined || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (!command || command === 'verify-setup') {
    const success = await verifySetup(flags);
    process.exit(success ? 0 : 1);
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
