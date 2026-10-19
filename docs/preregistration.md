# Pre-registration of the gap-guard evaluation — integrity record

The pre-registration of the `GAP_GUARD=verifier` evaluation is the file [`eval/PREREGISTRATION-gap-guard.md`](../eval/PREREGISTRATION-gap-guard.md),
committed on **2026-10-06T19:37:18+08:00** in commit **`ad3175f1ffef683855172fdde73093373483004e`** (`ad3175f1`), before the first paid call of that evaluation.
This page records its SHA-256 and a signature over that hash, so the record survives a rewrite of the git history (which would change every commit hash after the first rewritten commit).

| | |
|---|---|
| document | `eval/PREREGISTRATION-gap-guard.md` |
| SHA-256 of the file at commit `ad3175f1` | `77f9a071e27392141955d3e9fde4d9b4001f2a8f6d2bf15036a0d8535af98014` |
| origin commit | `ad3175f1ffef683855172fdde73093373483004e` |
| origin commit date | `2026-10-06T19:37:18+08:00` |
| signed at (UTC, asserted by the signer) | `2026-10-06T12:46:38Z` |
| signing key id (SHA-256 of the public key) | `85ac30de1f1542c45a778351c32f7cf1fee7346d534a0c9059e5bbfe51cd84be` |
| public key (Ed25519, hex) | `090e93534a2f1002b84beac8990905761965abd16b208858de09c546154fa612` |
| signature (Ed25519, hex) | `8aa8e6f058566418fc597d3b96021a6d32083e2ec6b8ad4cef269a0866537d0764283aaf3b0b7dda203be520932a4a1e48586d2c0c242d4a24ab7aefe5405a0f` |

The file in the working tree at signing time has the same hash as the file at the origin commit (checked with `git show ad3175f1:eval/PREREGISTRATION-gap-guard.md | shasum -a 256`).

## What was signed
The Ed25519 signature is over the **RFC 8785-style canonical JSON** (`vidimus.audit.canonical.canonicalize`, 429 bytes) of this object:

```json
{
  "type": "vidimus.document-attestation.v1",
  "document": "eval/PREREGISTRATION-gap-guard.md",
  "sha256": "77f9a071e27392141955d3e9fde4d9b4001f2a8f6d2bf15036a0d8535af98014",
  "origin_commit": "ad3175f1ffef683855172fdde73093373483004e",
  "origin_commit_date": "2026-10-06T19:37:18+08:00",
  "signed_at": "2026-10-06T12:46:38Z",
  "statement": "The signer vouches that the document with this SHA-256 is the pre-registration committed at origin_commit."
}
```

Signed with the sidecar's signing key by the existing code (`main.get_signing_key` + `vidimus.audit.signing.sign_hex`) inside the running container; the key was never printed or copied out.
The public key is the one served by the sidecar at `GET /pubkey`.

## Verify
Needs the `vidimus` Python package. Save the object above as `payload.json`, then:

```bash
python -c "import json; from vidimus.audit.canonical import canonicalize; from vidimus.audit.keys import public_key_from_hex; from vidimus.audit.signing import verify_hex; p=json.load(open('payload.json')); print(verify_hex(public_key_from_hex('090e93534a2f1002b84beac8990905761965abd16b208858de09c546154fa612'), '8aa8e6f058566418fc597d3b96021a6d32083e2ec6b8ad4cef269a0866537d0764283aaf3b0b7dda203be520932a4a1e48586d2c0c242d4a24ab7aefe5405a0f', canonicalize(p)))"
```

and check that the `sha256` in the object is the SHA-256 of the pre-registration file (`shasum -a 256 eval/PREREGISTRATION-gap-guard.md`).

