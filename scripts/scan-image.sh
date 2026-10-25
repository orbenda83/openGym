#!/usr/bin/env bash
# Keep the SBOM even when the vulnerability gate fails. No silent scanner exceptions.
set -euo pipefail
image_ref=${1:?image reference required}
report_base=${2:?report path prefix required}
platform=${3:-}
trivy_args=(image)
if [[ -n "$platform" ]]; then trivy_args+=(--platform "$platform"); fi
mkdir -p "$(dirname "$report_base")"
trivy "${trivy_args[@]}" --scanners vuln --format cyclonedx \
  --output "$report_base.cdx.json" "$image_ref"
trivy "${trivy_args[@]}" --scanners vuln --format json \
  --ignore-unfixed --severity HIGH,CRITICAL --exit-code 1 \
  --output "$report_base.vuln.json" "$image_ref"
