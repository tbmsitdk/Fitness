"""Tests for how the Garmin tokens are kept alive: the sync's login routine and
the regenerate script's storage step.

Run: python3 scripts/test_garmin_tokens.py
The Garmin library and the network are stubbed.

The bug these guard against: the sync logged in with the GitHub-secret tokens
after the database copy failed, but never SAVED the refreshed tokens. Garmin
rotates the refresh token on every use, so the secret's token was spent, the
stale database copy stayed, and the next run was rejected (401). Every run
after the first failed until someone regenerated the tokens.
"""
import base64, contextlib, importlib.util, io, json, os, sys, tarfile, tempfile, types, unittest
from unittest import mock

fake = types.ModuleType("garminconnect")
fake.Garmin = type("Garmin", (), {})
sys.modules["garminconnect"] = fake
os.environ.setdefault("APP_URL", "https://example.invalid")


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, os.path.join(os.path.dirname(__file__), f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gs = load("garmin_sync")
gr = load("garmin_regenerate_tokens")


def blob(label: str) -> str:
    """A token store as the sync stores it: a tarball holding garmin_token_store/garmin_tokens.json."""
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "garmin_token_store"))
        with open(os.path.join(d, "garmin_token_store", "garmin_tokens.json"), "w") as fh:
            json.dump({"di_token": label}, fh)
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(os.path.join(d, "garmin_token_store"), arcname="garmin_token_store")
        return base64.b64encode(buf.getvalue()).decode()


def label_of(encoded: str) -> str:
    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(encoded)), mode="r:gz") as tar:
        member = tar.extractfile("garmin_token_store/garmin_tokens.json")
        return json.load(member)["di_token"]


class FakeApi:
    """Scripted logins. A success rotates the token file, as the real library does when it refreshes."""

    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.used = []
        self.display_name = "Marc"
        self.client = types.SimpleNamespace(_last_rejection_status=None)

    def login(self, tokenstore):
        path = os.path.join(tokenstore, "garmin_tokens.json")
        with open(path) as fh:
            label = json.load(fh)["di_token"]
        self.used.append(label)
        outcome = self.outcomes.pop(0)
        if outcome is not None:
            raise outcome
        with open(path, "w") as fh:
            json.dump({"di_token": f"{label}-refreshed"}, fh)


class Flow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        gs.TOKEN_DIR = os.path.join(self.tmp.name, "garmin_token_store")
        self.saved = []
        patcher = mock.patch.object(gs.requests, "put", side_effect=self._put)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)
        self.put_ok = True
        self.env = mock.patch.dict(os.environ, {"GARMIN_TOKENS": blob("secret")})
        self.env.start()
        self.addCleanup(self.env.stop)

    def _put(self, url, headers=None, json=None, timeout=None):
        if isinstance(self.put_ok, Exception):
            raise self.put_ok
        self.saved.append(label_of(json["token_data"]))
        return types.SimpleNamespace(ok=bool(self.put_ok), status_code=200 if self.put_ok else 500)

    def load_db(self):
        self.assertTrue(gs._extract_tokens(blob("db")))

    def run_login(self, api, source="db"):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            try:
                gs._login(api, source)
                code = None
            except SystemExit as e:
                code = e.code
        return out.getvalue(), code


class LoginSavesTheTokens(Flow):
    def test_the_database_tokens_work_and_the_refreshed_ones_are_saved(self):
        self.load_db()
        out, code = self.run_login(FakeApi([None]))
        self.assertIsNone(code)
        self.assertEqual(self.saved, ["db-refreshed"])

    # The regression. This path used to log in, print "it will be overwritten below",
    # and save nothing.
    def test_the_secret_carries_the_run_and_ITS_refreshed_tokens_replace_the_stale_copy(self):
        self.load_db()
        api = FakeApi([Exception("API Error 401"), None])
        out, code = self.run_login(api)
        self.assertIsNone(code)
        self.assertEqual(api.used, ["db", "secret"])
        self.assertEqual(self.saved, ["secret-refreshed"])
        self.assertIn("(secret tokens)", out)

    def test_when_neither_copy_works_it_exits_without_saving_and_says_what_to_do(self):
        self.load_db()
        out, code = self.run_login(FakeApi([Exception("API Error 401"), Exception("API Error 401")]))
        self.assertEqual(code, 1)
        self.assertEqual(self.saved, [])
        self.assertIn("Regenerate Garmin Tokens", out)
        self.assertIn("nothing needs pasting", out.lower().replace("\n", " ").replace("    ", " "))

    def test_a_rate_limit_is_waited_out_and_the_run_still_saves(self):
        self.load_db()
        with mock.patch.object(gs.time, "sleep") as sleep:
            out, code = self.run_login(FakeApi([Exception("HTTP 429 Too Many Requests"), None]))
        sleep.assert_called_once_with(30)
        self.assertIsNone(code)
        self.assertEqual(self.saved, ["db-refreshed"])

    def test_a_failed_save_does_not_fail_the_sync(self):
        self.load_db()
        self.put_ok = False
        out, code = self.run_login(FakeApi([None]))
        self.assertIsNone(code)
        self.assertIn("Could not save tokens to DB: 500", out)
        self.put_ok = ConnectionError("down")
        out, code = self.run_login(FakeApi([None]))
        self.assertIsNone(code)
        self.assertIn("Token save failed", out)

    def test_a_blocked_request_does_not_tell_the_person_to_regenerate(self):
        self.load_db()
        out, code = self.run_login(FakeApi([Exception("API Error 403: Forbidden"), Exception("API Error 403: Forbidden")]))
        self.assertEqual(code, 1)
        self.assertIn("probably not help", out)


