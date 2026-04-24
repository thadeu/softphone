deployment "softphone" "web" {
  replicas = 1
}

ingress "softphone" "web" {
  host = "v0.softphone.lvh.me"

  tls {
    enabled = true
    provider = "letsencrypt"
    email = "ops@voodu.clowk.in"
  }
}