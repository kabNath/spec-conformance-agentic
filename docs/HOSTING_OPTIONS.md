# Hosting a pilot: options, monthly cost, recommendation

Prices read on 2026-10-19 from the providers' pages (sources below). Monthly USD, 730 h. **Model/API usage (OpenRouter) is not included.** Items marked *not verified* could not be read from the provider's page; they are estimates with their arithmetic, not quotes. Nothing has been deployed.

Workload assumed: `app` (Next.js, ~1 vCPU / 1-2 GB, long SSE requests), `vidimus-svc` sidecar (0.25-0.5 vCPU / 512 MB-1 GB, **must not be reachable from the internet**, holds the production Ed25519 key as a secret), Postgres 16, Qdrant (a few thousand vectors), Neo4j 5 (a few thousand nodes). One pilot customer, a few engineers, up to ~500 checks/day.

## Findings that change the picture

1. **AWS App Runner is closed to new customers** (AWS docs; AWS recommends ECS Express Mode = Fargate + load balancer). The Terraform in `infra/terraform` therefore only works in an AWS account that already used App Runner; on a fresh account it needs a rewrite to ECS/Fargate.
2. **In that Terraform the sidecar is public today**: `aws_apprunner_service.vidimus` has no network configuration, and `VIDIMUS_URL` points at its public URL. RDS is `publicly_accessible`, secrets are plain environment variables, there is no VPC/NAT. It does not meet the requirement "the sidecar has no public port" as written.
3. The compose stack in this repository does meet it (`scripts/test-network-isolation.sh`, run in CI). Whatever the host, the same two containers run there.

## Options

| | A. AWS Tokyo (existing Terraform) | B. Fly.io Tokyo | C. Railway |
|---|---|---|---|
| Minimal pilot | ~$70 as written (sidecar public); **~$118 with a private sidecar** | **~$54** (self-run Postgres) / **~$85** (Managed Postgres Basic) | ~$38 (my usage assumptions, not measured) |
| Comfortable pilot | ~$200 / ~$247 private (+ paid Qdrant, price not verified) | ~$113 (Managed Postgres Basic) / ~$145 (Starter) | ~$77 (assumed usage) |
| Private sidecar | Only with App Runner private endpoint + VPC connector + NAT: ~+$47.5/month; Terraform must change | **Yes**: no public service, reached at `<app>.internal` | Probably yes (`railway.internal`, no public domain); docs imply it, do not state it |
| Secret for the PEM | Secrets Manager $0.40/month | `fly secrets set` | service variable (sealed variables not verified) |
| Postgres | RDS (managed, backups) | Managed Postgres (Basic $38) or self-run (no HA) | template service on a volume, not managed HA |
| Qdrant / Neo4j | Qdrant Cloud + Aura (Free tiers are unfit for a customer: Aura Free pauses after 72 h idle; Aura Professional ~$65.70/GB-month) | self-hosted on Machines with volumes (you own backups) | self-hosted on volumes |
| Region for Taiwan | Tokyo (configured); Taipei not verified | Tokyo, Singapore | Singapore (no Tokyo) |
| Idle cost | no scale to zero (provisioned memory billed) | Machines can autostop | pay for actual use; JVM keeps RAM |
| Security review | AWS reports via AWS Artifact (not fetched); most familiar to telecom reviewers | SOC 2 Type 2 stated; how to obtain the report and on which plan is unclear | SOC 2 Type II and SOC 3 stated, report at trust.railway.com; no ISO; no data-residency statement |
| Effort / lock-in | Terraform + IAM + VPC; App Runner is a dead end | flyctl/`fly.toml`, more do-it-yourself; containers stay portable | lowest effort; containers stay portable |

### Line items (arithmetic)

* **A** (Tokyo, App Runner $0.081/vCPU-h active, $0.009/GB-h memory; app 1 vCPU/2 GB active 8 h/day, sidecar 0.5 vCPU/1 GB active 4 h/day): 13.14 + 19.44 + 6.57 + 4.86 + RDS db.t4g.micro ~18.00 (*not verified*, third-party figure) + 20 GB ~2.76 (*rate not verified*) + public IPv4 3.65 + ECR/logs/domain ~2 = **~70.4**. Private sidecar: VPC endpoint $0.01/h x 2 AZ x 730 = 14.60 (us-east-1 rate; Tokyo *not verified*) + NAT 0.045 x 730 = 32.85 (Ohio rate; Tokyo *not verified*) = +47.5.
* **B** (Tokyo multiplier 1.308 over the US-East rate; shared CPU): minimal app 16.61, sidecar 4.83, Postgres (self-run Machine 8.76 + 10 GB 1.50) 10.26, Qdrant 4.98, Neo4j (2 GB) 17.36, egress 0.40 = **54.4**; with Managed Postgres Basic ($38 + 10 GB x $0.28 = 40.80) instead of the self-run Postgres: **~85**. Managed Postgres region support for Tokyo/Singapore *not verified*.
* **C** (CPU $20/vCPU-month, RAM $10/GB-month, volumes $0.15/GB, egress $0.05/GB, Pro plan $20 incl. $20 usage; billed on actual use): minimal 0.40 vCPU x 20 + 2.85 GB x 10 + 10 GB x 0.15 + 5 GB x 0.05 = **38.25**. The usage figures are my assumptions.

## Recommendation

**Fly.io, Tokyo, with Managed Postgres: about $85/month for the minimal pilot, $113-145 comfortable.**

* It is the only option that makes "sidecar on a private network, no public port" free and verifiable today, and it keeps the customer's data in a nearby region for Taiwan.
* Postgres holds what a customer will ask to audit (verdicts, signed call records), so pay for the managed, backed-up service. Qdrant and Neo4j hold data that can be rebuilt from the ingested specification, so self-hosting them on volumes with snapshots is acceptable for a pilot.
* Not AWS now: the existing Terraform cannot be applied on a new account (App Runner) and is public by default; moving to ECS/Fargate is a rewrite for no pilot-stage benefit. Keep AWS as the path **if the first customer requires it**: the same containers run there.
* Not Railway: no Tokyo, Postgres is not a managed service, and the private-network guarantee is not stated explicitly in its documentation.

Before deploying, three things to confirm with you or with the providers: (1) that Fly Managed Postgres is offered in Tokyo or Singapore; (2) how a prospect's security team gets Fly's SOC 2 report; (3) whether the prospect requires a specific cloud. If (2) or (3) fails, AWS becomes the choice and the cost is the "private sidecar" column.

What the deployment will need from you (not done): a Fly account and organisation, `fly secrets set` of the production key (`SECRETS-vidimus-prod-key/…`, never committed), the OpenRouter and Clerk keys, a domain. Deploying costs money, so I will not do it without your go.

## Sources (read 2026-10-19)

AWS: https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html, https://aws.amazon.com/apprunner/pricing/, https://docs.aws.amazon.com/apprunner/latest/dg/network-pl.html, https://docs.aws.amazon.com/apprunner/latest/dg/network-vpc.html, https://aws.amazon.com/vpc/pricing/, https://aws.amazon.com/secrets-manager/pricing/ · Fly.io: https://docs.fly.io/about/pricing, https://docs.fly.io/mpg/, https://docs.fly.io/networking/private-networking, https://fly.io/compliance · Railway: https://railway.com/pricing, https://docs.railway.com/reference/pricing/plans, https://docs.railway.com/reference/private-networking, https://docs.railway.com/reference/deployment-regions, https://docs.railway.com/enterprise/compliance · Qdrant: https://qdrant.tech/pricing/ · Neo4j: https://neo4j.com/pricing/
