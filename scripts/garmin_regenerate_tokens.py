#!/usr/bin/env python3
"""
Non-interactive token regeneration — designed to run inside a GitHub
Actions workflow. Reads credentials and the MFA code from env vars,
logs in to Garmin, and prints the new base64 token blob.

Required env vars:
  GARMIN_EMAIL     — your Garmin Connect email (existing secret)
  GARMIN_PASSWORD  — your Garmin Connect password (existing secret)
  GARMIN_MFA       — the 6-digit code from your authenticator app

Output is written both to stdout and (if running in GH Actions) to the
job summary page so you can copy it directly without scrolling logs.
"""

import base64
import io
import os
import sys
import tarfile

try:
    from garminconnect import Garmin
except ImportError:
    print("✗ garminconnect not installed; run `pip install -r scripts/requirements.txt`")
    sys.exit(1)

TOKEN_DIR = "/tmp/garmin_token_store"


def main() -> None:
    email    = os.environ.get("GARMIN_EMAIL", "").strip()
    password = os.environ.get("GARMIN_PASSWORD", "")
    mfa_code = os.environ.get("GARMIN_MFA", "").strip()

    if not email or not password:
        print("✗ GARMIN_EMAIL / GARMIN_PASSWORD secrets must be set on the repo.")
        sys.exit(1)
    if not mfa_code:
        print("✗ GARMIN_MFA input is required (6-digit code from your authenticator).")
        sys.exit(1)

    print(f"Logging in as {email} …")

    # garminconnect's MFA callback — called when the SSO flow needs the 2FA code.
    def prompt_mfa() -> str:
        return mfa_code

    try:
        os.makedirs(TOKEN_DIR, exist_ok=True)
        api = Garmin(email, password, prompt_mfa=prompt_mfa)
        api.login(tokenstore=TOKEN_DIR)
        api.client.dump(TOKEN_DIR)
    except Exception as exc:
        print(f"✗ Login failed: {exc}")
        print()
        print("Common causes:")
        print("  • Wrong MFA code, or code expired (they last only 30 s)")
        print("  • Wrong email/password in the GARMIN_EMAIL / GARMIN_PASSWORD secrets")
        print("  • Garmin's SSO is temporarily unavailable — try again in a few minutes")
        sys.exit(1)

    print(f"✓ Logged in as: {api.display_name}")
    print("✓ Tokens dumped to disk; packing for transport …")

    # Pack the directory into a base64-encoded tar.gz so it round-trips
    # cleanly through GitHub secrets and env vars.
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(TOKEN_DIR, arcname="garmin_token_store")
    encoded = base64.b64encode(buf.getvalue()).decode()

    print(f"✓ Token blob ready ({len(encoded)} chars)")
    print()

    # ── Write to GitHub Actions job summary (renders as markdown on the run page)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        repo = os.environ.get("GITHUB_REPOSITORY", "")
        secret_url = f"https://github.com/{repo}/settings/secrets/actions/GARMIN_TOKENS"
        with open(summary_path, "a") as f:
            f.write("# 🔑 New Garmin tokens generated\n\n")
            f.write("**Step 1.** Copy the entire string in the code block below.\n\n")
            f.write("**Step 2.** [Open the GARMIN_TOKENS secret](" + secret_url + ")\n")
            f.write("→ click **Update** → paste → click **Update secret**.\n\n")
            f.write("---\n\n")
            f.write("```\n")
            f.write(encoded)
            f.write("\n```\n\n")
            f.write("That's it — the daily sync will use the new tokens on its next run.\n")

    # Also dump to stdout for raw-log fallback
    print("=" * 70)
    print("NEW GARMIN_TOKENS VALUE — copy the line below into the secret:")
    print("=" * 70)
    print(encoded)
    print("=" * 70)


if __name__ == "__main__":
    main()
