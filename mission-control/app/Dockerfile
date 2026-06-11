FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN addgroup -S punch && adduser -S punch -G punch \
  && mkdir -p /app/data && chown -R punch:punch /app/data
USER punch
ENV NODE_ENV=production DATA_DIR=/app/data PORT=8443
EXPOSE 8443
CMD ["node", "server.js"]
