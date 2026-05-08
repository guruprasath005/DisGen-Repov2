"""
Root conftest — applied to all tests (unit and integration).

Sets FIELD_ENCRYPTION_KEY in the process environment before any app module
is imported.  The crypto module reads this via os.getenv at call-time, so
setting it here is sufficient even though config.settings is a cached
singleton (config never reads the encryption key directly).

The test key is 32 null bytes in base64. It is valid for AES-256-GCM and
will never appear in any production configuration.
"""

import base64
import os

_TEST_ENCRYPTION_KEY = base64.b64encode(b"\x00" * 32).decode()
os.environ.setdefault("FIELD_ENCRYPTION_KEY", _TEST_ENCRYPTION_KEY)
