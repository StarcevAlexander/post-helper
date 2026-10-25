package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
)

func TestGenerateCodeIsReadableAndUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		code, err := GenerateCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != 23 || strings.Count(code, "-") != 3 {
			t.Fatalf("code = %q", code)
		}
		if strings.ContainsAny(code, "01OIl") {
			t.Fatalf("ambiguous symbols in %q", code)
		}
		if seen[code] {
			t.Fatalf("duplicate code %q", code)
		}
		seen[code] = true
	}
}

func TestHashIgnoresCaseSpacesAndDashes(t *testing.T) {
	want := HashCode("ABCDE-FGHJK-LMNPQ-RSTUV")

	for _, variant := range []string{"abcde-fghjk-lmnpq-rstuv", " ABCDE FGHJK LMNPQ RSTUV ", "ABCDEFGHJKLMNPQRSTUV"} {
		if HashCode(variant) != want {
			t.Errorf("%q hashes differently", variant)
		}
	}
	if HashCode("ABCDE-FGHJK-LMNPQ-RSTUW") == want {
		t.Error("different codes must hash differently")
	}
}

func TestAuthenticate(t *testing.T) {
	store := accounts.NewMemory()
	code, _ := GenerateCode()
	master, err := store.CreateMaster(context.Background(), "Анна", HashCode(code))
	if err != nil {
		t.Fatal(err)
	}
	authenticator := New(store)
	ctx := context.Background()

	got, err := authenticator.Authenticate(ctx, strings.ToLower(code))
	if err != nil || got.MasterID != master.ID || got.Name != "Анна" {
		t.Errorf("master = %+v, %v", got, err)
	}
	for _, token := range []string{"", "wrong", "ABCDE-FGHJK-LMNPQ-RSTUV", "owner-secret-1"} {
		if _, err := authenticator.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("token %q must be unauthorized, got %v", token, err)
		}
	}

	if err := store.SetDisabled(ctx, master.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := authenticator.Authenticate(ctx, code); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("a disabled master must be refused, got %v", err)
	}
}

func TestAuthenticateRecordsLastSeen(t *testing.T) {
	store := accounts.NewMemory()
	code, _ := GenerateCode()
	master, _ := store.CreateMaster(context.Background(), "Анна", HashCode(code))

	New(store).Authenticate(context.Background(), code)

	list, _ := store.ListMasters(context.Background(), master.CreatedAt)
	if len(list) != 1 || list[0].LastSeenAt.IsZero() {
		t.Errorf("list = %+v", list)
	}
}

type failingStore struct {
	accounts.Store
	lookupErr error
	touches   int
}

func (f *failingStore) FindByCodeHash(ctx context.Context, hash string) (accounts.Master, error) {
	if f.lookupErr != nil {
		return accounts.Master{}, f.lookupErr
	}
	return f.Store.FindByCodeHash(ctx, hash)
}

func (f *failingStore) Touch(ctx context.Context, id string, at time.Time) error {
	f.touches++
	return f.Store.Touch(ctx, id, at)
}

func TestAuthenticateDistinguishesStoreErrors(t *testing.T) {
	boom := errors.New("connection refused")
	tests := []struct {
		name       string
		lookupErr  error
		wantStore  bool
		wantUnauth bool
	}{
		{"not found", accounts.ErrNotFound, false, true},
		{"wrapped not found", fmt.Errorf("find: %w", accounts.ErrNotFound), false, true},
		{"store failure", boom, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authenticator := New(&failingStore{Store: accounts.NewMemory(), lookupErr: tt.lookupErr})
			_, err := authenticator.Authenticate(context.Background(), "ABCDE-FGHJK-LMNPQ-RSTUV")
			if errors.Is(err, ErrStore) != tt.wantStore || errors.Is(err, ErrUnauthorized) != tt.wantUnauth {
				t.Errorf("err = %v", err)
			}
		})
	}
}

func TestAuthenticateTouchesOncePerInterval(t *testing.T) {
	store := &failingStore{Store: accounts.NewMemory()}
	code, _ := GenerateCode()
	if _, err := store.CreateMaster(context.Background(), "Анна", HashCode(code)); err != nil {
		t.Fatal(err)
	}
	authenticator := New(store)
	clock := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	authenticator.now = func() time.Time { return clock }
	ctx := context.Background()

	for range 5 {
		if _, err := authenticator.Authenticate(ctx, code); err != nil {
			t.Fatal(err)
		}
	}
	if store.touches != 1 {
		t.Fatalf("touches within interval = %d", store.touches)
	}
	clock = clock.Add(TouchInterval - time.Second)
	_, _ = authenticator.Authenticate(ctx, code)
	if store.touches != 1 {
		t.Fatalf("touches just before interval = %d", store.touches)
	}
	clock = clock.Add(time.Second)
	_, _ = authenticator.Authenticate(ctx, code)
	if store.touches != 2 {
		t.Fatalf("touches after interval = %d", store.touches)
	}
}
