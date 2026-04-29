"""Root conftest: redirect all SQLite connections to /tmp for FUSE safety,
run v3 migrations once per session."""
import os, sqlite3, tempfile, pytest

_REPO    = os.path.dirname(os.path.abspath(__file__))
_ORIG_DB = os.path.join(_REPO, "overseer.db")          # legacy v2
_TMPDIR  = tempfile.mkdtemp(prefix="overseer-test-")
_TEST_DB = os.path.join(_TMPDIR, "overseer.db")        # legacy redirect
_V3_DB   = os.path.join(_TMPDIR, "overseer.sqlite")    # v3 DB

# Patch sqlite3.connect before any imports so all modules see the same path.
_real_connect = sqlite3.connect

def _patched_connect(database, *args, **kwargs):
    if isinstance(database, str):
        db = os.path.abspath(database)
        if db == os.path.abspath(_ORIG_DB):
            database = _TEST_DB
        elif db == os.path.abspath(os.path.join(_REPO, "data", "overseer.sqlite")):
            database = _V3_DB
    return _real_connect(database, *args, **kwargs)

sqlite3.connect = _patched_connect

# Also patch server.config.DB_PATH so get_db() resolves the same temp path.
import server.config
server.config.DB_PATH = _V3_DB
server.config.DATA_DIR = _TMPDIR


@pytest.fixture(scope="session", autouse=True)
def _run_migrations():
    """Apply all migrations once for the entire test session."""
    from server.db import migrate
    migrate()


@pytest.fixture(autouse=True)
def _clear_db_caches():
    """Reset thread-local DB connection between tests so each test gets
    a fresh connection state (prevents FUSE locking artefacts)."""
    from server import db as _db
    _db.close_db()
    yield
    _db.close_db()
