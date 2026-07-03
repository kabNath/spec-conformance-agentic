variable "name"   { default = "spec-conformance" }
variable "region" { default = "ap-northeast-1" } # Tokyo — close to Taiwan

variable "db_password"           { sensitive = true }
variable "clerk_publishable_key" {}
variable "clerk_secret_key"      { sensitive = true }
variable "openrouter_api_key"    { sensitive = true }
variable "openrouter_model"      { default = "anthropic/claude-sonnet-4.6" }
variable "qdrant_url"            {}
variable "qdrant_api_key"        { sensitive = true, default = "" }
variable "neo4j_uri"            {}
variable "neo4j_user"           { default = "neo4j" }
variable "neo4j_password"       { sensitive = true }
variable "cloudinary_url"        { sensitive = true, default = "" }

# For the GitHub OIDC deploy role, e.g. "kabNath/spec-conformance-agentic"
variable "github_repo" {}
