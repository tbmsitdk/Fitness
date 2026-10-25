#!/usr/bin/env bash
# Pre-commit gate: correctness AND security, every change, no exceptions.
#
# Exists because "I'll check" is not a control. Run by `npm run verify` and by
# CI on every push and pull request, so a lapse in discipline fails the build
# rather than shipping.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "TypeScript"
npx tsc --noEmit || fail=1

step "Tests"
npx vitest run --reporter=dot || fail=1

step "Production build"
npx next build >/tmp/verify-build.log 2>&1 \
  && echo "build ok" \
  || { echo "BUILD FAILED — tail of log:"; tail -20 /tmp/verify-build.log; fail=1; }

step "Dependency audit (production deps)"
# High and critical only; dev-only advisories do not reach the deployed app.
#
# ACCEPTED EXCEPTION — review by 2027-02-01:
#   next@14.2.35 is the newest 14.x. The remaining advisories have no fix
#   inside v14; the only remedy is Next 16, a breaking major upgrade. None of
#   them is reachable here: no middleware.ts, no next/image, no rewrites, no
#   i18n, and the app runs on Vercel rather than self-hosted, so the edge layer
#   is vendor-patched. A gate that is permanently red gets ignored, which is
#   worse than no gate — so this ONE package is allowlisted by name and
#   anything else high/critical still fails. Re-check on the review date or
#   whenever Next 15/16 is adopted.
#
#   postcss is waived on the same grounds: it is a devDependency reached only
#   through next, runs at BUILD time (never in the deployed request path), and
#   npm reports its fix as next@16 too.
ALLOWED_PKGS="next postcss"
npm audit --omit=dev --json 2>/dev/null > /tmp/verify-audit.json
ALLOWED_PKGS="$ALLOWED_PKGS" node -e '
  const a = JSON.parse(require("fs").readFileSync("/tmp/verify-audit.json","utf8"));
  const allowed = (process.env.ALLOWED_PKGS || "").split(/\s+/).filter(Boolean);
  const bad = Object.values(a.vulnerabilities || {})
    .filter(v => ["high","critical"].includes(v.severity))
    .filter(v => !allowed.includes(v.name));
  const waived = Object.values(a.vulnerabilities || {})
    .filter(v => ["high","critical"].includes(v.severity))
    .filter(v => allowed.includes(v.name));
  if (waived.length) console.log("waived (documented, not reachable): " + waived.map(v=>v.name).join(", "));
  if (bad.length) {
    console.log("FAIL: unreviewed high/critical advisories:");
    for (const v of bad) console.log("  " + v.name + " — " + v.severity);
    process.exit(1);
  }
  console.log("no unreviewed high/critical advisories");
' || fail=1

step "Secret scan (working tree)"
# Literal credentials only — the patterns match a VALUE, not a variable name,
# so `process.env.ANTHROPIC_API_KEY` does not trip it.
secrets=$(grep -rInE \
  "(ghp_|github_pat_)[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|postgres(ql)?://[^ \"'\`]*:[^ \"'\`]+@|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  --exclude=verify.sh . 2>/dev/null)
if [ -n "$secrets" ]; then
  echo "FAIL: possible secret in the working tree:"; echo "$secrets" | head -5; fail=1
else
  echo "clean"
fi

step "XSS sinks"
# dangerouslySetInnerHTML must be fed escaped input. Flags any new occurrence
# so it is reviewed rather than discovered later.
sinks=$(grep -rln "dangerouslySetInnerHTML" components app 2>/dev/null)
if [ -n "$sinks" ]; then
  for f in $sinks; do
    grep -q "escapeHtml" "$f" && echo "ok: $f (escapes first)" \
      || { echo "FAIL: $f writes HTML without escapeHtml()"; fail=1; }
  done
else
  echo "none"
fi

printf '\n'
[ $fail -eq 0 ] && { echo "✅ verify passed"; exit 0; } || { echo "❌ verify FAILED"; exit 1; }
