# Supabase pooler CA

Public trust anchor downloaded over verified HTTPS on 2026-11-17:
https://supabase-downloads.s3.ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Subject/issuer: Supabase Root 2021 CA, Supabase Inc. Self-signature verified.
Valid until: 2031-04-26 10:56:53 UTC.
SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

This is a public CA certificate, not a private key or a server certificate learned
from an untrusted connection. It is scoped to the configured Supabase pooler
connection, not installed into Node's global trust store.

`store.mjs` adds its absolute path as `sslrootcert` for `*.pooler.supabase.com`
when `sslmode=verify-full` and no explicit CA path is provided. The original
environment value, credentials and hostname are unchanged. node-postgres reads
the CA together with verify-full, leaving Node's certificate-chain and hostname
verification enabled. A separate ssl object would be overwritten by URL SSL
parameters, so those two configuration styles are deliberately not mixed.

Explicit `sslrootcert` values remain supported. Other PostgreSQL hosts keep their
existing trust configuration. Certificate rotation requires obtaining the new
official CA and repeating connection/hostname tests; never disable verification.

References:
- https://supabase.com/docs/guides/platform/ssl-enforcement
- https://node-postgres.com/features/ssl
