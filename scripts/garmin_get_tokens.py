#!/usr/bin/env python3
"""
One-time setup: log in to Garmin Connect, handle MFA interactively,
and save session tokens to /tmp/garmin_tokens.b64

Run this from your own machine (not GitHub Actions):
    python3 scripts/garmin_get_tokens.py

Then wait — the other script will pick up the tokens and store them
in GitHub Secrets automatically.
"""

import base64
import getpass
import io
import os
import sys
import tarfile

try:
    from garminconnect import Garmin, GarminConnectAuthenticationError
except ImportError:
    print("Install garminconnect first:  pip3 install garminconnect")
    sys.exit(1)

TOKEN_DIR  = "/tmp/garmin_token_store"
TOKEN_FILE = "/tmp/garmin_tokens.b64"


def main():
    print("=== Garmin Connect — one-time token setup ===\n")

    email    = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")

    print("\nLogging in…")

    def prompt_mfa():
        return input("Enter the 6-digit MFA code from your authenticator app: ").strip()

    try:
        api = Garmin(email, password, prompt_mfa=prompt_mfa)
        api.login()
    except GarminConnectAuthenticationError as e:
        print(f"\n✗ Login failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        sys.exit(1)

    # Save garth token store to disk
    os.makedirs(TOKEN_DIR, exist_ok=True)
    api.garth.dump(TOKEN_DIR)
    print(f"\n✓ Logged in — tokens saved to {TOKEN_DIR}")

    # Pack the directory into a base64-encoded tar.gz
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(TOKEN_DIR, arcname="garmin_token_store")
    encoded = base64.b64encode(buf.getvalue()).decode()

    with open(TOKEN_FILE, "w") as f:
        f.write(encoded)

    print(f"✓ Tokens written to {TOKEN_FILE}")
    print("\nAll done — the setup script will now store these in GitHub Secrets.")


if __name__ == "__main__":
    main()
