# Notes de revue de la démo « Demo — Acme terminal vs LCP »

Source des données : l'analyse déjà enregistrée (run `4583bfd7-3cda-41e6-ab7f-9b3acc8ecbe3`, lue dans la base via l'API locale). **Aucun appel payant, aucune analyse relancée.**
Tout le texte cité ici est inventé (document `demo/implementation-lcp.txt`, extrait `examples/ts38331-extrait.txt`, protocole fictif « LCP »).
Scripts reproductibles : `scripts/audit-demo-extraction.py`, `scripts/demo-row-details.py`, `scripts/demo-normative-before-after.ts`.

## Tâche 1 — Les 11 lignes viennent-elles bien des 5 phrases ?
Oui. Le document source a **5 phrases numérotées**, dont 4 sont composées (plusieurs actions dans une phrase). L'étape d'extraction a pour consigne d'extraire des exigences « atomiques, testables » : elle **coupe** les phrases composées. Elle note elle-même la phrase d'origine (`source.section` = numéro de la phrase).

| # | Exigence extraite | Phrase source | Classe | Verdict | État | Raison de revue |
|---|---|---|---|---|---|---|
| 1 | When a session is opened, the terminal shall apply the default channel parameters. | 1 | découpage | conformant | engagé | — |
| 2 | When a session is opened, the terminal shall start timer T901. | 1 | découpage | conformant | **revue** | verifier_disagreement |
| 3 | When a session is opened, the terminal shall send a SessionRequest message. | 1 | découpage | conformant | engagé | — |
| 4 | The SessionRequest message shall carry a random session value. | 1 | découpage | conformant | engagé | — |
| 5 | When the network answers with a SessionAccept message, the terminal shall stop timer T901. | 2 | découpage | conformant | engagé | — |
| 6 | When the network answers with a SessionAccept message, the terminal shall store the received parameters. | 2 | découpage | conformant | engagé | — |
| 7 | When the network answers with a SessionAccept message, the terminal shall enter the active state. | 2 | découpage | conformant | engagé | — |
| 8 | The terminal shall apply the parameters of a SessionUpdate message in an arbitrary order. | 3 | découpage | gap | engagé | — |
| 9 | The terminal shall send a SessionUpdateComplete message only if at least one parameter from the SessionUpdate message was applied successfully. | 3 | découpage | insufficient | **revue** | gap_off_subject |
| 10 | The terminal shall release the session immediately after receiving a SessionUpdate message, before it answers. | 4 | reprise 1:1 | insufficient | **revue** | citation_not_verbatim |
| 11 | The terminal shall light a green LED on the front panel for as long as a session is active. | 5 | reprise 1:1 | insufficient | **revue** | no_clause_found |

**Totaux : 5 phrases source → 11 exigences extraites ; 0 inventée ; 0 doublon ; 0 oubliée** (chaque fragment de chaque phrase est couvert par au moins une exigence extraite ; contrôle automatique de recouvrement des mots, plus relecture).
Répartition : phrase 1 → 4, phrase 2 → 3, phrase 3 → 2, phrase 4 → 1, phrase 5 → 1.
Observation (non corrigée, à décider) : l'extraction **reformule le présent en « shall »** (« applies » → « shall apply ») et ajoute le déclencheur (« When a session is opened ») à chaque fragment ; la ligne 9 ajoute « from the SessionUpdate message », absent du source. C'est conforme à la consigne « atomique », mais ce n'est pas une citation littérale du document.

