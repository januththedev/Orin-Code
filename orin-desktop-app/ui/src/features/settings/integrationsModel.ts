/**
 * One model for everything Orin can reach on the user's behalf.
 *
 * There are two kinds, and they were previously two separate screens with two
 * separate lifecycles:
 *
 *   connector — a built-in service (GitHub, Slack, Notion). Fixed list, has a
 *               credential slot, cannot be removed.
 *   mcp      — an MCP server the user added. Any list, same credential shape,
 *               can be removed.
 *
 * They are the same thing to a person: "something Orin can call, that I gave a
 * secret to, that I can test." Unifying them means one list, one credential
 * flow, one test button, and one place where "what can Orin reach with my
 * account?" is answered.
 */

export type IntegrationKind = 'connector' | 'mcp'

export interface Integration {
  /** Namespaced, so a connector and an MCP server can share a name safely. */
  id: string
  kind: IntegrationKind
  name: string
  /** Where it lives, shown under the name. */
  detail: string
  hasCredential: boolean
  /** Only MCP servers can be added or removed. */
  removable: boolean
  credentialHint: string
}

export interface ConnectorView {
  id: string
  label: string
  baseUrl: string
  hasCred: boolean
}

export interface McpView {
  id: string
  name: string
  url: string
  hasKey: boolean
}

export function integrationId(kind: IntegrationKind, rawId: string): string {
  return `${kind}:${rawId}`
}

export function fromConnector(c: ConnectorView): Integration {
  return {
    id: integrationId('connector', c.id),
    kind: 'connector',
    name: c.label,
    detail: c.baseUrl,
    hasCredential: c.hasCred,
    removable: false,
    credentialHint: 'A token Orin uses for this service. Stored in the OS keyring.',
  }
}

export function fromMcp(m: McpView): Integration {
  return {
    id: integrationId('mcp', m.id),
    kind: 'mcp',
    name: m.name,
    detail: m.url,
    hasCredential: m.hasKey,
    removable: true,
    credentialHint: 'Keys are injected server-side; the model never sees them.',
  }
}

/** Connectors first, then MCP servers, each alphabetical. */
export function unify(connectors: readonly ConnectorView[], servers: readonly McpView[]): Integration[] {
  const a = connectors.map(fromConnector).sort((x, y) => x.name.localeCompare(y.name))
  const b = servers.map(fromMcp).sort((x, y) => x.name.localeCompare(y.name))
  return [...a, ...b]
}

export function splitByKind(all: readonly Integration[]): { connectors: Integration[]; mcp: Integration[] } {
  return {
    connectors: all.filter((i) => i.kind === 'connector'),
    mcp: all.filter((i) => i.kind === 'mcp'),
  }
}

/**
 * Is this an acceptable MCP endpoint?
 *
 * Same rule the server applies, checked here too so the UI can refuse before
 * the user waits on a round trip. Loopback is allowed because a local MCP server
 * is a legitimate thing to run; anything else must be https.
 */
export function isAcceptableMcpUrl(raw: string): boolean {
  const value = String(raw ?? '').trim()
  if (!value) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
}

export function validateMcpInput(name: string, url: string): { ok: true } | { ok: false; message: string } {
  const cleanName = String(name ?? '').trim()
  if (!cleanName) return { ok: false, message: 'Give the server a name.' }
  if (cleanName.length > 60) return { ok: false, message: 'That name is too long.' }
  if (!isAcceptableMcpUrl(url)) {
    return { ok: false, message: 'Use an https:// address, or http:// on localhost.' }
  }
  return { ok: true }
}
