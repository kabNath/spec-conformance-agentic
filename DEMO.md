# Démo en 5 minutes — Spec Conformance Agent + Vidimus

Tout ce qui suit tourne **en local**. Le texte utilisé est **entièrement inventé** (un protocole fictif « LCP » et un terminal fictif « Acme »).
Les chemins sont donnés depuis le dossier qui contient `spec-conformance-agentic/` et `vidimus-main/`.

## 1. Pré-requis (à faire une fois, ~10 min)
| Quoi | Vérification |
|---|---|
| Docker Desktop **démarré** | `docker info` répond sans erreur |
| Node 20+ et `npm ci` fait dans `spec-conformance-agentic/` | `node --version` |
| Python 3.10+ et l'environnement de `vidimus-main` (voir `docs/RUN_TESTS.md`, « Préparation ») | `vidimus-main/.venv/bin/vidimus version` |
| Fichier `spec-conformance-agentic/.env.local` avec **votre** clé OpenRouter, l'accès Neo4j, etc. (modèle : `.env.example`). Il n'est jamais commité ; ne le montrez pas à l'écran | l'application démarre |
| Une analyse coûte environ **0,1 $** de crédit OpenRouter (11 exigences ; estimation, non mesurée appel par appel) | — |

## 2. Commandes, dans l'ordre
```bash
cd spec-conformance-agentic
```
```bash
docker compose up -d --build
```
Doit afficher `Started`/`Running` pour postgres, qdrant, neo4j, vidimus. Vérification (4 lignes, à montrer si on vous le demande) :
```bash
curl -s localhost:4319/health && curl -s localhost:4319/pubkey && curl -s localhost:6334/healthz && docker exec spec-conformance-agentic-postgres-1 pg_isready
```
Attendu : `{"ok":true}`, une ligne JSON avec `key_id` et `public_key`, `healthz check passed`, `accepting connections`.

**Une seule fois** — charger l'extrait inventé dans Neo4j + Qdrant (déjà fait sur cette machine ; recommencer est sans danger ; coût < 0,001 $) :
```bash
npm run ingest -- org_demo_local lcpdemo "LCP Demo" 1.0 demo examples/ts38331-extrait.txt
```
Attendu : `Ingested 4 clauses into Neo4j + Qdrant for LCP Demo 1.0.`

Lancer l'application **en mode démonstration** (voir § 6 : pas de compte Clerk nécessaire) :
```bash
npm run dev:demo
```
Ouvrir **http://localhost:3000** (pas `127.0.0.1`). Attendu : la page d'accueil ; après « Dashboard » une bannière jaune « DEMO MODE — authentication is disabled ».

## 3. L'analyse (≈ 2 minutes)
1. Menu **New check** (`/runs/new`).
2. Nom : `Demo — Acme terminal vs LCP`, release : `demo`.
3. **Standard** : choisir `examples/ts38331-extrait.txt`, spec = `LCP Demo`, version = `1.0`. (Le nom du fichier est historique ; son contenu est inventé.)
4. **Implémentation** : choisir `demo/implementation-lcp.txt`.
5. Lancer. L'écran reste en attente environ 2 minutes (l'analyse est synchrone).

