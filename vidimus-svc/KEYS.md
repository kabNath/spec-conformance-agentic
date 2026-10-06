# Sidecar signing key

| Setting | Meaning |
|---|---|
| `VIDIMUS_KEYS_DIR` (default `/data/vidimus-keys`) | directory with `<fingerprint>.priv.pem`; mount a **persistent volume** here |
| `VIDIMUS_SIGNING_KEY_PEM` | the key itself (unencrypted Ed25519 PKCS#8 PEM, real or `\n`-escaped newlines) for platforms without volumes. Wins over the directory. Never logged; store it in a secrets manager |
| `VIDIMUS_ALLOW_EPHEMERAL=1` | **local development only**: generate a key on first start. Without a key and without this flag the service **refuses to start** |
| `VIDIMUS_TRUSTED_KEYS` | path of `trusted-keys.json` (default: next to `main.py`) |

`GET /pubkey` → `{key_id, public_key, algorithm}`. Every `/attest` response carries `key_id` and `issued_at`, both inside the signed payload.

**Rotation** (`trusted-keys.json`): set `valid_until` on the old entry, append the new key with `valid_until: null` and
`valid_from`. Never delete a retired key. `trust.verify_attestation` accepts a retired key only for attestations issued inside its
window and refuses unknown keys. `issued_at` is asserted by the signer, so a leaked old key could backdate: revoke by
ending its window before the abuse and republishing the file.

Tests: `python vidimus-svc/test_keys.py`; docker-level: `bash vidimus-svc/test_restart.sh`.
