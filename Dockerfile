FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile

COPY index.html kz.html styles.css script.js /srv/
COPY robots.txt sitemap.xml favicon.svg /srv/
COPY assets /srv/assets

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
