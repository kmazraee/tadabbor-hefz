#!/bin/sh
# Serves the admin dashboard on its own subdomain (default dashboard.ganjineh-tadabbor.ir), and closes it on the API subdomain.
#   sudo sh deploy/vps/dashboard-site.sh                         (after install.sh; the DNS record must already point at this server)
#   sudo DOMAIN=dashboard.example.com PORT=8096 sh deploy/vps/dashboard-site.sh
# Adds one nginx site (tadabbor-dashboard) and one line to the tadabbor-api site; nothing else on the server changes.
# The certificate comes from Let's Encrypt (certbot, webroot /var/www/html), like the API's.
set -eu

DOMAIN="${DOMAIN:-dashboard.ganjineh-tadabbor.ir}"
PORT="${PORT:-8095}"
SITE=/etc/nginx/sites-available/tadabbor-dashboard
API_SITE=/etc/nginx/sites-available/tadabbor-api
CF=/etc/nginx/tadabbor-cloudflare.conf

[ "$(id -u)" = 0 ] || { echo "Run as root: sudo sh $0"; exit 1; }
command -v nginx >/dev/null || { echo "nginx is not installed"; exit 1; }
command -v certbot >/dev/null || { echo "certbot is not installed (it was used for the API certificate)"; exit 1; }
curl -fs "http://127.0.0.1:$PORT/api/hefz/admin" -o /dev/null || { echo "The dashboard does not answer on 127.0.0.1:$PORT. Update first: cd /opt/tadabbor/src && sudo git pull && sudo sh deploy/vps/install.sh"; exit 1; }
mkdir -p /var/www/html

INCLUDE=""; [ -f "$CF" ] && INCLUDE="include $CF;"

# 1) Plain HTTP first, so Let's Encrypt can check the domain
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  cat > $SITE <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 404; }
}
EOF
  ln -sf $SITE /etc/nginx/sites-enabled/tadabbor-dashboard
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email \
    || { echo; echo "No certificate. Check that $DOMAIN points at this server (in Cloudflare: grey cloud / DNS only while running this), then run again."; exit 1; }
fi

# 2) The real site: only the dashboard page and its data, nothing else of the API
cat > $SITE <<EOF
# Tadabbor admin dashboard (made by deploy/vps/dashboard-site.sh)
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    server_tokens off;
    $INCLUDE
    access_log /var/log/nginx/tadabbor-dashboard.log;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location = / {
        proxy_pass http://127.0.0.1:$PORT/api/hefz/admin;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    location ^~ /api/hefz/admin/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 60s;
    }
    location / { return 404; }
}
EOF
ln -sf $SITE /etc/nginx/sites-enabled/tadabbor-dashboard

# 3) The API subdomain no longer serves the dashboard
if [ -f $API_SITE ] && ! grep -q "hefz/admin" $API_SITE; then
  cp $API_SITE /root/tadabbor-api.nginx.bak
  sed -i 's|^\(\s*\)location /api/ {|\1location ^~ /api/hefz/admin { return 404; }   # the dashboard lives on its own subdomain\n\1location /api/ {|' $API_SITE
fi

if nginx -t; then systemctl reload nginx
else
  [ -f /root/tadabbor-api.nginx.bak ] && cp /root/tadabbor-api.nginx.bak $API_SITE
  rm -f /etc/nginx/sites-enabled/tadabbor-dashboard; nginx -t && systemctl reload nginx
  echo "nginx rejected the new site; everything was put back."; exit 1
fi
echo
echo "OK: https://$DOMAIN"
echo "Now turn the Cloudflare cloud for '$(echo "$DOMAIN" | cut -d. -f1)' orange (Proxied)."
