# Lancer toutes les suites de tests

Les deux dépôts sont des dossiers voisins : `spec-conformance-agentic/` (application + sidecar) et `vidimus-main/` (bibliothèque + vérificateur navigateur).
Tous les chemins ci-dessous partent du dossier parent qui contient les deux. Aucune suite n'appelle d'API payante.

## Préparation (une fois)
```bash
cd vidimus-main && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && cd ..
```
```bash
cd spec-conformance-agentic && npm ci && cd ..
```
Le sidecar réutilise l'environnement Python de `vidimus-main` (ses extras `dev` contiennent déjà fastapi, uvicorn et httpx). N'installez **pas** `vidimus-svc/requirements.txt` dans cet environnement : il épingle une version publique plus ancienne de `vidimus` et remplacerait votre version locale.
L'étage de test Docker, lui, utilise cette version publique épinglée (c'est voulu : c'est ce que l'image embarque).

## vidimus-main
| Suite | Commande (depuis `vidimus-main/`) | Résultat attendu |
|---|---|---|
| Tests Python (dont le vérificateur navigateur via Node) | `.venv/bin/python -m pytest -q -p no:cacheprovider` | `204 passed` |
| Lint | `.venv/bin/ruff check --no-cache src tests` | `All checks passed!` |
| Format | `.venv/bin/ruff format --no-cache --check src tests` | `40 files already formatted` |
| Vérificateur navigateur (Node, sans navigateur) | `node verifier/test.mjs` | `all verifier tests passed` (42 lignes `ok`) |

## spec-conformance-agentic
| Suite | Commande (depuis `spec-conformance-agentic/`) | Résultat attendu |
|---|---|---|
| Types TypeScript | `npx tsc --noEmit --incremental false` | aucune sortie, code 0 |
| Tests unitaires TypeScript (citations, fenêtre, garde de gap, ablation, texte de spec, mode démo…) | `npm run test:unit` | aucune ligne `❌` (121 `✅` avec les données locales) |
| Sidecar : attestation | `../vidimus-main/.venv/bin/python vidimus-svc/test_attest.py` | `OK  /attest -> 200 …` |
| Sidecar : calibration | `../vidimus-main/.venv/bin/python vidimus-svc/test_calibration.py` | 13 lignes `ok` |
| Sidecar : clés, /pubkey, rotation | `../vidimus-main/.venv/bin/python vidimus-svc/test_keys.py` | 10 lignes `ok` |
| Démo : trio valide / altérée / mauvaise clé | `../vidimus-main/.venv/bin/python vidimus-svc/test_verdict_files.py` | 5 lignes `ok` |
| Script de résolution de la version de vidimus (CI) | `bash .github/scripts/test-resolve-vidimus-ref.sh` | 4 lignes `ok` |
| Image du sidecar, étage de test (sans cache ; reconstruit et relance les 3 suites Python du sidecar dans l'image) | `docker build -f vidimus-svc/Dockerfile --target test --no-cache -t vidimus-svc:test .` | build réussi, 24 lignes `ok` dans la sortie |

Notes
- Le sous-ensemble « données locales » de `npm run test:unit` (vérifications sur le vrai extrait de la spécification et les résultats bruts) est **ignoré proprement** si ces fichiers non redistribuables sont absents.
- Le contrôle du texte de spécification (`scripts/check-no-spec-text.ts`) a besoin de l'extrait local et n'est pas dans ces suites : voir `DEMO.md`, section « Avant de publier ».
- `mypy src/vidimus` (lancé par la CI de `vidimus-main`) signale 3 erreurs connues dans `src/vidimus/audit/judges.py` (typage du SDK Anthropic installé) ; elles ne sont pas liées à ce travail.
