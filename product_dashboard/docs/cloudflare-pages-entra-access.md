# Cloudflare Pages access runbook

## Target architecture

`product-market-research.pages.dev` is the only user-facing hostname. A Cloudflare Pages Function
proxies each authenticated request to `product-market-research.vercel.app`. Vercel verifies the
Cloudflare Access JWT again and rejects direct requests when `CF_ACCESS_ENABLED=true`.

The root URL resolves to the newest available Code Reader snapshot. Explicit valid historical
snapshot URLs remain available.

## Phase 1: Innova email one-time PIN

This is the deployable access method while Microsoft Entra administration is pending.

1. Protect `product-market-research.pages.dev` with a self-hosted Access application.
2. Protect `*.product-market-research.pages.dev` with a separate preview application.
3. Use the existing Cloudflare `One-time PIN` identity provider.
4. Production policy: Allow emails ending in `@innova.com`, 12-hour session (the current Cloudflare
   selector does not offer an eight-hour option).
5. Preview policy: Allow the named dashboard administrator email, 12-hour session.
6. Do not add an IP requirement to either active policy.
7. Configure `CF_ACCESS_ADMIN_EMAILS` with exact administrator addresses. Domain membership alone
   never grants Dashboard Admin.

Recommended policy names:

- `Dashboard Production - Innova Email OTP`
- `Dashboard Preview - Admin Email OTP`

## Phase 2: Microsoft Entra prerequisites for IT

Microsoft Entra is the organization's cloud identity directory. It can enforce the organization's
Microsoft Authenticator, phone, FIDO key, or other MFA methods, but the MFA method and mailbox are
separate systems. Email is normally the user's sign-in identifier; Entra policy determines whether
and how a second factor is required.

The Innova Microsoft 365 / Entra administrator should complete these items:

1. Create assigned Security Groups named `Dashboard-Users` and `Dashboard-Admins`.
2. Add every administrator to both groups and add approved viewers to `Dashboard-Users`.
3. Create an App Registration named `Cloudflare Access - Product Market Research` in tenant
   `ceb3e5a4-cc33-4e40-ab6c-7b49c70ff493`.
4. Set the web redirect URI to
   `https://innova-research.cloudflareaccess.com/cdn-cgi/access/callback`.
5. Configure supported account type as single tenant.
6. Add delegated Microsoft Graph permissions required by Cloudflare: `openid`, `email`, `profile`,
   `offline_access`, `User.Read`, `Directory.Read.All`, and `GroupMember.Read.All`.
7. Grant tenant-wide admin consent for the final permission set.
8. Add/confirm claims `email`, `name`, `given_name`, `family_name`, `oid`, and group object IDs.
9. Create a time-limited client secret and enter it directly into Cloudflare. Do not place it in
   Git, Vercel, tickets, chat, or logs.
10. Provide the Tenant ID, Application (client) ID, and both Security Group object IDs to the
    Cloudflare administrator. The secret itself should be entered directly into Cloudflare.
11. Confirm the Innova Conditional Access/MFA policy applies to the enterprise application.
12. Assign an IT owner for client-secret rotation before expiry.

## Phase 2: Cloudflare Entra configuration

After IT provides the Entra values:

1. Go to Zero Trust > Integrations > Identity providers and add Microsoft Entra ID.
2. Enter the Tenant ID, Application ID, and client secret; enable PKCE and group support where
   offered.
3. Run the built-in identity-provider test with an admin and a normal user.
4. Create replacement production and preview policies based on the Entra group object IDs.
5. Attach the new policies before removing the OTP policies to avoid lockout.
6. Set `CF_ACCESS_ADMIN_GROUP_ID` in Vercel; retain `CF_ACCESS_ADMIN_EMAILS` only as an explicitly
   reviewed break-glass fallback, or remove it after group authorization is verified.
7. Verify Dashboard name/email claims and Admin/User role rendering, then retire OTP.

Recommended policy names:

- `Dashboard Production - Entra SSO Only`
- `Dashboard Preview - Entra Admin SSO Only`

## Optional corporate IP restriction: IT input checklist

IP enforcement remains off until IT supplies all required network information:

1. Public egress CIDRs for every approved corporate office.
2. Public egress CIDRs for the corporate VPN, including every region/gateway users may exit from.
3. Confirmation whether remote users must connect through full-tunnel VPN; split-tunnel VPN may not
   present a corporate egress IP to Cloudflare.
4. IPv4 and IPv6 ranges, or written confirmation that IPv6 is disabled/not used for this traffic.
5. Named network owner and change-contact information.
6. Expected change windows and an emergency break-glass procedure.
7. At least one current Cloudflare administrator egress IP that is included before enforcement.
8. A test user and test device on an approved network, plus a test path from a non-approved network.

## Optional corporate IP restriction: Cloudflare steps

1. Create an Access reusable IP list/group named `Dashboard-Approved-Networks` from the IT-provided
   CIDRs.
2. Create inactive strict policies:
   - `Dashboard Production - Innova Email OTP + Corporate IP` during Phase 1, or the equivalent Entra
     group policy during Phase 2.
   - `Dashboard Preview - Admin + Corporate IP`.
3. Keep the identity/domain rule as `Include`; add `Dashboard-Approved-Networks` as a `Require`
   condition so both identity and network must match.
4. Confirm the current administrator is on an approved network before attaching strict policies.
5. Attach the strict policy first, verify allowed access, and only then remove the non-IP policy.
6. Test both allowed and disallowed networks and review Access logs.
7. Record operator, timestamp, old policy, new policy, and IT ticket/change reference.

To turn the IP restriction off, attach the non-IP policy first, verify external SSO/OTP access, and
then detach the strict policy. Keep the reusable network group and strict policies for later reuse;
no Dashboard or Vercel deployment is required.

## Vercel

Phase 1 variables:

- `CF_ACCESS_ENABLED=true`
- `CF_ACCESS_TEAM_DOMAIN=https://innova-research.cloudflareaccess.com`
- `CF_ACCESS_AUDIENCES=<production-aud>,<preview-aud>`
- `CF_ACCESS_ADMIN_EMAILS=ginny.chen@innova.com`
- `DASHBOARD_REVALIDATE_URL=https://product-market-research.pages.dev`

Phase 2 additionally uses `CF_ACCESS_USERS_GROUP_ID` and `CF_ACCESS_ADMIN_GROUP_ID`. Enable origin
enforcement only after the Pages production Access policy works. Verify the Pages URL succeeds and
the raw Vercel URL returns HTTP 403.

## Automation

When automated smoke/revalidation is enabled, create a narrowly scoped Cloudflare service token and
supply `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` only through the CI/local secret store.
The Pages proxy removes these credentials before forwarding the request, and Vercel accepts the
resulting service JWT only for the explicit automation route allowlist.
