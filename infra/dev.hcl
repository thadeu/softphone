app "softphone" "web" {
  host = "app.beta.softphone.lvh.me"
  replicas = 3

  tls {
    email = "ops@voodu.clowk.in"
  }
}