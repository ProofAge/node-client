import { ProofAgeError } from './errors.js';
import { SDK_VERSION } from './version.js';

/** Header naming the SDK (and any wrapper around it) that sent a request. Not part of the HMAC. */
export const SDK_HEADER = 'X-ProofAge-Sdk';

const OWN_TOKEN_NAME = 'node';

/**
 * One `<name>/<version>` token: printable ASCII, no spaces, exactly one slash. The same
 * shape every ProofAge SDK sends, so the API can split the header on single spaces.
 */
const TOKEN_PATTERN = /^[\x21-\x2E\x30-\x7E]+\/[\x21-\x2E\x30-\x7E]+$/;

/**
 * `X-ProofAge-Sdk` value: the wrapper tokens, outermost first, then this SDK's own
 * `node/<version>`. A wrapper token named `node` is dropped, so the SDK's own token can
 * never be replaced, repeated or shifted out of last place.
 */
export function buildSdkHeader(wrapperTokens: readonly string[] = []): string {
  const tokens: string[] = [];
  for (const token of wrapperTokens) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      throw new ProofAgeError(
        `Invalid sdkTokens entry ${JSON.stringify(token)}: expected "<name>/<version>" ` +
          'in printable ASCII with no spaces, e.g. "shopify-app/1.4.0"',
        0,
      );
    }
    if (token.slice(0, token.indexOf('/')).toLowerCase() !== OWN_TOKEN_NAME) {
      tokens.push(token);
    }
  }
  tokens.push(`${OWN_TOKEN_NAME}/${SDK_VERSION}`);
  return tokens.join(' ');
}

/**
 * The User-Agent to send: the caller's, checked here so a value fetch would refuse (a line
 * break, a non-ASCII shop name) fails once when the client is created instead of on every
 * request after its retries; or the default when none was given.
 */
export function resolveUserAgent(userAgent: string | undefined): string {
  if (userAgent === undefined || userAgent.trim() === '') {
    return defaultUserAgent();
  }
  if (!/^[\x20-\x7E]+$/.test(userAgent)) {
    throw new ProofAgeError(
      `Invalid userAgent ${JSON.stringify(userAgent)}: use printable ASCII only, with no line breaks`,
      0,
    );
  }
  return userAgent;
}

/**
 * `ProofAge-Node/<version> (Node <runtime version>)`, or just `ProofAge-Node/<version>` where
 * there is no Node `process` to read the runtime from.
 */
export function defaultUserAgent(): string {
  const runtime =
    typeof process !== 'undefined' && process && typeof process.version === 'string'
      ? process.version.replace(/^v/, '')
      : undefined;
  return runtime ? `ProofAge-Node/${SDK_VERSION} (Node ${runtime})` : `ProofAge-Node/${SDK_VERSION}`;
}
