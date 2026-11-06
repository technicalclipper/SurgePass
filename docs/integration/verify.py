# pip install "pyjwt[crypto]"
import jwt

JWKS = jwt.PyJWKClient("https://gate.example.com/.well-known/jwks.json")
AUDIENCE = "tickets.example.com"  # your own host


def surgepass(headers):
    """Pass details, or None when the request wasn't gated. Raises if the header is forged or expired."""
    token = headers.get("X-SurgePass-Assertion")
    if not token:
        return None
    if jwt.get_unverified_header(token).get("typ") != "assertion":
        raise jwt.InvalidTokenError("not a SurgePass assertion")
    key = JWKS.get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=["EdDSA"], issuer="surgepass", audience=AUDIENCE)
