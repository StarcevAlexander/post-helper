package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"post-helper/server/internal/accounts"
)

const (
	codeAlphabet   = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
	codeGroupSize  = 5
	codeGroupCount = 4
)

type Identity struct {
	Admin    bool
	MasterID string
	Name     string
}

type contextKey struct{}

func WithIdentity(ctx context.Context, identity Identity) context.Context {
	return context.WithValue(ctx, contextKey{}, identity)
}

func FromContext(ctx context.Context) (Identity, bool) {
	identity, ok := ctx.Value(contextKey{}).(Identity)
	return identity, ok
}

func NormalizeCode(code string) string {
	var normalized strings.Builder
	for _, symbol := range strings.ToUpper(code) {
		if strings.ContainsRune(codeAlphabet, symbol) {
			normalized.WriteRune(symbol)
		}
	}
	return normalized.String()
}

func HashCode(code string) string {
	sum := sha256.Sum256([]byte(NormalizeCode(code)))
	return hex.EncodeToString(sum[:])
}

func GenerateCode() (string, error) {
	total := codeGroupSize * codeGroupCount
	raw := make([]byte, total)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	var code strings.Builder
	for i, value := range raw {
		if i > 0 && i%codeGroupSize == 0 {
			code.WriteByte('-')
		}
		code.WriteByte(codeAlphabet[int(value)%len(codeAlphabet)])
	}
	return code.String(), nil
}

type Authenticator struct {
	adminHash [32]byte
	accounts  accounts.Store
}

func New(adminPassword string, store accounts.Store) *Authenticator {
	return &Authenticator{adminHash: sha256.Sum256([]byte(adminPassword)), accounts: store}
}

func (a *Authenticator) Authenticate(ctx context.Context, token string) (Identity, bool) {
	provided := sha256.Sum256([]byte(token))
	if subtle.ConstantTimeCompare(provided[:], a.adminHash[:]) == 1 {
		return Identity{Admin: true, Name: "owner"}, true
	}
	if NormalizeCode(token) == "" {
		return Identity{}, false
	}
	master, err := a.accounts.FindByCodeHash(ctx, HashCode(token))
	if err != nil {
		if !errors.Is(err, accounts.ErrNotFound) {
			return Identity{}, false
		}
		return Identity{}, false
	}
	if master.Disabled {
		return Identity{}, false
	}
	_ = a.accounts.Touch(ctx, master.ID, time.Now())
	return Identity{MasterID: master.ID, Name: master.Name}, true
}