## Tâche 2 — Deux lignes en revue
**Ce qui est enregistré / ce qui ne l'est pas.** La base garde le verdict final, la raison de revue, la note et la confiance du vérificateur, la citation, l'extrait vérifié (uniquement si le contrôle de citation l'a accepté), la note de l'évaluateur et la confiance brute de l'attestation. Elle **ne garde pas** le verdict brut de l'évaluateur avant les gardes, sa confiance propre, ni sa citation quand un garde la rejette. La confiance de l'évaluateur est donc **déduite** (confiance brute = moyenne(évaluateur, vérificateur) × 0,5 si le vérificateur est en désaccord).

| | « …shall start timer T901. » (#2) | « …release the session immediately… before it answers. » (#10) |
|---|---|---|
| Verdict brut de l'évaluateur avant les gardes | **conformant** (certain : un verdict `conformant` n'est pas modifié par les gardes, et le verdict final est `conformant`) | **gap** (déduit, non enregistré : le garde de citation ne se déclenche que si le verdict brut n'est pas `insufficient`, et la note de l'évaluateur dit « directly contradicts the normative clause ») |
| Confiance de l'évaluateur | ≈ 0,97 (déduite : brute 0,455, vérificateur 0,85) | ≈ 0,99 (déduite : brute 0,485, vérificateur 0,95) |
| Raison de mise en revue | `verifier_disagreement` | `citation_not_verbatim` |
| Citation retenue | clause 5.3.3 ; extrait : « On initiation, the terminal shall apply the default channel parameters, start timer T901 and send a SessionRequest message carrying a random session value. » | clause 5.3.5 ; **extrait non enregistré** (rejeté par le garde de citation) |
| Note du vérificateur | « Timer T901 is started on initiation of the session set-up procedure … and stopped when the session is successfully opened/accepted … Therefore, the terminal does not start T901 when a session is opened. » (désaccord) | « The clause provides direct evidence … explicitly stating that the terminal “shall not release the session before it has answered with a SessionUpdateComplete message”, contradicting the requirement rather than providing insufficient evidence. » (désaccord avec le verdict forcé `insufficient`) |

- **#2** : le désaccord du vérificateur est une **erreur de lecture de sa part** (il comprend « when a session is opened » comme « une fois la session acceptée » alors que la clause fait démarrer T901 à l'initiation). La mise en revue est le comportement prudent voulu ; la vraie réponse est « conformant ».
- **#10 — qui a bloqué quoi ?** Ce n'est **pas le garde de gap**. Le contrôle de citation (« l'extrait doit figurer mot pour mot dans la clause ») s'exécute **avant** le garde de gap ; il a rejeté la citation, le verdict a été forcé à `insufficient`, et la vérification de gap (les deux questions au vérificateur) **n'a jamais été lancée** pour cette ligne. Comme la raison est `citation_not_verbatim` (et non `citation_too_short`), la citation de l'évaluateur n'était pas exacte dans la clause. Les données montrent que c'est un **vrai gap** : la clause interdit de libérer la session avant d'avoir répondu (« shall not release the session before it has answered… »), l'exigence dit le contraire, le vérificateur le confirme. Le garde a donc bloqué un vrai gap **par un autre mécanisme** que le garde de gap. Pourquoi la citation n'était pas exacte : **impossible à dire sans la citation rejetée** (non enregistrée).
- **#9 (pour contraste)** : l'évaluateur avait dit `gap` (note : la clause ne conditionne pas l'envoi du message à l'application d'au moins un paramètre), le garde de gap l'a bloqué (`gap_off_subject`). Ici le blocage est justifié : l'absence d'une condition est un silence de la clause, pas une contradiction.

## Tâche 3 — Confiance affichée
**D'où vient « 94 % ».** `lib/graph/pipeline.ts` stocke `confidence = confiance calibrée de l'attestation si calibrée, sinon la confiance brute`. La confiance brute est `moyenne(confiance de l'évaluateur, confiance du vérificateur)`, avec les confiances de **deux verdicts différents** quand un garde a changé le verdict (celle de l'évaluateur porte sur le gap avant garde, celle du vérificateur sur l'`insufficient` forcé). Le sidecar la range dans une tranche et renvoie l'**exactitude observée de la tranche** (ici la tranche haute : 94,2 %, 26 items). Pour la ligne #9 : brute 0,90 → tranche haute → 94 %. C'est la fiabilité moyenne de la tranche pour des verdicts engagés, **pas** la confiance dans ce verdict-ci, qui est en revue. L'étiquette « citation confidence » était en outre inexacte, et la page ne transmettait pas l'attestation (donc pas d'intervalle).
**Correction (faite, testée).** Engagé : « Calibrated confidence 94% (95% interval 78–99%) — observed accuracy on 26 items of this tranche ». En revue : **aucun pourcentage**, seulement la raison en phrase complète (l'interface est en anglais uniquement, donc anglais ; 11 raisons rédigées, dont un repli pour un code inconnu). Lignes enregistrées avant la calibration : « LLM confidence X% — not calibrated ». Vérifié en direct dans le navigateur sur les lignes #8, #9, #10, #2 (l'affichage est calculé au rendu : il s'applique tout de suite à l'analyse déjà enregistrée). Fichiers : `lib/review-reasons.ts`, `lib/confidence-display.ts`, `components/ConfidencePanel.tsx`, `app/(app)/runs/[id]/{MatrixClient,page}.tsx`. Test de composant sans nouvelle dépendance (rendu statique React) : `scripts/test-confidence-panel.ts`.

## Tâche 4 — Colonne « Norm »
**Calcul d'origine.** `row.normative` = le mot normatif le plus fort **de la clause entière** (priorité shall_not > shall > should_not > should > may), recopié du nœud de clause par l'évaluateur. La clause 5.3.5 contient « shall apply … in the order received » **et** « shall not release … » : toutes les lignes qui la citent affichent donc `shall_not`. **C'est trompeur** : la ligne #8 (« apply … in an arbitrary order ») est gouvernée par « shall apply … in the order received », qui est un `shall`.
**Correction (faite, testée).** `lib/normative.ts` : le texte cité (extrait vérifié, sinon texte de la clause) est découpé en segments, un par mot modal dans chaque phrase ; le segment qui partage le plus de termes saillants avec l'exigence (au moins 2) décide ; sinon on garde la valeur de la clause. Branché dans `lib/graph/judge.ts` ; tests `scripts/test-normative.ts`.

| # | Exigence (début) | Clause | Avant | Après | Segment gouvernant |
|---|---|---|---|---|---|
| 8 | The terminal shall apply the parameters of a SessionUpdate… arbitrary order | 5.3.5 | shall_not | **shall** | « The terminal shall apply the parameters carried… in the order received and » |
| 9 | The terminal shall send a SessionUpdateComplete… only if… | 5.3.5 | shall_not | **shall** | idem |
| 10 | The terminal shall release the session immediately… | 5.3.5 | shall_not | **shall_not** (inchangé, correct) | « shall not release the session before it has answered… » |

Limites : (1) le choix du segment repose sur le recouvrement de mots, pas sur la compréhension ; pour #9 aucun segment ne gouverne vraiment (la clause est muette sur la condition) et « shall » est un résultat faible ; (2) l'analyse **déjà enregistrée garde ses anciennes valeurs en base** : seul un nouveau run (ou un recalcul sans LLM, non fait) les met à jour — le tableau ci-dessus est un recalcul hors ligne depuis les données stockées ; (3) l'invite de l'évaluateur reçoit toujours la valeur de clause entière (non modifiée).

## Ce qui reste à décider par vous
1. **Enregistrer le verdict brut, la confiance de l'évaluateur et la citation rejetée** (même rejetée) dans la base : aujourd'hui impossible de relire un cas comme #10. Petit changement (champ JSON), non fait.
2. **Pourquoi le contrôle de citation a rejeté une citation d'un vrai gap (#10)** : à instruire une fois la citation enregistrée ; piste : normalisation des guillemets/points de suspension. Aucun garde modifié.
3. **#2** : le vérificateur peut se tromper et envoyer en revue un verdict juste ; accepter (prudence) ou ajouter une règle ?
4. Mettre à jour en base les valeurs « Norm » de l'analyse déjà enregistrée par un recalcul sans LLM (je peux le faire sur demande).
5. L'extraction normalise en « shall » et copie le déclencheur dans chaque fragment : garder ?
6. Les lignes `insufficient` apparaissent comme « needs review » (jamais comme « insufficient » engagé) : voulu pour la démo ?

## Ce que je n'ai pas pu vérifier
- Le verdict brut et la citation de #10 (non enregistrés) : le verdict `gap` est une déduction solide, pas une lecture.
- Les valeurs de confiance de l'évaluateur : déduites par calcul inverse.
- Que le nouveau calcul de « Norm » donne ces valeurs sur un **nouveau run** (non lancé : appels payants) ; seul le recalcul hors ligne sur les extraits stockés et les tests avec évaluateur simulé le montrent.
- L'affichage dans un navigateur réel pour #1, #3–#7, #11 (vérifié en direct pour #2, #8, #9, #10).
