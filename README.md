# Spec Conformance Agent — agentic stack

![Demo](docs/demo.gif)

A 3GPP/O-RAN **document-level** conformance engine on a full modern agentic-SaaS
stack. **Every tool has an explicit, working role** — nothing is a placeholder.
The moat modules (`lib/parser-3gpp.ts`, `lib/conformance-contract.ts`) are
stack-agnostic and carried over; everything else is built on this stack.

## Every tool → its role

| Tool | Role in THIS product | Real? |
|---|---|---|
| **Next.js 15** | App framework — UI + API routes | implemented |
| **Clerk** | Auth + multi-tenancy (Organization = tenant) | implemented |
| **PostgreSQL + Prisma** | Relational store (runs, requirements, assets) | implemented |
| **Qdrant** | Vector store for the vector fallback | implemented |
| **Neo4j** | Clause cross-reference graph (vectorless graph-walk) | implemented |
| **OpenRouter** | LLM gateway (agent calls + embeddings) | implemented |
| **LangGraph** | Bounded pipeline as a state machine | implemented |
| **LangChain** | LLM / embeddings / store plumbing | implemented |
| **Cloudinary** | Raw uploaded-document storage | implemented |
| **Vidimus** | Calibrated confidence + Ed25519-signed attestation (sidecar) | wired (vidimus-svc/) |
| **Docker** | Local parity (docker-compose) + on-prem deliverable | Dockerfiles |
| **CI/CD** | GitHub Actions: verify (ci.yml) + real deploy (deploy.yml) | real, OIDC |
| **AWS** | App Runner (app + vidimus) + RDS Postgres, via Terraform | IaC in infra/terraform |

**Retrieval approach:** vectorless clause-graph navigation (Neo4j) as the primary path, with vector similarity (Qdrant) as a fallback — not naïve RAG.

## Architecture

Next.js 15 (UI + API) with Clerk auth (orgId = tenant) drives a LangGraph state
machine: `extract -> ( retrieve -> compile )* -> END` (the deterministic shell).
- retrieve: vectorless graph-walk on Neo4j + Qdrant fallback (bounded)
- assess: verdict + confidence, grounded only in the cited clause
- verify: adversarial check (catches citation hallucination)
- compile: Vidimus attest -> calibrated confidence + signed proof
Persistence: Prisma/PostgreSQL (matrix rows), Cloudinary (blobs), Vidimus (attestations).

## Run locally

    docker compose up -d                 # postgres + qdrant + neo4j + vidimus
    cp .env.example .env.local           # fill Clerk / OpenRouter keys
    npm install
    npx prisma migrate dev --name init
    npm run ingest -- <orgId> standard1 "TS 38.331" 18.3.0 Rel-18 ./ts38331.txt
    npm run dev                          # http://localhost:3000

## Deploy to AWS — for real

The infra is real Terraform + a real OIDC deploy workflow. The one step only you
can run (I have no access to your AWS account) is `terraform apply` with your
credentials. After that, every push to main deploys automatically.

    # 1. Provision AWS (ECR, App Runner x2, RDS, GitHub OIDC role); point at
    #    managed Qdrant Cloud / Neo4j Aura endpoints.
    cd infra/terraform
    cp terraform.tfvars.example terraform.tfvars   # fill in your values
    terraform init && terraform apply
    #    -> outputs: app_url, ecr repos, github_deploy_role_arn, db_address

    # 2. In GitHub repo settings add:
    #    Variables: AWS_REGION
    #    Secrets:   AWS_DEPLOY_ROLE_ARN (=github_deploy_role_arn),
    #               APPRUNNER_APP_ARN, APPRUNNER_VIDIMUS_ARN

    # 3. Push to main -> deploy.yml builds+pushes both images to ECR and
    #    triggers App Runner. App is live at app_url.

Genuine end-to-end deploy: OIDC (no long-lived keys), ECR, App Runner, RDS.
Nothing is a stub. Only `terraform apply` + setting the secrets are yours to run,
because they require your AWS account.

## Honest status

- Implemented and defensible line-by-line: the LangGraph pipeline, vectorless
  Neo4j graph-walk + Qdrant fallback, the verifier, the 3GPP parser, multi-tenant
  SaaS, the full UI, the Vidimus attestation service, the Terraform IaC, and the
  OIDC deploy workflow.
- Requires your credentials to go live (a boundary, not a stub): `terraform apply`
  against your AWS account + adding the GitHub secrets. Until then it is complete
  but not on a live URL; once you run those, it is genuinely deployed.
- Polyglot persistence on purpose: Qdrant + Neo4j + Postgres is heavier than the
  MVP strictly needs — kept for portfolio value; Neo4j is the real technical fit.