class SaveRoutine(Flow):
    def test_saves_a_tarball_the_next_run_can_load(self):
        self.load_db()
        self.assertTrue(gs._save_tokens_to_db())
        self.assertEqual(self.saved, ["db"])

    def test_a_missing_token_directory_is_reported_not_raised(self):
        self.assertFalse(gs._save_tokens_to_db())
        self.assertEqual(self.saved, [])


@unittest.skipUnless(hasattr(tarfile, "data_filter"), "needs Python 3.12+ tar filters")
class Extraction(Flow):
    def test_a_tarball_cannot_write_outside_the_token_directory(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            data = b"evil"
            info = tarfile.TarInfo("../escaped.txt")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertFalse(gs._extract_tokens(base64.b64encode(buf.getvalue()).decode()))
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.tmp.name), "escaped.txt")))


class RegenerateStoresTheTokens(unittest.TestCase):
    def reply(self, ok=True, body=None, status=200):
        return types.SimpleNamespace(ok=ok, status_code=status, json=lambda: body, headers={}, text="{}")

    def test_stores_and_confirms_by_reading_back(self):
        with mock.patch.object(gr.requests, "put", return_value=self.reply()) as put, \
             mock.patch.object(gr.requests, "get", return_value=self.reply(body={"token_data": "TOKENS"})):
            self.assertTrue(gr.store_tokens("https://app.example/", "sekret", "bypass", "TOKENS"))
        url = put.call_args.args[0]
        self.assertEqual(url, "https://app.example/api/garmin-tokens")
        hdr = put.call_args.kwargs["headers"]
        self.assertEqual(hdr["Authorization"], "Bearer sekret")
        self.assertEqual(hdr["x-vercel-protection-bypass"], "bypass")
        self.assertEqual(put.call_args.kwargs["json"], {"token_data": "TOKENS"})

    def test_a_refused_upload_is_not_a_success(self):
        with mock.patch.object(gr.requests, "put", return_value=self.reply(ok=False, status=401)):
            self.assertFalse(gr.store_tokens("https://app.example", "s", "", "TOKENS"))

    def test_a_stale_first_read_is_retried_and_then_succeeds(self):
        reads = [self.reply(body={"token_data": "OLD"}), self.reply(body={"token_data": "TOKENS"})]
        with mock.patch.object(gr.requests, "put", return_value=self.reply()), \
             mock.patch.object(gr.requests, "get", side_effect=reads), \
             mock.patch.object(gr.time, "sleep"):
            self.assertTrue(gr.store_tokens("https://app.example", "s", "", "TOKENS"))

    def test_mismatch_reports_lengths_and_common_prefix_not_values(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
             mock.patch.object(gr.requests, "put", return_value=self.reply()), \
             mock.patch.object(gr.requests, "get", return_value=self.reply(body={"token_data": "SECRETabcdef"})), \
             mock.patch.object(gr.time, "sleep"):
            self.assertFalse(gr.store_tokens("https://app.example", "s", "", "SECRETxyz"))
        self.assertIn("12 characters against 9 sent, identical for the first 6", out.getvalue())
        self.assertNotIn("abcdef", out.getvalue())

    def test_tokens_that_cannot_be_read_back_are_not_a_success(self):
        with mock.patch.object(gr.time, "sleep"), \
             mock.patch.object(gr.requests, "put", return_value=self.reply()), \
             mock.patch.object(gr.requests, "get", return_value=self.reply(body={"token_data": "OLD-STALE-TOKENS"})):
            self.assertFalse(gr.store_tokens("https://app.example", "s", "", "TOKENS"))

    def test_an_unreachable_app_is_reported_not_raised(self):
        with mock.patch.object(gr.requests, "put", side_effect=ConnectionError("down")):
            self.assertFalse(gr.store_tokens("https://app.example", "s", "", "TOKENS"))

    def test_the_tokens_never_appear_in_what_it_prints(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
             mock.patch.object(gr.requests, "put", return_value=self.reply(ok=False, status=500)):
            gr.store_tokens("https://app.example", "s", "", "SECRET-TOKEN-VALUE")
        self.assertNotIn("SECRET-TOKEN-VALUE", out.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=1)
