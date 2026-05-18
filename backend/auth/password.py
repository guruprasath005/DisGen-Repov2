from passlib.context import CryptContext

_pwd_context = CryptContext(
    schemes=["argon2", "bcrypt"],
    deprecated=["bcrypt"],
    argon2__memory_cost=65536,  # 64 MB — hospital-grade, adds ~100 ms to login
    argon2__time_cost=3,
    argon2__parallelism=4,
    bcrypt__rounds=12,          # kept for legacy verification only
)


def hash_password(plaintext: str) -> str:
    return _pwd_context.hash(plaintext)


def verify_password(plaintext: str, hashed: str) -> bool:
    return _pwd_context.verify(plaintext, hashed)


def needs_rehash(hashed: str) -> bool:
    return _pwd_context.needs_update(hashed)
