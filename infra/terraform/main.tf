# Real AWS infrastructure for the conformance agent.
# App container + vidimus sidecar on App Runner; Postgres on RDS.
# Qdrant + Neo4j use managed cloud (Qdrant Cloud / Neo4j Aura) via env vars —
# provision those in their own consoles and pass the endpoints in.
#
# Deploy:  cd infra/terraform && terraform init && terraform apply
# Requires: AWS credentials with admin (or the equivalent scoped policy).

terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
}
provider "aws" { region = var.region }

# ── Container registries ────────────────────────────────────────────
resource "aws_ecr_repository" "app"     { name = "${var.name}-app" }
resource "aws_ecr_repository" "vidimus" { name = "${var.name}-vidimus" }

# ── Postgres (RDS) ──────────────────────────────────────────────────
resource "aws_db_instance" "pg" {
  identifier           = "${var.name}-pg"
  engine               = "postgres"
  engine_version       = "16"
  instance_class       = "db.t4g.micro"
  allocated_storage    = 20
  db_name              = "conformance"
  username             = "postgres"
  password             = var.db_password
  skip_final_snapshot  = true
  publicly_accessible  = true    # tighten with a VPC connector for real prod
}

locals {
  database_url = "postgresql://postgres:${var.db_password}@${aws_db_instance.pg.address}:5432/conformance"
}

# ── App Runner: IAM to pull from ECR ────────────────────────────────
resource "aws_iam_role" "apprunner_ecr" {
  name = "${var.name}-apprunner-ecr"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{ Effect = "Allow", Principal = { Service = "build.apprunner.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_ecr.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# ── App Runner service: the Next.js app ─────────────────────────────
resource "aws_apprunner_service" "app" {
  service_name = "${var.name}-app"
  source_configuration {
    authentication_configuration { access_role_arn = aws_iam_role.apprunner_ecr.arn }
    auto_deployments_enabled = true
    image_repository {
      image_identifier      = "${aws_ecr_repository.app.repository_url}:latest"
      image_repository_type = "ECR"
      image_configuration {
        port = "3000"
        runtime_environment_variables = {
          DATABASE_URL                       = local.database_url
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  = var.clerk_publishable_key
          CLERK_SECRET_KEY                   = var.clerk_secret_key
          OPENROUTER_API_KEY                 = var.openrouter_api_key
          OPENROUTER_MODEL                   = var.openrouter_model
          QDRANT_URL                         = var.qdrant_url
          QDRANT_API_KEY                     = var.qdrant_api_key
          NEO4J_URI                          = var.neo4j_uri
          NEO4J_USER                         = var.neo4j_user
          NEO4J_PASSWORD                     = var.neo4j_password
          CLOUDINARY_URL                     = var.cloudinary_url
          VIDIMUS_URL                        = aws_apprunner_service.vidimus.service_url
        }
      }
    }
  }
  instance_configuration { cpu = "1024", memory = "2048" }
}

# ── App Runner service: the vidimus eval sidecar ────────────────────
resource "aws_apprunner_service" "vidimus" {
  service_name = "${var.name}-vidimus"
  source_configuration {
    authentication_configuration { access_role_arn = aws_iam_role.apprunner_ecr.arn }
    auto_deployments_enabled = true
    image_repository {
      image_identifier      = "${aws_ecr_repository.vidimus.repository_url}:latest"
      image_repository_type = "ECR"
      image_configuration { port = "4319" }
    }
  }
  instance_configuration { cpu = "512", memory = "1024" }
}

# ── GitHub OIDC role so CI can push images + trigger deploys (no long-lived keys) ──
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}
resource "aws_iam_role" "github_deploy" {
  name = "${var.name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn },
      Action = "sts:AssumeRoleWithWebIdentity",
      Condition = { StringLike = { "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:*" } }
    }]
  })
}
resource "aws_iam_role_policy" "github_deploy" {
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability","ecr:CompleteLayerUpload","ecr:InitiateLayerUpload","ecr:PutImage","ecr:UploadLayerPart"], Resource = [aws_ecr_repository.app.arn, aws_ecr_repository.vidimus.arn] },
      { Effect = "Allow", Action = ["apprunner:StartDeployment"], Resource = [aws_apprunner_service.app.arn, aws_apprunner_service.vidimus.arn] }
    ]
  })
}
