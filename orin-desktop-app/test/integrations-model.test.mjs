import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fromConnector,
  fromMcp,
  integrationId,
  isAcceptableMcpUrl,
  splitByKind,
  unify,
  validateMcpInput,
} from '../ui/src/features/settings/integrationsModel.ts'

const connectors = [
  { id: 'github', label: 'GitHub', baseUrl: 'https://api.github.com', hasCred: true },
  { id: 'slack', label: 'Slack', baseUrl: 'https://slack.com/api', hasCred: false },
  { id: 'notion', label: 'Notion', baseUrl: 'https://api.notion.com/v1', hasCred: false },
]

const servers = [
  { id: 'a1', name: 'Filesystem', url: 'https://mcp.example.com/sse', hasKey: true },
  { id: 'b2', name: 'Local tools', url: 'http://127.0.0.1:3000/sse', hasKey: false },
]

test('connectors and MCP servers become one list, connectors first', () => {
  const all = unify(connectors, servers)
  assert.equal(all.length, 5)
  assert.deepEqual(all.map((i) => i.kind), ['connector', 'connector', 'connector', 'mcp', 'mcp'])
  assert.deepEqual(all.slice(0, 3).map((i) => i.name), ['GitHub', 'Notion', 'Slack'])
  assert.deepEqual(all.slice(3).map((i) => i.name), ['Filesystem', 'Local tools'])
})

test('ids are namespaced, so a connector and a server can share a name', () => {
  const same = [{ id: 'x', name: 'GitHub', url: 'https://other.example', hasKey: true }]
  const all = unify([{ id: 'github', label: 'GitHub', baseUrl: 'https://api.github.com', hasCred: true }], same)
  assert.equal(new Set(all.map((i) => i.id)).size, 2, 'ids must not collide')
  assert.notEqual(integrationId('connector', 'github'), integrationId('mcp', 'github'))
})

test('only MCP servers are removable', () => {
  const { connectors: cs, mcp } = splitByKind(unify(connectors, servers))
  assert.ok(cs.every((c) => !c.removable), 'built-in connectors cannot be removed')
  assert.ok(mcp.every((m) => m.removable))
})

test('credential state is carried through for both kinds', () => {
  const all = unify(connectors, servers)
  const github = all.find((i) => i.name === 'GitHub')
  const slack = all.find((i) => i.name === 'Slack')
  const local = all.find((i) => i.name === 'Local tools')
  assert.equal(github.hasCredential, true)
  assert.equal(slack.hasCredential, false)
  assert.equal(local.hasCredential, false)
  // The MCP hint must make the injection guarantee explicit; it is the whole
  // reason to prefer an MCP server over pasting a token into a connector.
  assert.match(fromMcp(servers[0]).credentialHint, /never sees them/i)
})

test('both shapes map without losing their detail', () => {
  assert.deepEqual(fromConnector(connectors[0]), {
    id: 'connector:github',
    kind: 'connector',
    name: 'GitHub',
    detail: 'https://api.github.com',
    hasCredential: true,
    removable: false,
    credentialHint: 'A token Orin uses for this service. Stored in the OS keyring.',
  })
  assert.equal(fromMcp(servers[1]).detail, 'http://127.0.0.1:3000/sse')
})

test('an MCP endpoint must be https, or http on loopback', () => {
  for (const good of [
    'https://mcp.example.com/sse',
    'http://localhost:3000',
    'http://127.0.0.1:3000/sse',
    'http://[::1]:3000',
  ]) {
    assert.equal(isAcceptableMcpUrl(good), true, good)
  }
  for (const bad of [
    'http://mcp.example.com',       // plaintext to the internet
    'ftp://mcp.example.com',
    'file:///etc/passwd',
    'https://user:pw@mcp.example.com', // credentials in the URL
    '',
    '   ',
    'not a url',
  ]) {
    assert.equal(isAcceptableMcpUrl(bad), false, String(bad))
  }
})

test('adding a server needs a name and an acceptable URL', () => {
  assert.deepEqual(validateMcpInput('Files', 'https://x.example'), { ok: true })
  assert.equal(validateMcpInput('', 'https://x.example').ok, false)
  assert.equal(validateMcpInput('  ', 'https://x.example').ok, false)
  assert.equal(validateMcpInput('x'.repeat(80), 'https://x.example').ok, false)
  assert.equal(validateMcpInput('Files', 'http://mcp.example.com').ok, false)
  assert.match(validateMcpInput('Files', 'http://mcp.example.com').message, /https/)
})

test('an empty or malformed state does not throw', () => {
  assert.deepEqual(unify([], []), [])
  assert.deepEqual(splitByKind([]), { connectors: [], mcp: [] })
  assert.equal(isAcceptableMcpUrl(null), false)
  assert.equal(isAcceptableMcpUrl(undefined), false)
})
