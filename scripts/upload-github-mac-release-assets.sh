#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

MODE=upload
EXPECTED_DRAFT=true
RELEASE_ID=""
if [ "$#" -ne 0 ]; then
  if [ "$#" -ne 3 ] || [ "$1" != "--verify-only" ] || \
     { [ "$3" != "true" ] && [ "$3" != "false" ]; }; then
    echo "usage: $0 [--verify-only RELEASE_ID true|false]" >&2
    exit 64
  fi
  MODE=verify
  RELEASE_ID="$2"
  EXPECTED_DRAFT="$3"
else
  : "${GITHUB_SHA:?GITHUB_SHA is required}"
fi

APP_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")
TAG_VERSION=${GITHUB_REF_NAME#v}
TAG_VERSION=${TAG_VERSION%-mac}

if [ "$TAG_VERSION" != "$APP_VERSION" ]; then
  echo "::error::Tag $GITHUB_REF_NAME does not match package version $APP_VERSION"
  exit 1
fi

RELEASES_JSON=$(mktemp)
MATCHES_JSON=$(mktemp)
CONFLICTS_JSON=$(mktemp)
RELEASE_JSON=$(mktemp)
CREATE_JSON=$(mktemp)
trap 'rm -f "$RELEASES_JSON" "$MATCHES_JSON" "$CONFLICTS_JSON" "$RELEASE_JSON" "$CREATE_JSON"' EXIT

ASSETS=(
  "dist/Translator-${APP_VERSION}-darwin-arm64.dmg"
  "dist/Translator-${APP_VERSION}-darwin-arm64.dmg.blockmap"
  "dist/Translator-${APP_VERSION}-darwin-arm64.zip"
  "dist/Translator-${APP_VERSION}-darwin-arm64.zip.blockmap"
  "dist/Translator-${APP_VERSION}-darwin-x64.dmg"
  "dist/Translator-${APP_VERSION}-darwin-x64.dmg.blockmap"
  "dist/Translator-${APP_VERSION}-darwin-x64.zip"
  "dist/Translator-${APP_VERSION}-darwin-x64.zip.blockmap"
  "dist/latest-mac.yml"
)

for asset in "${ASSETS[@]}"; do
  if [ ! -f "$asset" ]; then
    echo "::error::Required GitHub release asset is missing: $asset"
    exit 1
  fi
done

load_matching_releases() {
  gh api --paginate \
    "repos/${GITHUB_REPOSITORY}/releases?per_page=100" > "$RELEASES_JSON"
  jq --slurp --arg tag "$GITHUB_REF_NAME" \
    '[.[][] | select(.tag_name == $tag)]' \
    "$RELEASES_JSON" > "$MATCHES_JSON"
  if [[ "$GITHUB_REF_NAME" == *-mac ]]; then
    ALTERNATE_TAG="v${APP_VERSION}"
  else
    ALTERNATE_TAG="v${APP_VERSION}-mac"
  fi
  jq --slurp --arg tag "$ALTERNATE_TAG" \
    '[.[][] | select(.tag_name == $tag)]' \
    "$RELEASES_JSON" > "$CONFLICTS_JSON"
}

load_matching_releases
release_count=$(jq 'length' "$MATCHES_JSON")
conflict_count=$(jq 'length' "$CONFLICTS_JSON")

if [ "$conflict_count" -ne 0 ]; then
  echo "::error::The alternate release tag $ALTERNATE_TAG already owns app version $APP_VERSION; refusing a second Mac release for the same version."
  jq -r '.[] | "release id=\(.id) tag=\(.tag_name) draft=\(.draft) url=\(.html_url)"' "$CONFLICTS_JSON"
  exit 1
fi

if [ "$release_count" -gt 1 ]; then
  echo "::error::Multiple GitHub releases already use $GITHUB_REF_NAME; refusing an ambiguous upload."
  jq -r '.[] | "release id=\(.id) draft=\(.draft) url=\(.html_url)"' "$MATCHES_JSON"
  exit 1
fi

if [ "$MODE" = "upload" ]; then
  if [ "$release_count" -eq 0 ]; then
    gh api --method POST "repos/${GITHUB_REPOSITORY}/releases" \
      --raw-field tag_name="$GITHUB_REF_NAME" \
      --raw-field target_commitish="$GITHUB_SHA" \
      --raw-field name="$GITHUB_REF_NAME" \
      --field draft=true \
      --field prerelease=false > "$CREATE_JSON"
    RELEASE_ID=$(jq -r '.id' "$CREATE_JSON")
  else
    RELEASE_ID=$(jq -r '.[0].id' "$MATCHES_JSON")
    if [ "$(jq -r '.[0].draft' "$MATCHES_JSON")" != "true" ]; then
      echo "::error::GitHub release $RELEASE_ID for $GITHUB_REF_NAME is already public; refusing to overwrite published assets."
      exit 1
    fi
  fi
else
  verified_release_id=$(jq -r 'if length == 1 then .[0].id else empty end' "$MATCHES_JSON")
  if [ "$release_count" -ne 1 ] || [ "$verified_release_id" != "$RELEASE_ID" ]; then
    echo "::error::GitHub release $RELEASE_ID is not the sole release for $GITHUB_REF_NAME."
    exit 1
  fi
fi

if [[ ! "$RELEASE_ID" =~ ^[0-9]+$ ]]; then
  echo "::error::GitHub did not return a valid release id."
  exit 1
fi

if [ "$MODE" = "upload" ]; then
  gh api "repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}" > "$RELEASE_JSON"
  if [ "$(jq -r '.draft' "$RELEASE_JSON")" != "true" ] || \
     [ "$(jq -r '.tag_name' "$RELEASE_JSON")" != "$GITHUB_REF_NAME" ]; then
    echo "::error::GitHub release $RELEASE_ID is not the expected draft for $GITHUB_REF_NAME."
    exit 1
  fi

  # A draft is a recoverable transaction record. Never clobber an uploaded
  # artifact with a nondeterministic rebuild (codesigning/notarization change
  # bytes). Exact existing assets are retained and only missing assets upload.
  while IFS= read -r existing_name; do
    expected=false
    for asset in "${ASSETS[@]}"; do
      if [ "$(basename "$asset")" = "$existing_name" ]; then
        expected=true
        break
      fi
    done
    if [ "$expected" != "true" ]; then
      echo "::error::GitHub draft contains an unexpected immutable asset: $existing_name"
      exit 1
    fi
  done < <(jq -r '.assets[].name' "$RELEASE_JSON")

  MISSING_ASSETS=()
  for asset in "${ASSETS[@]}"; do
    name=$(basename "$asset")
    existing_count=$(jq --arg name "$name" \
      '[.assets[] | select(.name == $name)] | length' "$RELEASE_JSON")
    if [ "$existing_count" -eq 0 ]; then
      MISSING_ASSETS+=("$asset")
      continue
    fi
    if [ "$existing_count" -ne 1 ]; then
      echo "::error::GitHub draft contains duplicate immutable assets named $name."
      exit 1
    fi

    expected_size=$(stat -f '%z' "$asset")
    expected_digest="sha256:$(shasum -a 256 "$asset" | awk '{print $1}')"
    existing_size=$(jq -r --arg name "$name" \
      '.assets[] | select(.name == $name) | .size' "$RELEASE_JSON")
    existing_state=$(jq -r --arg name "$name" \
      '.assets[] | select(.name == $name) | .state' "$RELEASE_JSON")
    existing_digest=$(jq -r --arg name "$name" \
      '.assets[] | select(.name == $name) | .digest' "$RELEASE_JSON")
    if [ "$existing_size" != "$expected_size" ] || \
       [ "$existing_state" != "uploaded" ] || \
       [ "$existing_digest" != "$expected_digest" ]; then
      echo "::error::Existing GitHub draft asset differs from the local release candidate: $name"
      exit 1
    fi
  done

  # electron-builder used to schedule one publisher per artifact and could race
  # two draft creations for the same tag. Packaging is now publish-never; this
  # single, immutable draft is the only GitHub upload target.
  if [ "${#MISSING_ASSETS[@]}" -ne 0 ]; then
    gh release upload "$GITHUB_REF_NAME" "${MISSING_ASSETS[@]}"
  fi

  load_matching_releases
  release_count=$(jq 'length' "$MATCHES_JSON")
  conflict_count=$(jq 'length' "$CONFLICTS_JSON")
  verified_release_id=$(jq -r 'if length == 1 then .[0].id else empty end' "$MATCHES_JSON")
  if [ "$conflict_count" -ne 0 ]; then
    echo "::error::The alternate release tag $ALTERNATE_TAG appeared during upload; refusing publication."
    exit 1
  fi
  if [ "$release_count" -ne 1 ] || [ "$verified_release_id" != "$RELEASE_ID" ]; then
    echo "::error::The GitHub release set changed during upload; refusing publication."
    exit 1
  fi
fi

gh api "repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}" > "$RELEASE_JSON"

if [ "$(jq -r '.draft' "$RELEASE_JSON")" != "$EXPECTED_DRAFT" ] || \
   [ "$(jq -r '.tag_name' "$RELEASE_JSON")" != "$GITHUB_REF_NAME" ]; then
  echo "::error::GitHub release $RELEASE_ID is not the expected release for $GITHUB_REF_NAME (draft=$EXPECTED_DRAFT)."
  exit 1
fi

expected_names=$(
  for asset in "${ASSETS[@]}"; do
    basename "$asset"
  done | LC_ALL=C sort
)
actual_names=$(jq -r '.assets[].name' "$RELEASE_JSON" | LC_ALL=C sort)

if [ "$actual_names" != "$expected_names" ]; then
  echo "::error::GitHub release asset inventory does not match the required set."
  diff -u <(printf '%s\n' "$expected_names") <(printf '%s\n' "$actual_names") || true
  exit 1
fi

for asset in "${ASSETS[@]}"; do
  name=$(basename "$asset")
  expected_size=$(stat -f '%z' "$asset")
  expected_digest="sha256:$(shasum -a 256 "$asset" | awk '{print $1}')"
  uploaded_size=$(jq -r --arg name "$name" \
    '.assets[] | select(.name == $name) | .size' \
    "$RELEASE_JSON")
  uploaded_state=$(jq -r --arg name "$name" \
    '.assets[] | select(.name == $name) | .state' \
    "$RELEASE_JSON")
  uploaded_digest=$(jq -r --arg name "$name" \
    '.assets[] | select(.name == $name) | .digest' \
    "$RELEASE_JSON")

  if [ -z "$uploaded_size" ] || [ "$uploaded_size" = "null" ]; then
    echo "::error::GitHub release asset is missing after upload: $name"
    exit 1
  fi

  if [ "$uploaded_size" != "$expected_size" ]; then
    echo "::error::GitHub release asset size mismatch for $name (expected $expected_size, got $uploaded_size)"
    exit 1
  fi

  if [ "$uploaded_state" != "uploaded" ]; then
    echo "::error::GitHub release asset state mismatch for $name (expected uploaded, got ${uploaded_state:-missing})"
    exit 1
  fi

  if [ "$uploaded_digest" != "$expected_digest" ]; then
    echo "::error::GitHub release asset digest mismatch for $name (expected $expected_digest, got ${uploaded_digest:-missing})"
    exit 1
  fi

  echo "Verified $name ($uploaded_size bytes, $uploaded_digest)"
done

if [ "$MODE" = "upload" ]; then
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'release_id=%s\n' "$RELEASE_ID" >> "$GITHUB_OUTPUT"
  else
    printf 'release_id=%s\n' "$RELEASE_ID"
  fi
fi
