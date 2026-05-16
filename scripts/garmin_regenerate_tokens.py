#!/usr/bin/env python3
"""
Regenerate Garmin tokens from inside GitHub Actions, with SMS-2FA support.

How it works:
  1. We initiate a Garmin login with return_on_mfa=True. Garmin sees the
     credentials and texts you the SMS code.
  2. We then poll the Vercel app's /api/garmin-mfa-code endpoint, waiting
     for you to paste the code into the /garmin-setup page.
  3. Once the code arrives we resume the login, dump the new tokens, and
     print them to the GitHub Actions job summary.

Required env vars (all set from the workflow):
  GARMIN_EMAIL         — Garmin account email (existing secret)
  GARMIN_PASSWORD      — Garmin account password (existing secret)
  APP_URL              — Vercel app base URL (existing secret)
  SYNC_SECRET          — Bearer token for the GET /api/garmin-mfa-code endpoint
  VERCEL_BYPASS_SECRET — Optional; needed if the app is behind Vercel preview auth
"""

import base64
import io
import os
import sys
import tarfile
import time

import requests

try:
    from garminconnect import Garmin
except ImportError:
    print("✗ garminconnect not installed; check scripts/requirements.txt")
    sys.exit(1)

TOKEN_DIR    = "/tmp/garmin_token_store"
POLL_TIMEOUT = 300   # seconds to wait for the user to paste the code
POLL_EVERY   = 3     # seconds between polls


def headers(secret: str, bypass: str) -> dict:
    h = {"Authorization": f"Bearer {secret}"} if secret else {}
    if bypass:
        h["x-vercel-protection-bypass"] = bypass
    return h


def poll_for_code(app_url: str, secret: str, bypass: str) -> str:
    """Poll /api/garmin-mfa-code until the user posts a code (or we time out)."""
    deadline = time.time() + POLL_TIMEOUT
    url = f"{app_url.rstrip('/')}/api/garmin-mfa-code"
    hdr = headers(secret, bypass)

    # Clear any stale code from a previous run so we never pick it up
    try:
        requests.delete(url, headers=hdr, timeout=10)
    except Exception:
        pass

    print(f"  Waiting for code at {app_url}/garmin-setup …")
    last_log = 0
    while time.time() < deadline:
        try:
            r = requests.get(url, headers=hdr, timeout=10)
            if r.ok:
                code = (r.json() or {}).get("code")
                if code:
                    print(f"  ✓ Code received ({len(code)} digits)")
                    return code
        except Exception:
            pass

        remaining = int(deadline - time.time())
        if time.time() - last_log >= 15:
            print(f"  … still waiting ({remaining}s left)")
            last_log = time.time()
        time.sleep(POLL_EVERY)

    raise TimeoutError(
        f"Timed out after {POLL_TIMEOUT}s. Re-run the workflow and submit the "
        f"SMS code at {app_url}/garmin-setup within {POLL_TIMEOUT // 60} minutes."
    )


def main() -> None:
    email    = os.environ.get("GARMIN_EMAIL", "").strip()
    password = os.environ.get("GARMIN_PASSWORD", "")
    app_url  = os.environ.get("APP_URL", "").strip().rstrip("/")
    secret   = os.environ.get("SYNC_SECRET", "").strip()
    bypass   = os.environ.get("VERCEL_BYPASS_SECRET", "").strip()

    if not email or not password:
        print("✗ GARMIN_EMAIL / GARMIN_PASSWORD secrets must be set on the repo.")
        sys.exit(1)
    if not app_url:
        print("✗ APP_URL secret is required so we can poll for the SMS code.")
        sys.exit(1)

    print(f"Logging in as {email} …")
    print(f"  → Garmin will send the SMS code to your phone shortly.")
    print(f"  → Open {app_url}/garmin-setup on your phone or laptop and paste it.")
    print()

    # garminconnect's prompt_mfa is called at exactly the right moment in the
    # SSO flow — Garmin has just texted the user. We block here until the
    # user submits the code to /api/garmin-mfa-code.
    def prompt_mfa() -> str:
        return poll_for_code(app_url, secret, bypass)

    try:
        os.makedirs(TOKEN_DIR, exist_ok=True)
        api = Garmin(email, password, prompt_mfa=prompt_mfa)
        api.login(tokenstore=TOKEN_DIR)
        # Ensure tokens hit disk even if login() didn't dump automatically
        try:
            api.client.dump(TOKEN_DIR)
        except Exception:
            pass
    except Exception as exc:
        print(f"\n✗ Login failed: {exc}")
        print()
        print("Common causes:")
        print("  • Wrong SMS code, or code typed too late (Garmin codes expire fast)")
        print("  • Wrong email/password in GARMIN_EMAIL / GARMIN_PASSWORD secrets")
        print("  • Garmin SSO temporarily unavailable — try again in a few minutes")
        sys.exit(1)

    print(f"\n✓ Logged in as: {api.display_name}")
    print("✓ Packing tokens for transport…")

    # Clear the consumed MFA code so it can't be replayed
    try:
        requests.delete(
            f"{app_url}/api/garmin-mfa-code",
            headers=headers(secret, bypass),
            timeout=10,
        )
    except Exception:
        pass

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(TOKEN_DIR, arcname="garmin_token_store")
    encoded = base64.b64encode(buf.getvalue()).decode()

    print(f"✓ Token blob ready ({len(encoded)} chars)")

    # ── Job summary (rendered as markdown on the run page)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        repo = os.environ.get("GITHUB_REPOSITORY", "")
        secret_url = f"https://github.com/{repo}/settings/secrets/actions/GARMIN_TOKENS"
        with open(summary_path, "a") as f:
            f.write("# 🔑 New Garmin tokens generated\n\n")
            f.write("**Step 1.** Copy the entire string in the code block below.\n\n")
            f.write(f"**Step 2.** [Open the GARMIN_TOKENS secret]({secret_url})\n")
            f.write("→ click **Update** → paste → click **Update secret**.\n\n")
            f.write("---\n\n")
            f.write("```\n")
            f.write(encoded)
            f.write("\n```\n\n")
            f.write("That's it — the daily sync will use the new tokens on its next run.\n")

    print("=" * 70)
    print("NEW GARMIN_TOKENS VALUE — copy the line below into the secret:")
    print("=" * 70)
    print(encoded)
    print("=" * 70)


if __name__ == "__main__":
    main()
