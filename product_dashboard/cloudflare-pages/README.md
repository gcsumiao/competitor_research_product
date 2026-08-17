# Cloudflare Pages access proxy

This Pages project exposes `https://product-market-research.pages.dev` and proxies authenticated
requests to the Vercel-hosted dashboard. The production Pages hostname must remain protected by a
Cloudflare Access application before the Vercel origin enables `CF_ACCESS_ENABLED=true`.

Deploy from this directory:

```bash
pnpm exec wrangler pages deploy public --project-name product-market-research
```

The proxy intentionally removes service-token secrets and spoofable identity headers before the
request reaches Vercel. Vercel independently validates `Cf-Access-Jwt-Assertion`.
