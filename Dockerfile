FROM node:22-alpine

# su-exec нужен, чтобы стартовать от root, выставить владельца каталога данных
# и сразу сбросить права до пользователя node (см. entrypoint.sh).
RUN apk add --no-cache su-exec

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

COPY package.json server.js ./
COPY lib ./lib
COPY admin ./admin
COPY styles.css script.js ./
COPY assets ./assets

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /data/uploads \
 && chown -R node:node /data /app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
