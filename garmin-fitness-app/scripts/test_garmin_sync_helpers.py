"""Tests for the login-failure diagnostics in garmin_sync.py.

Run: python3 scripts/test_garmin_sync_helpers.py
The Garmin library is stubbed, so this needs no network and no install.
"""
import base64, importlib.util, json, os, sys, tempfile, time, types, unittest

# A stand-in for the library: only the names the script imports.
fake = types.ModuleType("garminconnect")
fake.Garmin = type("Garmin", (), {})
sys.modules["garminconnect"] = fake
os.environ.setdefault("APP_URL", "https://example.invalid")

spec = importlib.util.spec_from_file_location("garmin_sync", os.path.join(os.path.dirname(__file__), "garmin_sync.py"))
gs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gs)


class TooManyRequests(Exception):
    pass


class Api:
    def __init__(self, status=None):
        self.client = types.SimpleNamespace(_last_rejection_status=status)


def wrapped(cause: Exception) -> Exception:
    """What the library raises: a generic message with the real error underneath."""
    try:
        try:
            raise cause
        except Exception as inner:
            raise RuntimeError("Failed to retrieve social profile") from inner
    except RuntimeError as outer:
        return outer


def jwt(exp: float) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{enc({'alg': 'RS256'})}.{enc({'exp': exp})}.sig"


class LoginFailure(unittest.TestCase):
    def kind(self, exc, status=None):
        return gs._login_failure(exc, Api(status))[0]

    def test_a_rejected_token_is_told_apart_from_a_blocked_network(self):
        self.assertEqual(self.kind(wrapped(Exception("API Error 401: Token is not active"))), "rejected")
        self.assertEqual(self.kind(wrapped(Exception("API Error 403: Forbidden"))), "blocked")

    def test_the_librarys_own_record_of_the_status_wins(self):
        self.assertEqual(self.kind(wrapped(Exception("no digits here")), status=403), "blocked")
        self.assertEqual(self.kind(wrapped(Exception("no digits here")), status=401), "rejected")

    def test_rate_limiting_by_status_or_by_exception_class(self):
        self.assertEqual(self.kind(wrapped(Exception("HTTP 429 Too Many Requests"))), "rate_limited")
        self.assertEqual(self.kind(wrapped(TooManyRequests("slow down"))), "rate_limited")

    def test_a_dropped_connection(self):
        self.assertEqual(self.kind(wrapped(Exception("Connection timed out"))), "network")

    def test_an_unreadable_failure_is_called_unknown_not_expired(self):
        self.assertEqual(self.kind(wrapped(Exception("something odd"))), "unknown")

    def test_the_detail_names_the_real_error_underneath(self):
        _, detail = gs._login_failure(wrapped(Exception("API Error 403: Forbidden")), Api())
        self.assertIn("Failed to retrieve social profile", detail)
        self.assertIn("API Error 403", detail)

    def test_a_token_never_reaches_the_log(self):
        token = jwt(time.time() + 3600)
        _, detail = gs._login_failure(wrapped(Exception(f"bad token {token}")), Api())
        self.assertNotIn(token, detail)
        self.assertIn("[token]", detail)
        self.assertNotIn(token, gs._redact(f"x {token} y"))

    def test_a_cycle_in_the_exception_chain_does_not_loop(self):
        a, b = Exception("a"), Exception("b")
        a.__cause__, b.__cause__ = b, a
        self.assertEqual(self.kind(a), "unknown")


class TokenStoreDescription(unittest.TestCase):
    def describe(self, data):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "garmin_tokens.json"), "w") as fh:
                json.dump(data, fh)
            gs.TOKEN_DIR = d
            import io, contextlib
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                gs._describe_token_store()
            return out.getvalue()

    def test_reports_expiry_and_refresh_token_without_printing_either(self):
        access = jwt(time.time() - 7200)
        out = self.describe({"di_token": access, "di_refresh_token": "SECRET-REFRESH"})
        self.assertIn("expired 2.0 h ago", out)
        self.assertIn("refresh token present", out)
        self.assertNotIn("SECRET-REFRESH", out)
        self.assertNotIn(access, out)

    def test_flags_a_missing_refresh_token(self):
        self.assertIn("refresh token MISSING", self.describe({"di_token": jwt(time.time() + 3600)}))

    def test_survives_a_token_it_cannot_read(self):
        self.assertIn("no access token", self.describe({"di_token": "not-a-jwt"}))


if __name__ == "__main__":
    unittest.main(verbosity=1)
