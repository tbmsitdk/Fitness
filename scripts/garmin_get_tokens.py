#!/usr/bin/env python3
"""
One-time setup: log in to Garmin Connect, handle MFA interactively,
and save session tokens to /tmp/garmin_tokens.b64

Run this from your own machine (not GitHub Actions):
    pip3 install garminconnect
    python3 scripts/garmin_get_tokens.py

Then copy the printed base64 string into the GARMIN_TOKENS GitHub secret.
"""

import base64
import getpass
import io
import os
import sys
import tarfile

try:
    from garminconnect import Garmin
except ImportError:
    print("Install garminconnect first:  pip3 install garminconnect")
    sys.exit(1)

TOKEN_DIR  = "/tmp/garmin_token_store"
TOKEN_FILE = "/tmp/garmin_tokens.b64"


def main():
    print("=== Garmin Connect — one-time token setup ===\n")

    email    = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")

    print("\nLogging in… (garth will prompt for MFA code if required)")

    try:
        api = Garmin(email, password)
        api.login()   # garth prompts for MFA interactively at the terminal
    except Exception as e:
        print(f"\n✗ Login failed: {e}")
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

    print(f"✓ Token archive written to {TOKEN_FILE}")
    print("\nCopy the string below into the GARMIN_TOKENS GitHub secret:\n")
    print(encoded)


if __name__ == "__main__":
    main()
