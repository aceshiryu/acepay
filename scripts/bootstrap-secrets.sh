#!/usr/bin/env bash
#
# Bootstrap Secret Manager from a cloudbuild yaml's `availableSecrets` block.
# For each secret name referenced in the yaml, ensures:
#   1. The secret exists in the current GCP project (creates + prompts for value if missing)
#   2. The Cloud Build service account has secretAccessor permission on it
#
# Idempotent — safe to re-run. Skips existing secrets, only prompts for missing.
#
# Usage:
#   gcloud config set project acepay-prod
#   bash scripts/bootstrap-secrets.sh cloudbuild/production/gateway.yaml

set -euo pipefail

YAML="${1:-}"
if [[ -z "$YAML" || ! -f "$YAML" ]]; then
  echo "Usage: bash scripts/bootstrap-secrets.sh <cloudbuild.yaml>"
  echo
  echo "Examples:"
  echo "  bash scripts/bootstrap-secrets.sh cloudbuild/production/gateway.yaml"
  echo "  bash scripts/bootstrap-secrets.sh cloudbuild/production/worker.yaml"
  exit 1
fi

PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
if [[ -z "$PROJECT_ID" ]]; then
  echo "Error: no active GCP project. Run: gcloud config set project <project-id>"
  exit 1
fi

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

echo "Bootstrapping secrets from: $YAML"
echo "  Project:        $PROJECT_ID"
echo "  Cloud Build SA: $CB_SA"
echo

# Extract secret names from `secrets/<NAME>/versions/...` references in the yaml.
SECRETS=$(grep -oE "secrets/[A-Z0-9_]+/versions" "$YAML" | sed 's|secrets/||; s|/versions||' | sort -u)

if [[ -z "$SECRETS" ]]; then
  echo "No availableSecrets references found in $YAML"
  exit 0
fi

echo "Secrets referenced ($(echo "$SECRETS" | wc -l | tr -d ' ')):"
echo "$SECRETS" | sed 's/^/  · /'
echo

# Snapshot of existing secrets (one gcloud call instead of one per check).
EXISTING=$(gcloud secrets list --format='value(name)' 2>/dev/null)

created=0
existing=0
granted=0
failed=0

for SECRET in $SECRETS; do
  echo "── $SECRET ──"

  if echo "$EXISTING" | grep -qx "$SECRET"; then
    echo "  ✓ exists"
    existing=$((existing+1))
  else
    echo "  ✗ missing — creating"
    if gcloud secrets create "$SECRET" --replication-policy=automatic >/dev/null; then
      echo "  Paste value for $SECRET (Enter, then Ctrl-D to finish):"
      if gcloud secrets versions add "$SECRET" --data-file=- >/dev/null; then
        echo "  ✓ created + value set"
        created=$((created+1))
      else
        echo "  ⚠ created but value add failed"
        failed=$((failed+1))
      fi
    else
      echo "  ⚠ create failed"
      failed=$((failed+1))
      continue
    fi
  fi

  # Grant Cloud Build access (idempotent — gcloud no-ops if already bound).
  if gcloud secrets add-iam-policy-binding "$SECRET" \
       --member="serviceAccount:${CB_SA}" \
       --role="roles/secretmanager.secretAccessor" >/dev/null 2>&1; then
    granted=$((granted+1))
  else
    echo "  ⚠ failed to grant Cloud Build SA access"
    failed=$((failed+1))
  fi
done

echo
echo "═══ Summary ═══"
echo "  Already existed:           $existing"
echo "  Created (with new value):  $created"
echo "  Cloud Build SA grants:     $granted"
[[ $failed -gt 0 ]] && echo "  Failures:                  $failed"
echo
echo "Trigger a build now — every secret referenced in $YAML is ready."
