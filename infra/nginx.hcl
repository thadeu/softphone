deployment "static" "nginx" {
  image = "nginx:latest"
  ports = [81]
}

ingress "static" "nginx" {
  host = "v0.nginx.lvh.me"
}