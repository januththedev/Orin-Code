# Archived: 2026-08-23 Orin Cloud integration design

This design described the retired Firebase/Clerk account family. It is kept
only as a historical marker and must not be used as a current contract.

The authoritative desktop account and device-flow contract is
[`docs/BACKEND-CONTRACT.md`](../../BACKEND-CONTRACT.md). The implementation
uses Orin Core, PKCE S256, short-lived access credentials, rotated refresh
credentials in the OS keyring, and no hardcoded provider keys.