## What this does and does not prove
- It proves that the document with this hash existed in this exact form when the key holder signed it, and that it is the file committed at `ad3175f1`.
- It does **not** by itself prove that the document was written *before* the evaluation runs: `signed_at` is asserted by the signer and the signature was made after the runs. The timestamp evidence is the git commit date and parent chain of
  `ad3175f1` (and the results files being generated afterwards), plus any copy of the repository taken before a history rewrite (a `git bundle` of the repository is kept for that purpose).
- The signing key is the sidecar's **local development key**, generated on first start of the compose stack. It is **not** listed in `vidimus-svc/trusted-keys.json`, so a verifier pinned to that file would reject it.
  For a record that outlives this machine, re-sign with the production key (after it is registered in `trusted-keys.json`) and keep this page as a second witness.

## Full hash of the pre-registration file
The complete SHA-256 of `eval/PREREGISTRATION-gap-guard.md` (identical at commit `ad3175f1` and in the working tree when it was signed):

```
77f9a071e27392141955d3e9fde4d9b4001f2a8f6d2bf15036a0d8535af98014
```

Recompute it with `git show ad3175f1ffef683855172fdde73093373483004e:eval/PREREGISTRATION-gap-guard.md | shasum -a 256`.

## Horodatage indépendant (independent timestamp)
The signature above is **not** an independent timestamp:
- it was made with the sidecar's **local development key**, which is **absent from `vidimus-svc/trusted-keys.json`**, so nobody can pin it as a trusted issuer;
- `signed_at` is a value written by the signer itself and the signature was produced after the evaluation runs.

What would make the date verifiable by a third party is to **publish the hash above somewhere outside this repository and this machine** (for example in a public issue or release note of an unrelated account, a signed email, or a public timestamping service), so that its publication date
is attested by someone else. **This has not been done yet**; the hash is to be published elsewhere, and this page should then be updated with the place and date of publication.

OpenTimestamps (Bitcoin-anchored proof) would be one way: `ots stamp eval/PREREGISTRATION-gap-guard.md` produces `eval/PREREGISTRATION-gap-guard.md.ots`, and `ots verify` checks it later. **No `.ots` file exists**: the OpenTimestamps client is **not installed** on the machine
that produced this record (checked: no `ots` command, no `opentimestamps-client` Python package), and nothing was installed for this purpose.

## Second attestation, signed with the production key (2026-10-19)

After the history rewrite (`EVAL.md`, "History rewrite") the pre-registration commit has a new SHA, and a production signing key now exists and is listed in `vidimus-svc/trusted-keys.json`. The same file was therefore attested again with that key:

| | |
|---|---|
| attestation | [`docs/preregistration.attestation-prod.json`](preregistration.attestation-prod.json) (type `vidimus.document-attestation.v1`, same payload fields as above) |
| document / SHA-256 | `eval/PREREGISTRATION-gap-guard.md` / `77f9a071e27392141955d3e9fde4d9b4001f2a8f6d2bf15036a0d8535af98014` (unchanged) |
| origin commit (rewritten history) | `9571ff7e5366904799b935afd39819a45c1bf59e`, tag `prereg-v2` (the original SHA `ad3175f1` exists only in the private bundle) |
| signing key id | `81360f61aefb0a9a681b43a53b8fe44a198e6571d06fd6d0419d83a4fe0e7472`, listed in `trusted-keys.json` since 2026-10-19 |
| signed at | 2026-10-19T04:45:46Z |

Verify (needs the `vidimus` package; checks signature, the document hash and that the key is listed and was valid at `signed_at`):

```bash
python vidimus-svc/sign_document.py eval/PREREGISTRATION-gap-guard.md \
  --verify docs/preregistration.attestation-prod.json --trusted vidimus-svc/trusted-keys.json
```

`test_sign_document.py` runs this check in CI. What it still does **not** prove: `signed_at` is asserted by the signer and the evaluation ran before it; the date of the pre-registration rests on the git history of the tag and on the private bundle. The independent timestamp section above is still open. The first attestation (development key, not listed) is kept as a second witness.