**À l'écran à la fin** (la matrice de conformité) : 11 exigences ; **6 « conformant »**, **1 « gap »**, **4 « needs review »**. Dans l'une des lignes de chaque famille :
- *conformant* — « …the terminal shall apply the default channel parameters » : clause 5.3.3, confiance 94 %, vérificateur d'accord ;
- *gap* — « …apply the parameters of a SessionUpdate message in an arbitrary order » : clause 5.3.5, contredit « in the order received » ;
- *needs review* — dont « …light a green LED… » (aucune clause pertinente : c'est le cas **insuffisant**) ; les autres sont des cas où le garde a refusé de s'engager (voir les raisons dans le détail).
Cliquez une ligne : la citation de la clause, le verdict, la note du vérificateur et la confiance s'affichent. « Export .xlsx » exporte la matrice.

## 4. L'attestation signée (≈ 1 minute)
Récupérer l'identifiant de l'analyse dans l'URL (`/runs/<runId>`), puis :
```bash
../vidimus-main/.venv/bin/python scripts/export-demo-attestations.py <runId>
```
Attendu : `exported verdict=gap calibrated=True key_id=…` et trois fichiers dans `demo/` : `attestation-valid.json`, `attestation-tampered.json` (un seul caractère de l'exigence modifié), `attestation-wrong-key.json` (même verdict signé par **une autre clé de test**, parfaitement cohérent).
Le script est le seul moyen d'exporter l'attestation : l'application n'a pas encore de bouton pour cela.

### Vérification dans le navigateur (aucun serveur d'attestation, tout se passe dans la page)
```bash
cd ../vidimus-main/verifier && python3 -m http.server 8765
```
Ouvrir **http://localhost:8765/index.html**. Coller le contenu d'un fichier de `demo/` dans la zone 1. Dans la zone 2, coller l'empreinte du signataire (`key_id` affiché par `curl -s localhost:4319/pubkey`). Cliquer **Verify**.
| Fichier | Résultat attendu |
|---|---|
| `attestation-valid.json` | bandeau **vert** « Integrity and signer verified » |
| `attestation-tampered.json` | bandeau **rouge** « FAILED » ; ligne « Content hash recomputed… » en échec |
| `attestation-wrong-key.json` | bandeau **rouge** ; ligne « Signer pinned » en échec (la signature est valide, mais ce n'est pas votre signataire) |
Sans empreinte collée, la page dit honnêtement « Integrity verified only. The issuer's identity was NOT verified » : une signature valide ne prouve pas **qui** a signé.

### Vérification en ligne de commande
```bash
cd ../../spec-conformance-agentic && ../vidimus-main/.venv/bin/python vidimus-svc/verify_verdict.py demo/attestation-valid.json --trusted-key $(curl -s localhost:4319/pubkey | python3 -c "import sys,json;print(json.load(sys.stdin)['key_id'])")
```
Attendu : `✓ … is valid (signer pinned)`, code de sortie 0. Avec `attestation-tampered.json` ou `attestation-wrong-key.json` : `✗ … REFUSED`, code 1.

**Important :** la commande `vidimus verify` (bibliothèque `vidimus-main`) vérifie un **autre** format, l'attestation **par lot** (`vidimus.attestation.v1`), pas ces attestations par verdict. Pour la montrer :
```bash
cd ../vidimus-main && .venv/bin/vidimus verify verifier/examples/valid.json --trusted-key $(grep -v '^#' verifier/examples/trusted-keys.txt)
```
→ valide ; remplacez `valid.json` par `tampered.json` (refusé) ou `wrong-key.json` (refusé : signataire non épinglé). La même page web vérifie les deux formats.

## 5. Script de présentation (5 minutes)
| Temps | Je fais | Je dis |
|---|---|---|
| 0:00 | Montrer `docker compose ps` et `curl localhost:4319/pubkey` | « Quatre services locaux : une base, un graphe de la spécification, un index vectoriel, et un service qui signe. La clé publique du signataire est publique ; la clé privée ne quitte jamais le service. » |
| 0:30 | Ouvrir http://localhost:3000, montrer la bannière jaune | « Mode démonstration : pas de compte, uniquement sur cette machine. En vrai, chaque client a son organisation isolée. » |
| 1:00 | Lancer l'analyse (déjà faite avant si vous manquez de temps) | « Un document d'implémentation fictif, 5 phrases ; l'agent en extrait 11 exigences et les confronte à un extrait de spécification inventé. » |
| 1:30 | Pendant l'attente : parler du fonctionnement | « Il navigue dans le graphe des clauses, un second modèle d'une autre famille vérifie, et des gardes déterministes refusent de conclure si la citation n'est pas textuelle ou si un "gap" n'est pas confirmé. » |
| 3:00 | Ouvrir la matrice, cliquer le `gap` puis la ligne LED | « Un écart avéré : l'implémentation applique les paramètres dans le désordre, la spec dit dans l'ordre reçu. Et quand il n'y a aucune clause, il ne conclut pas : il envoie à un humain. » |
| 3:45 | Montrer la confiance « 94 % » | « Ce chiffre n'est pas la confiance brute du modèle : c'est le taux de réussite observé de la tranche de confiance sur 40 exigences de référence, avec un intervalle. » |
| 4:00 | Exporter, ouvrir la page de vérification, coller `valid` (empreinte épinglée) puis `tampered` puis `wrong-key` | « Vert. Un caractère changé : rouge. Même contenu signé par un autre : rouge, parce que j'ai épinglé la clé. Sans épinglage, la page le dit : l'intégrité, pas l'identité. » |
| 5:00 | Conclure | « Le but n'est pas d'automatiser le jugement : c'est de rendre chaque verdict traçable, signé, et de savoir ce qui n'a pas été vérifié. » |

## 6. Mode démonstration (pourquoi et limites)
Sans compte Clerk valide + organisation, l'application redirige vers la connexion et on ne peut pas lancer d'analyse. `npm run dev:demo` active `DEMO_MODE=1` :
- **désactivé par défaut** ; exactement la valeur `1` ; refusé (erreur franche) si `NODE_ENV=production` ;
- ne s'applique qu'aux requêtes dont l'hôte est `localhost`/`127.0.0.1`/`[::1]` **et** le serveur n'écoute que sur la boucle locale (`-H localhost`) ; une requête avec un autre hôte retombe sur Clerk (testé) ;
- toutes les données vont dans une organisation fixe `org_demo_local` ; rien n'est envoyé à Cloudinary ;
- garde-fous testés : `npm run test:unit` (`scripts/test-demo-mode.ts`).
Pour utiliser l'application avec Clerk, lancez `npm run dev` normalement.

## 7. Erreurs probables
| Symptôme | Cause | Solution |
|---|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop arrêté | le démarrer, relancer `docker compose up -d --build` |
| `port is already allocated` | un autre service sur 4319/5433/6334/7475 | l'arrêter, ou voir `docker-compose.override.yml` (ports locaux) |
| `curl localhost:4319/health` ne répond pas | le sidecar refuse de démarrer sans clé | le compose pose `VIDIMUS_ALLOW_EPHEMERAL=1` pour le développement ; sinon voir `vidimus-svc/KEYS.md` |
| `npm run ingest` : erreur Neo4j « authentication » | mot de passe de `.env.local` différent de celui du conteneur | corriger `.env.local` ; **ne supprimez pas les volumes** sans sauvegarde |
| Page de connexion Clerk au lieu de l'app | lancé avec `npm run dev` | utiliser `npm run dev:demo` |
| Page blanche 3–5 s sur `/sign-in` | Clerk charge son script | patienter |
| `500` et `ECONNRESET` partout | serveur lancé avec `-H 127.0.0.1` | utiliser le script `dev:demo` tel quel (`-H localhost`) |
| L'analyse échoue (HTTP 500) | `OPENROUTER_API_KEY` absente/invalide ou crédit épuisé | corriger `.env.local` ; le message exact est dans le terminal de `npm run dev:demo` |
| Tous les `gap` partent en « needs review » (`verifier_same_family`) | modèle vérificateur absent ou de la même famille que l'évaluateur | `dev:demo` fixe `google/gemini-3.8-flash` via `google-vertex` ; définir `OPENROUTER_VERIFIER_MODEL` / `OPENROUTER_VERIFIER_PROVIDER` pour en changer |
| `no_clause_found` pour tout | l'extrait inventé n'est pas ingéré | refaire l'ingestion (§ 2) |
| La page de vérification dit « no WebCrypto » | ouverte hors contexte sécurisé | utiliser `http://localhost:8765`, pas l'adresse IP du réseau |
| `exported verdict=… ` ne s'affiche pas, `KeyError` | mauvais `runId` ou analyse non terminée | copier l'identifiant depuis l'URL de la matrice |

## 8. Ce que cette démo ne prouve pas
- **Pas de déploiement en ligne** : tout est local ; aucun test d'AWS, de Clerk en production, de charge, ni de multi-utilisateurs.
- **Les mesures de qualité reposent sur 40 exigences de référence déjà vues** (écrites par le même projet, une seule spécification, un seul modèle évaluateur) ; elles ont servi à concevoir les gardes. Elles ne prouvent pas que l'outil généralise.
- **Les verdicts doivent être revus par un humain** : l'outil ne rend pas de jugement de conformité ; il propose, cite et signe. Environ 4 exigences sur 10 partent en revue humaine.
- **La signature prouve l'intégrité, pas la vérité** : elle ne dit pas que le verdict est correct ni que les clauses citées existent. La clé de la démo est une clé de développement locale, absente de `vidimus-svc/trusted-keys.json`.
- La confiance affichée n'est « calibrée » que pour la tranche haute (26 éléments de référence) ; en dessous, la page affiche « not calibrated ».
- Ce texte de démonstration est inventé : les chiffres de l'évaluation (`EVAL.md`) portent sur un extrait réel de la spécification 3GPP, absent du dépôt.

## 9. Avant de publier (rien n'est poussé automatiquement)
```bash
git ls-files -z | grep -zvE '\.(png|jpg|jpeg|gif|mov|mp4|docx|ico|svg|woff2?|lock)$|package-lock' | xargs -0 npx tsx scripts/audit-spec-text.ts
```
Attendu : seul `eval/gold-set.json` (champ `requirement`, 4 exigences gardées volontairement, 12 mots consécutifs au plus). **Attention** : l'historique local contient deux commits intermédiaires (`3fc7a5a`, `ad3175f`) dont les fichiers de test reprenaient des phrases réelles ; l'arbre final est propre mais **pousser la branche telle quelle publierait ces deux commits**. Voir `docs/publication-checklist.md`.
