/**
 * Custom HTTP headers for one server profile (#160).
 *
 * Somebody can put a reverse proxy in front of their server that refuses every
 * request without a shared secret header. The headers belong to the profile,
 * so they are kept in it (`SubsonicAuth.headers`), are used by the login
 * request itself, and then by every request the app makes to that server.
 *
 * The editing surface is a small text area, one `Name: value` per line.
 * Parsing lives here rather than in the two screens that use it, so the login
 * form and Settings accept exactly the same thing and a mistake is reported
 * instead of quietly leaving a header out.
 */

export type CustomHeaders = Record<string, string>;

/** RFC 9110 `token`: what a header name may contain. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** A header value is one line: the transports reject CR/LF. */
const HEADER_VALUE = /^[^\r\n]*$/;

/** A carrier of the profile's headers, kept structural for tests and imports. */
export interface HeaderCarrier {
  headers?: CustomHeaders;
}

/**
 * Reads the text area. Blank lines and lines starting with `#` are ignored
 * (so a header set can carry a note about itself). A bad line is reported
 * with its line number and left out; the rest still apply, which is what lets
 * the form point at the one thing that needs fixing.
 */
export function parseHeaderLines(text: string): {
  headers: CustomHeaders;
  errors: string[];
} {
  const headers: CustomHeaders = {};
  const errors: string[] = [];
  const seen = new Map<string, string>();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const lineNo = index + 1;
    const colon = line.indexOf(':');
    if (colon <= 0) {
      errors.push(`Line ${lineNo}: expected "Name: value".`);
      return;
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!HEADER_NAME.test(name)) {
      errors.push(`Line ${lineNo}: "${name}" is not a valid header name.`);
      return;
    }
    if (!value) {
      errors.push(`Line ${lineNo}: "${name}" has no value.`);
      return;
    }
    if (!HEADER_VALUE.test(value)) {
      errors.push(`Line ${lineNo}: "${name}" has a value that is not one line.`);
      return;
    }
    const lower = name.toLowerCase();
    const previous = seen.get(lower);
    if (previous) {
      errors.push(`Line ${lineNo}: "${previous}" is listed more than once.`);
      return;
    }
    seen.set(lower, name);
    headers[name] = value;
  });

  return { headers, errors };
}

/** The text area's contents for a saved set; '' when there is none. */
export function formatHeaderLines(headers?: CustomHeaders): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

/**
 * The request's headers: the app's own first, then the profile's custom ones.
 *
 * The app's own win on a name they both use (compared case-insensitively, as
 * HTTP does), so a custom header can never replace the authentication or the
 * content type the request depends on. `undefined` built-ins are left out.
 */
export function mergeHeaders(
  base: Record<string, string | undefined>,
  custom?: CustomHeaders,
): Record<string, string> {
  const merged: Record<string, string> = { ...(custom ?? {}) };
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    for (const existing of Object.keys(merged)) {
      if (existing.toLowerCase() === lower) delete merged[existing];
    }
    merged[name] = value;
  }
  return merged;
}

/** The profile's custom headers, ready for a `fetch`/`Image`/player source. */
export function serverHeaders(profile: HeaderCarrier | null | undefined): CustomHeaders {
  return profile?.headers ?? {};
}
