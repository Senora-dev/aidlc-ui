#!/bin/sh
# Copy the durable, adapter-relevant parts of a real AI-DLC workspace into a fixture folder.
#   scripts/dev/extract-fixture.sh <workspace> <dest> <host-label>
# - keeps aidlc/spaces/** except hidden engine folders (.aidlc-*), and aidlc/active-space
# - keeps <harness>/tools/data/{aidlc-stamp,harness,stage-graph}.json, scopes/, and
#   knowledge/aidlc-shared/{audit-format,state-template}.md
# - renames audit shards <hostname>-<token>.md to <host-label>-<token>.md (privacy);
#   shard names are opaque to readers, so this does not change parsing.
set -eu
src=$1; dest=$2; label=$3
rm -rf "$dest"; mkdir -p "$dest"
(cd "$src" && find aidlc/spaces -type f ! -path '*/.aidlc-*' ! -name '.*' -print; [ -f aidlc/active-space ] && echo aidlc/active-space || true) | while read -r f; do
  mkdir -p "$dest/$(dirname "$f")"; cp "$src/$f" "$dest/$f"
done
for h in "$src"/.[a-z]*; do
  [ -f "$h/tools/data/aidlc-stamp.json" ] || continue
  hd=$(basename "$h")
  mkdir -p "$dest/$hd/tools/data" "$dest/$hd/knowledge/aidlc-shared"
  for f in aidlc-stamp.json harness.json stage-graph.json; do [ -f "$h/tools/data/$f" ] && cp "$h/tools/data/$f" "$dest/$hd/tools/data/"; done
  for f in audit-format.md state-template.md; do [ -f "$h/knowledge/aidlc-shared/$f" ] && cp "$h/knowledge/aidlc-shared/$f" "$dest/$hd/knowledge/aidlc-shared/"; done
  [ -d "$h/scopes" ] && cp -R "$h/scopes" "$dest/$hd/scopes"
done
find "$dest/aidlc" -path '*/audit/*.md' | while read -r f; do
  b=$(basename "$f"); token=${b##*-}
  [ "$b" = "$label-$token" ] || mv "$f" "$(dirname "$f")/$label-$token"
done
