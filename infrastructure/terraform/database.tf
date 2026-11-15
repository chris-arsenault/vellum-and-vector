# owner-direction(2026-11-15): create our own secrets and use them through the Ahara platform.
resource "random_password" "database" {
  for_each = toset(["admin", "map", "reader", "generation"])
  length   = 32
  # Credentials are embedded in PostgreSQL URLs by Compose.
  special = false
}

resource "aws_ssm_parameter" "database_password" {
  for_each = random_password.database
  name     = "/ahara/${local.prefix}/database/${each.key}-password"
  type     = "SecureString"
  tier     = "Standard"
  value    = each.value.result
}
