# Production image: build the site with Eleventy, serve it with nginx.
#
# Stage 1 needs Chromium to render p5 sketches, hence the Playwright image. Rendered sketches and optimised
# images are cached in .cache/; CI restores that folder before `docker build` so unchanged sketches and
# images are not rendered again.
FROM mcr.microsoft.com/playwright:v1.62.0-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.30-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/_site /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
