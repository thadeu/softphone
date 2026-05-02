deployment "softphone" "web" {
  replicas = 3
}

ingress "softphone" "web" {
  host = "app.softphone.lvh.me"

  tls {
    enabled = true
    provider = "letsencrypt"
    email = "ops@voodu.clowk.in"
  }
}