package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"post-helper/server/internal/accounts"
)

type Identity struct {
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
	accounts accounts.Store
	now      func() time.Time
	mu       sync.Mutex
	touched  map[string]time.Time
}

func New(store accounts.Store) *Authenticator {
	return &Authenticator{accounts: store, now: time.Now, touched: make(map[string]time.Time)}
}

func (a *Authenticator) Authenticate(ctx context.Context, token string) (Identity, error) {
	if NormalizeCode(token) == "" {
		return Identity{}, ErrUnauthorized
	}
	master, err := a.accounts.FindByCodeHash(ctx, HashCode(token))
	if errors.Is(err, accounts.ErrNotFound) {
		return Identity{}, ErrUnauthorized
	}
	if err != nil {
		return Identity{}, fmt.Errorf("%w: %w", ErrStore, err)
	}
	if master.Disabled {
		return Identity{}, ErrUnauthorized
	}
	a.touch(ctx, master.ID)
	return Identity{MasterID: master.ID, Name: master.Name}, nil
}

func (a *Authenticator) touch(ctx context.Context, masterID string) {
	now := a.now()
	a.mu.Lock()
	last, seen := a.touched[masterID]
	due := !seen || now.Sub(last) >= TouchInterval
	if due {
		a.touched[masterID] = now
	}
	a.mu.Unlock()
	if !due {
		return
	}
	if err := a.accounts.Touch(ctx, masterID, now); err != nil {
		a.mu.Lock()
		delete(a.touched, masterID)
		a.mu.Unlock()
	}
}
