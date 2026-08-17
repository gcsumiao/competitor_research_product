# Cloudflare Pages and Microsoft Entra access runbook

## Target architecture

`product-market-research.pages.dev` is the only user-facing hostname. A Cloudflare Pages Function
proxies each authenticated request to `product-market-research.vercel.app`. Vercel verifies the
Cloudflare Access JWT again and rejects direct requests when `CF_ACCESS_ENABLED=true`.

## Microsoft Entra

1. Create security groups named `Dashboard-Users` and `Dashboard-Admins`.
2. Add every administrator to both groups.
3. Register an application for Cloudflare Access with redirect URI
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`.
4. Add the `openid`, `email`, `profile`, `offline_access`, `User.Read`, `Directory.Read.All`, and
   `Group.Read.All` delegated permissions required by Cloudflare, then grant tenant admin consent.
5. Add token claims for `email`, `name`, `given_name`, `family_name`, and `oid`.
6. Create a time-limited client secret and enter it directly into Cloudflare. Do not store it in this
   repository or in Vercel.

## Cloudflare Pages and Access

1. Create the Pages project `product-market-research` and deploy `cloudflare-pages/public` with
   Wrangler from the `cloudflare-pages` directory.
2. Add Microsoft Entra ID under Zero Trust > Integrations > Identity providers. Enable PKCE and
   group support, then run the built-in identity provider test.
3. In Pages project settings, enable the Access policy. Edit the generated Access application and
   remove the wildcard from its public hostname so it protects `product-market-research.pages.dev`.
4. Re-enable the Pages preview Access policy and verify a second application protects
   `*.product-market-research.pages.dev`.
5. Attach these default policies:
   - `Dashboard Production - SSO Only`: Allow `Dashboard-Users`, 8-hour session.
   - `Dashboard Preview - Admin SSO Only`: Allow `Dashboard-Admins`, 8-hour session.
6. Create a `Dashboard-Automation` service token and a Service Auth policy. Store its client ID and
   secret only in the CI/local secret store used by deployment smoke tests.

## Optional corporate IP switch

IP enforcement is off by default. When corporate/VPN CIDRs are available:

1. Create `Dashboard-Approved-Networks` with the approved CIDRs.
2. Create reusable strict policies:
   - `Dashboard Production - SSO + Corporate IP`
   - `Dashboard Preview - Admin SSO + Corporate IP`
3. Before enabling, verify the current Cloudflare administrator IP is included.
4. Attach the strict policies, then detach the SSO-only policies.
5. Test from an allowed and a non-allowed network and record the policy change in the Access audit
   log.

To disable IP enforcement, attach the SSO-only policies first, verify access, and then detach the
strict policies. No Dashboard or Vercel deployment is required for either switch.

## Vercel

Set all Cloudflare variables with `CF_ACCESS_ENABLED=false`, deploy, and validate Pages proxying.
Then populate both Access audience tags and Entra group object IDs. Set `CF_ACCESS_ENABLED=true`
only after the Pages production Access policy works for an admin and a normal user.

The final production variables are documented in `.env.vercel.example`. After enforcement is on,
verify that the Pages URL succeeds and the raw Vercel URL returns HTTP 403.

## Automation

For local or CI smoke/revalidation calls, supply:

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

The Pages proxy removes these credentials before forwarding the request. Vercel accepts the
resulting service JWT only for the explicit smoke/revalidation route allowlist.
