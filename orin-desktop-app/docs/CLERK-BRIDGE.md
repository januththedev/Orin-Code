# Historical Clerk bridge (retired)

The desktop no longer accepts Clerk session payloads and no longer calls
Google/Firebase Identity Toolkit. Those paths were removed when Orin Core
became the account authority.

Use [BACKEND-CONTRACT.md](./BACKEND-CONTRACT.md) for the current contract:

- password compatibility through Core `/api/auth/password`;
- PKCE device authentication through Core `/api/auth/device`;
- 15-minute access credentials;
- rotated 30-day device refresh credentials stored in the OS credential
  manager;
- session identity through Core `/api/auth/session/introspect`.

This file remains only to prevent old integration notes from being reused.
Do not implement or restore the retired Clerk/Firebase token families.
