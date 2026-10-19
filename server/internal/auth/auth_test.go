package auth

import (
	"context"
	"strings"
	"testing"

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
	authenticator := New("owner-secret-1", store)
	ctx := context.Background()

	admin, ok := authenticator.Authenticate(ctx, "owner-secret-1")
	if !ok || !admin.Admin {
		t.Errorf("admin = %+v, %v", admin, ok)
	}
	got, ok := authenticator.Authenticate(ctx, strings.ToLower(code))
	if !ok || got.Admin || got.MasterID != master.ID || got.Name != "Анна" {
		t.Errorf("master = %+v, %v", got, ok)
	}
	for _, token := range []string{"", "wrong", "ABCDE-FGHJK-LMNPQ-RSTUV", "owner-secret-2"} {
		if _, ok := authenticator.Authenticate(ctx, token); ok {
			t.Errorf("token %q must be refused", token)
		}
	}

	if err := store.SetDisabled(ctx, master.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, ok := authenticator.Authenticate(ctx, code); ok {
		t.Error("a disabled master must be refused")
	}
}

func TestAuthenticateRecordsLastSeen(t *testing.T) {
	store := accounts.NewMemory()
	code, _ := GenerateCode()
	master, _ := store.CreateMaster(context.Background(), "Анна", HashCode(code))

	New("owner-secret-1", store).Authenticate(context.Background(), code)

	list, _ := store.ListMasters(context.Background(), master.CreatedAt)
	if len(list) != 1 || list[0].LastSeenAt.IsZero() {
		t.Errorf("list = %+v", list)
	}
}
