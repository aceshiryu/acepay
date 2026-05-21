# Deploying AcePay to App Engine

Three App Engine Standard services (`gateway`, `worker`, `admin`) in one GCP project per environment. Region: `asia-southeast1`. Postgres on Supabase, Redis on Upstash.

## File layout

```
cloudbuild/
  production/
    gateway.yaml      ← builds + deploys payment-gateway, version=$SHORT_SHA, --promote
    worker.yaml       ← builds + deploys payment-worker, version=$SHORT_SHA, --promote
    admin.yaml        ← builds + deploys payment-admin, version=$SHORT_SHA, --promote
  development/
    gateway.yaml      ← same but version=dev-$SHORT_SHA, --no-promote
    worker.yaml
    admin.yaml

apps/payment-gateway/app.yaml     ← App Engine runtime + scaling (env_variables injected at deploy)
apps/payment-worker/app.yaml
apps/payment-admin/app.yaml
```

Each `cloudbuild/<env>/<service>.yaml`:
1. `npm ci`
2. Builds with Nx (`payment-gateway:prune` for NestJS services → pruned package.json + dist; `nx build payment-admin` for Next.js standalone)
3. Stages `app.yaml` into the deploy directory and appends an `env_variables:` block by reading secrets from Secret Manager
4. `gcloud app deploy <staged-dir>/app.yaml`

## One-time setup per environment

Repeat for the production project and the development project.

### 1. Enable APIs

```bash
gcloud config set project acepay-prod        # or acepay-dev
gcloud services enable \
  appengine.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

### 2. Initialize App Engine

```bash
gcloud app create --region=asia-southeast1
```

### 3. External data layer

- **Supabase** — create a Singapore project. Connection string: Settings → Database → Connection pooling → **Session mode** (port 5432). That's `DATABASE_URL`.
- **Upstash Redis** — Singapore region. Copy the TLS connection string (`rediss://…`). That's `REDIS_URL`.
- Run migrations once from your laptop: `DATABASE_URL=postgres://... npm run db:migrate && npm run seed:admin`.

### 4. Secret Manager

```bash
for SECRET in \
  DATABASE_URL REDIS_URL JWT_SECRET WEBHOOK_SECRET_ENCRYPTION_KEY \
  LEMONSQUEEZY_API_KEY LEMONSQUEEZY_STORE_ID LEMONSQUEEZY_WEBHOOK_SECRET \
  LEMONSQUEEZY_VARIANT_ID XENDIT_SECRET_KEY XENDIT_WEBHOOK_TOKEN \
  ADMIN_USER_EMAIL ADMIN_USER_PASSWORD
do
  gcloud secrets create $SECRET --replication-policy=automatic 2>/dev/null
  echo "Add value for $SECRET:" && gcloud secrets versions add $SECRET --data-file=-
done
```

Generate `JWT_SECRET` and `WEBHOOK_SECRET_ENCRYPTION_KEY` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. IAM — give Cloud Build secret access + App Engine deploy permission

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
CB_SA=${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com

# Cloud Build → Secret Manager (read secrets during deploy)
for SECRET in DATABASE_URL REDIS_URL JWT_SECRET WEBHOOK_SECRET_ENCRYPTION_KEY \
              LEMONSQUEEZY_API_KEY LEMONSQUEEZY_STORE_ID LEMONSQUEEZY_WEBHOOK_SECRET \
              LEMONSQUEEZY_VARIANT_ID XENDIT_SECRET_KEY XENDIT_WEBHOOK_TOKEN \
              ADMIN_USER_EMAIL ADMIN_USER_PASSWORD; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:${CB_SA}" --role="roles/secretmanager.secretAccessor"
done

# Cloud Build → App Engine deploy
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CB_SA}" --role="roles/appengine.deployer"
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CB_SA}" --role="roles/appengine.serviceAdmin"
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CB_SA}" --role="roles/iam.serviceAccountUser"
```

## Manual deploy

```bash
# Production
gcloud builds submit --config cloudbuild/production/gateway.yaml .
gcloud builds submit --config cloudbuild/production/worker.yaml .
gcloud builds submit --config cloudbuild/production/admin.yaml .

