# Orin Core contract for the Orin Code desktop

The desktop uses the canonical Core service at `https://orinai.org`. A staging
override is accepted only through `ORIN_API_BASE`, must use HTTPS, and may use
HTTP only for explicit `localhost` or `127.0.0.1` development.

Credentials are created and rotated by Core. The desktop stores refresh
credentials in the OS credential manager; access credentials remain in Rust
memory. The renderer receives only the non-secret `Session` profile.

## Account endpoints

### `POST /api/auth/password`

Email/phone password compatibility flow.

Login body:

```json
{ "action": "login", "identifier": "user@example.com", "password": "…" }
```

Register body:

```json
{
  "action": "register",
  "name": "User",
  "email": "user@example.com",
  "phone": "+94770000000",
  "password": "at-least-8-characters"
}
```

The desktop sends `X-Orin-Legacy-Token: 1` and expects:

```json
{
  "sessionToken": "opaque-or-jwt-session-token",
  "user": { "id": "…", "name": "…", "email": "…", "phone": "…" }
}
```

Without that compatibility header, Core deliberately removes `sessionToken`
and establishes an HTTP-only browser BFF cookie instead. The desktop never
uses Firebase or Clerk token endpoints.

### `POST /api/auth/device`

All device actions use the same endpoint.

Start request:

```json
{
  "action": "start",
  "client_id": "orin-code-desktop",
  "code_challenge": "<43-char-base64url-S256>",
  "code_challenge_method": "S256",
  "scopes": ["chat:use", "account:read", "tools:use", "code:use"]
}
```

Start response:

```json
{
  "device_code": "<base64url-device-code>",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://orinai.org/#device-auth",
  "expires_in": 480,
  "interval": 5
}
```

Token poll request:

```json
{
  "action": "token",
  "client_id": "orin-code-desktop",
  "device_code": "…",
  "code_verifier": "<matching-PKCE-verifier>"
}
```

Token response is one of:

```json
{ "status": "pending" }
```

```json
{
  "status": "approved",
  "access_token": "…",
  "refresh_token": "…",
  "token_type": "Bearer",
  "expires_in": 900,
  "scope": "chat:use account:read tools:use code:use"
}
```

```json
{ "status": "denied" }
```

```json
{ "status": "expired" }
```

Refresh uses the same endpoint with
`{ "action": "refresh", "refresh_token": "…" }`. Core rotates the refresh
token on every successful refresh and revokes the previous token. The desktop
replaces the keyring value only after receiving the new pair.

### `GET` or `POST /api/auth/session/introspect`

Requires `Authorization: Bearer <access-or-session-token>` and returns the
minimal identity used by the desktop:

```json
{ "uid": "…", "email": "…", "kind": "session" }
```

## Remote task status

`POST /api/pc-link` remains disabled with HTTP 410 until Core has a real Orin
Agent approval-grant service. The desktop contains no renderer-controlled
auto-approval path. If remote control is enabled later, every mutating and
computer-control action must still carry a live, task-bound approval decision.

## Operational requirements

- Reject non-HTTPS Core origins outside explicit loopback development.
- Never accept credentials, query strings, or fragments in `ORIN_API_BASE`.
- Never log bearer or refresh tokens.
- Rotate device refresh tokens atomically and detect reuse.
- Keep device access credentials at 15 minutes or less.
- Return `Cache-Control: no-store` for account and remote-task responses.
