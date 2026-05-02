deployment "softphone" "web" {
  replicas = 1
}

ingress "softphone" "web" {
  host = "app.staging.softphone.lvh.me"

  tls {
    enabled = true
    provider = "letsencrypt"
    email = "ops@voodu.clowk.in"
  }
}