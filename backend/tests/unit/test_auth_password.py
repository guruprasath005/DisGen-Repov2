"""
Unit tests for bcrypt password hashing (auth/password.py).

Pure function tests — no DB, no Redis, no network.
"""

from auth.password import hash_password, verify_password


def test_hash_produces_bcrypt_string():
    hashed = hash_password("MySecurePass123!")
    assert hashed.startswith("$2b$") or hashed.startswith("$2a$")


def test_correct_password_verifies():
    plain = "ClinicalSecret!99"
    assert verify_password(plain, hash_password(plain))


def test_wrong_password_rejected():
    hashed = hash_password("correct_password")
    assert not verify_password("wrong_password", hashed)


def test_empty_password_rejected():
    hashed = hash_password("non_empty")
    assert not verify_password("", hashed)


def test_similar_password_rejected():
    hashed = hash_password("Password1")
    assert not verify_password("Password2", hashed)


def test_hashes_are_salted():
    # Same plaintext hashed twice must produce different hashes (bcrypt salt).
    plain = "samepassword"
    h1 = hash_password(plain)
    h2 = hash_password(plain)
    assert h1 != h2


def test_both_hashes_verify():
    plain = "samepassword"
    h1 = hash_password(plain)
    h2 = hash_password(plain)
    assert verify_password(plain, h1)
    assert verify_password(plain, h2)
