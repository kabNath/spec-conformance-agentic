# Avant tout push — état au moment de l'audit (rien n'a été poussé)

## spec-conformance-agentic
- Remote : `origin` = `https://github.com/kabNath/spec-conformance-agentic.git` (**public**, accès anonyme confirmé), seule branche distante : `main` au commit `6be9042`.
- Branches locales jamais poussées : `fix/audit-trust`, `feat/phase1`. **28 commits** de `feat/phase1` ne sont pas sur `main`.
- Changement par rapport à `main` : 79 fichiers (48 ajoutés, 29 modifiés, 2 supprimés), +16 251 / −2 228 lignes.
- Fichiers suivis : ≈ 128, ≈ 4 Mo ; le plus gros : `docs/demo.gif` (2,8 Mo), puis `package-lock.json` (177 Ko), les résultats expurgés (≤ 96 Ko chacun).
- Jamais suivis (ignorés) : `.env.local`, `*.pem`/clés, `38331-j30.docx` (spécification), `examples/ts38331-extract.txt` et `-source.txt`, résultats bruts `eval/results*.json`, `demo.mov`, `docker-compose.override.yml`.
- **Secrets** : balayage des fichiers suivis (clés OpenRouter/Clerk/Stripe-like, clés privées, URL Cloudinary, jetons GitHub/Slack/AWS, mots de passe en clair) : **aucun**. Deux faux positifs examinés : `infra/terraform/main.tf` (le mot de passe est la référence Terraform `${var.db_password}`) et `infra/terraform/terraform.tfvars.example` (valeurs d'exemple `change-me-strong` / `...`). `.env.example` ne contient que des modèles.
- **Texte de spécification (arbre final)** : contrôleur `scripts/audit-spec-text.ts` sur tous les fichiers suivis : seul `eval/gold-set.json`, champ `requirement` de 4 exigences (R02, R08, R33, R40), au plus 12 mots consécutifs — gardé volontairement (entrées du banc d'essai).
- **Texte de spécification (historique à pousser)** : les lignes **ajoutées** par les 28 commits contiennent 51 fenêtres de ≥ 9 mots de la spécification, toutes dans **deux commits intermédiaires** : `3fc7a5a` (fixtures de `scripts/test-citation-check.ts`) et `ad3175f` (fixtures de `scripts/test-gap-check.ts`, et l'historique de ces fichiers). Elles ont été remplacées par du texte inventé dans `6c6c6b6`, mais **pousser la branche telle quelle publierait ces deux commits**.
  Les anciens fichiers déjà publics sur `main` (`eval/results-run*.json`, `examples/ts38331-extrait.txt`, `eval/gold-set.json`) restent dans l'historique public : voir `docs/spec-text-cleanup-plan.md` et `docs/history-rewrite-simulation.md` (rien n'a été réécrit).

### Option recommandée si vous voulez pousser le travail (procédure, **non exécutée**)
Pousser un seul commit « aplati » construit depuis l'arbre final, au lieu de l'historique :
```bash
git switch -c publish/phase1 6be904281af0a3404f67304ae1004691b788bd5c
```
```bash
git merge --squash feat/phase1
```
```bash
git commit -m "Phase 1: audit-trust fixes, calibrated confidence, gap guard, demo"
```
Puis relancer le contrôleur sur `git log -p origin/main..HEAD` (lignes ajoutées uniquement) avant tout `git push`. Conséquence : le SHA du pré-enregistrement `ad3175f1` n'existerait pas publiquement ; `docs/preregistration.md` en garde le hash SHA-256 et la signature, et le bundle de sauvegarde (`../backups/…bundle`, jamais à pousser) garde l'historique complet.

## vidimus-main
- **Aucun remote configuré** : rien ne peut être poussé tant qu'un remote n'est pas ajouté.
- 82 fichiers suivis, ≈ 385 Ko ; aucun secret, aucune clé, aucun `.env` suivi ; aucun texte de spécification.
- Les clés des exemples (`verifier/examples/*`, `verifier/make_examples.py`) sont **dérivées de chaînes publiques** : des clés de démonstration, pas des secrets.
- L'historique local a été initialisé dans cette session (`git init` + commit de base) : le dépôt public `kabNath/vidimus` n'a **pas** cet historique ; le fusionner demande de rebaser/importer ces commits, à décider.
