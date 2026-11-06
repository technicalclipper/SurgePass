// go get github.com/lestrrat-go/jwx/v2
package surgepass

import (
	"context"
	"errors"
	"net/http"

	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jws"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

const jwksURL = "https://gate.example.com/.well-known/jwks.json"
const audience = "tickets.example.com" // your own host

var keys = jwk.NewCache(context.Background())

func init() { _ = keys.Register(jwksURL) }

// Verify returns the pass details, or nil when the request wasn't gated. Errors if forged or expired.
func Verify(r *http.Request) (jwt.Token, error) {
	raw := []byte(r.Header.Get("X-SurgePass-Assertion"))
	if len(raw) == 0 {
		return nil, nil
	}
	if msg, err := jws.Parse(raw); err != nil || msg.Signatures()[0].ProtectedHeaders().Type() != "assertion" {
		return nil, errors.New("not a SurgePass assertion")
	}
	set, err := keys.Get(r.Context(), jwksURL)
	if err != nil {
		return nil, err
	}
	return jwt.Parse(raw, jwt.WithKeySet(set), jwt.WithIssuer("surgepass"), jwt.WithAudience(audience), jwt.WithValidate(true))
}