# Development
gcloud builds submit --config cloudbuild/development/gateway.yaml .
gcloud builds submit --config cloudbuild/development/worker.yaml .
gcloud builds submit --config cloudbuild/development/admin.yaml .
```

## GitHub triggers (continuous deploy)

```bash
# Production — main branch
for SERVICE in gateway worker admin; do
  PATHS=apps/payment-$SERVICE/**,nx.json,package.json,tsconfig.base.json
  [ "$SERVICE" != "admin" ] && PATHS=$PATHS,apps/payment-gateway/**     # worker shares gateway source
  gcloud builds triggers create github \
    --name=acepay-$SERVICE-prod \
    --repo-owner=YOUR_GH_USER --repo-name=ace-pay --branch-pattern=^main$ \
    --included-files=$PATHS \
    --build-config=cloudbuild/production/$SERVICE.yaml
done

# Development — develop branch
for SERVICE in gateway worker admin; do
  PATHS=apps/payment-$SERVICE/**,nx.json,package.json,tsconfig.base.json
  [ "$SERVICE" != "admin" ] && PATHS=$PATHS,apps/payment-gateway/**
  gcloud builds triggers create github \
    --name=acepay-$SERVICE-dev \
    --repo-owner=YOUR_GH_USER --repo-name=ace-pay --branch-pattern=^develop$ \
    --included-files=$PATHS \
    --build-config=cloudbuild/development/$SERVICE.yaml
done
```

## Service URLs (after deploy)

| Service | URL |
|---|---|
| Gateway | `https://gateway-dot-<PROJECT_ID>.as.r.appspot.com` |
| Admin   | `https://admin-dot-<PROJECT_ID>.as.r.appspot.com` |
| Worker  | `https://worker-dot-<PROJECT_ID>.as.r.appspot.com/health` (only for health checks) |

## Post-deploy checklist

- [ ] Log into the admin URL with seeded credentials.
- [ ] On `/settings`, paste the **gateway URL** as Public webhook URL.
- [ ] Lemon Squeezy dashboard → Webhooks → set `<GATEWAY_URL>/v1/webhooks/lemonsqueezy`.
- [ ] Xendit dashboard → Settings → Callbacks → Invoices Paid URL → `<GATEWAY_URL>/v1/webhooks/xendit`.
- [ ] Click **Simulate webhook** on `/settings` — both providers should return success.
- [ ] Run a sandbox test transaction on an App Detail page → pay → verify `customers.xendit_payment_method_id` populates.

## Notes

- **Worker scaling:** `manual_scaling: instances: 1` keeps the Bull consumer alive 24/7. Don't switch to `automatic_scaling` — App Engine kills instances with no inbound requests, which would drop queued jobs.
- **Gateway scaling:** `min_instances: 1` to keep webhook receivers warm. Cold-starting a provider webhook means Xendit/LS may retry before AcePay boots.
- **NEXT_PUBLIC_API_BASE_URL** is baked into the Next.js bundle at build time. If you change the gateway URL, redeploy the admin.
- **Versions:** production deploys with `--promote` (takes traffic immediately). Development uses `--no-promote` so you can review at the version-pinned URL before promoting via `gcloud app services set-traffic`.

## Monthly cost estimate (low volume, production)

| Item | Tier | Cost |
|---|---|---|
| App Engine gateway (F2 · min 1) | always-on | ~$15 |
| App Engine worker (B2 · 1 instance) | always-on | ~$15 |
| App Engine admin (F2 · min 0) | scale-to-zero | ~$1 |
| Supabase Postgres | free tier | $0 |
| Upstash Redis | free tier | $0 |
| Secret Manager | <100 versions | <$1 |
| Cloud Build | <120 build-min/day | $0 |
| **Total** | | **~$32/mo** |
