# Release storage policy

GitHub Releases is the immutable archive for signed desktop artifacts. Cloudflare
R2 is only the bounded delivery channel used by the updater and the stable links
on `translator.tools`.

## R2 retention

Each platform's `latest/` prefix retains:

- the current update manifest;
- the stable website installer aliases and checksum, where applicable;
- every payload named by the current manifest, plus an available blockmap; and
- the exact previously published payload generation, so a client that fetched
  the old manifest immediately before promotion can finish downloading it.

The release first records that previous manifest's exact version and payload
names in `release-retention.json`. Retries reuse the record, and rollbacks make
the formerly current release the retained generation. Cleanup never guesses
from whichever version happens to sort highest in the object inventory.

Release automation deletes only filenames covered by the updater payload
contract. An unknown object is reported and left alone; expanding the contract
requires an explicit policy and test change. The planner also refuses deletion
when a manifest is malformed, its payload versions disagree, or any required
current object is absent.

New releases do not create `mac/{version}/` or `win/{version}/` R2 archives.
Those copies grow without bound and duplicate the verified GitHub assets.

## Publication order

The macOS workflow verifies its complete GitHub draft before changing R2. It
uploads and publicly verifies every new R2 payload, switches the manifest,
switches the stable aliases, and only then prunes obsolete updater generations.

The Windows one-click release signs and validates the package, injects release
notes, promotes and verifies R2, archives those exact final files on the already
published GitHub release, and then purges the public cache. Both R2 promotion
and the GitHub bridge are idempotent, so a failure after either boundary can be
retried without replacing an immutable artifact.

Rollback must re-promote the complete payload set and manifest. Never replace a
manifest by itself.
