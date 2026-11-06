// com.nimbusds:nimbus-jose-jwt + com.google.crypto.tink:tink (Ed25519)
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.Ed25519Verifier;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.source.*;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.*;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import java.net.URL;
import java.util.Set;

public final class SurgePass {
  static final String JWKS_URL = "https://gate.example.com/.well-known/jwks.json";
  static final String AUDIENCE = "tickets.example.com"; // your own host

  private static final JWKSource<SecurityContext> KEYS;
  private static final DefaultJWTClaimsVerifier<SecurityContext> CLAIMS =
      new DefaultJWTClaimsVerifier<>(AUDIENCE, new JWTClaimsSet.Builder().issuer("surgepass").build(), Set.of("exp", "drop", "seats"));

  static {
    try {
      KEYS = JWKSourceBuilder.create(new URL(JWKS_URL)).build(); // cached, refreshed on key rotation
    } catch (Exception e) {
      throw new ExceptionInInitializerError(e);
    }
  }

  /** Pass details, or null when the request wasn't gated. Throws if the header is forged or expired. */
  public static JWTClaimsSet verify(String header) throws Exception {
    if (header == null) return null;
    SignedJWT jwt = SignedJWT.parse(header);
    if (!new JOSEObjectType("assertion").equals(jwt.getHeader().getType())) throw new JOSEException("not a SurgePass assertion");
    var key = KEYS.get(new JWKSelector(JWKMatcher.forJWSHeader(jwt.getHeader())), null);
    if (key.isEmpty() || !jwt.verify(new Ed25519Verifier(key.get(0).toOctetKeyPair()))) throw new JOSEException("bad signature");
    CLAIMS.verify(jwt.getJWTClaimsSet(), null);
    return jwt.getJWTClaimsSet();
  }
}
