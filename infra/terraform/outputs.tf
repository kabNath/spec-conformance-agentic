output "app_url"          { value = aws_apprunner_service.app.service_url }
output "vidimus_url"      { value = aws_apprunner_service.vidimus.service_url }
output "ecr_app_repo"     { value = aws_ecr_repository.app.repository_url }
output "ecr_vidimus_repo" { value = aws_ecr_repository.vidimus.repository_url }
output "db_address"       { value = aws_db_instance.pg.address }
output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
