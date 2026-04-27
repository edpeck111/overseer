"""Root conftest: redirect legacy_server SQLite to /tmp (FUSE mounts block sqlite3 locking)."""
import os, sqlite3, tempfile

_REPO    = os.path.dirname(os.path.abspath(__file__))
_ORIG_DB = os.path.join(_REPO, "overseer.db")
_TMPDIR  = tempfile.mkdtemp(prefix="overseer-test-")
_TEST_DB = os.path.join(_TMPDIR, "overseer.db")
_real_connect = sqlite3.connect

def _patched_connect(database, *args, **kwargs):
    if isinstance(database, str) and os.path.abspath(database) == _ORIG_DB:
        database = _TEST_DB
    return _real_connect(database, *args, **kwargs)

sqlite3.connect = _patched_connect
