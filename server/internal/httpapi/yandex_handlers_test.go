package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/yandex"
)

const yandexOrigin = "https://app.example"

type fakeExchanger struct {
	profile yandex.Profile
	err     error
	calls   int
	code    string
	redir   string
}

func (f *fakeExchanger) Exchange(_ context.Context, code, redirectURI string) (yandex.Profile, error) {
	f.calls++
	f.code, f.redir = code, redirectURI
	return f.profile, f.err
}

type yandexFixture struct {
	handler  http.Handler
	store    *accounts.Memory
	exchange *fakeExchanger
}

func newYandexFixture(t *testing.T) *yandexFixture {
	t.Helper()
	fixture := &yandexFixture{
		store:    accounts.NewMemory(),
		exchange: &fakeExchanger{profile: yandex.Profile{ID: "42", Login: "anna", RealName: "Анна Иванова"}},
	}
	fixture.handler = NewHandler(Options{
		Accounts:       fixture.store,
		DailyAILimit:   5,
		Password:       testPassword,
		AllowedOrigins: []string{yandexOrigin},
		Yandex:         fixture.exchange,
		YandexClientID: "app-id",
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return fixture
}

func (f *yandexFixture) call(method, path, token, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

func (f *yandexFixture) signIn(t *testing.T) SessionResponse {
	t.Helper()
	response := f.call(http.MethodPost, "/api/auth/yandex", "", `{"code":"abc","redirectUri":"`+yandexOrigin+`/"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("sign in = %d %s", response.Code, response.Body)
	}
	var session SessionResponse
	if err := json.Unmarshal(response.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	return session
}

func TestAuthConfigIsPublic(t *testing.T) {
	fixture := newYandexFixture(t)

	response := fixture.call(http.MethodGet, "/api/auth/config", "", "")

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"yandexClientId":"app-id"`) {
		t.Errorf("config = %d %s", response.Code, response.Body)
	}
}

func TestYandexIsOffWithoutKeys(t *testing.T) {
	handler := NewHandler(Options{Accounts: accounts.NewMemory(), Password: testPassword, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})

	config := httptest.NewRecorder()
	handler.ServeHTTP(config, httptest.NewRequest(http.MethodGet, "/api/auth/config", nil))
	login := httptest.NewRecorder()
	handler.ServeHTTP(login, httptest.NewRequest(http.MethodPost, "/api/auth/yandex", strings.NewReader(`{"code":"a","redirectUri":"x"}`)))

	if !strings.Contains(config.Body.String(), `"yandexClientId":""`) || login.Code != http.StatusNotFound {
		t.Errorf("config = %s, login = %d", config.Body, login.Code)
	}
}

func TestYandexSignInRegistersANewMasterAndTheTokenWorks(t *testing.T) {
	fixture := newYandexFixture(t)

	session := fixture.signIn(t)

	if session.Name != "Анна Иванова" || session.Token == "" {
		t.Fatalf("session = %+v", session)
	}
	if fixture.exchange.code != "abc" || fixture.exchange.redir != yandexOrigin+"/" {
		t.Errorf("exchange got %q %q", fixture.exchange.code, fixture.exchange.redir)
	}
	me := fixture.call(http.MethodGet, "/api/me", session.Token, "")
	for _, want := range []string{`"role":"master"`, `"name":"Анна Иванова"`, `"providers":["yandex"]`} {
		if !strings.Contains(me.Body.String(), want) {
			t.Errorf("me %s lacks %s", me.Body, want)
		}
	}
}

func TestYandexSignInAgainReachesTheSameMasterWithAnotherToken(t *testing.T) {
	fixture := newYandexFixture(t)

	first := fixture.signIn(t)
	second := fixture.signIn(t)

	if first.Token == second.Token {
		t.Fatal("every sign-in must get its own token")
	}
	masters, _ := fixture.store.ListMasters(context.Background(), dayStart(time.Now()))
	if len(masters) != 1 {
		t.Fatalf("masters = %d, want 1", len(masters))
	}
	for _, token := range []string{first.Token, second.Token} {
		if got := fixture.call(http.MethodGet, "/api/me", token, "").Code; got != http.StatusOK {
			t.Errorf("token refused: %d", got)
		}
	}
}

func TestYandexSignInRefusals(t *testing.T) {
	cases := map[string]struct {
		body   string
		mutate func(*yandexFixture)
		want   int
	}{
		"bad json":         {`{`, nil, http.StatusBadRequest},
		"no code":          {`{"code":"  ","redirectUri":"` + yandexOrigin + `/"}`, nil, http.StatusBadRequest},
		"foreign redirect": {`{"code":"a","redirectUri":"https://evil.example/"}`, nil, http.StatusBadRequest},
		"not a url":        {`{"code":"a","redirectUri":"javascript:alert(1)"}`, nil, http.StatusBadRequest},
		"rejected":         {`{"code":"a","redirectUri":"` + yandexOrigin + `/"}`, func(f *yandexFixture) { f.exchange.err = yandex.ErrRejected }, http.StatusForbidden},
		"yandex down":      {`{"code":"a","redirectUri":"` + yandexOrigin + `/"}`, func(f *yandexFixture) { f.exchange.err = yandex.ErrUpstream }, http.StatusBadGateway},
	}
	for name, tc := range cases {
		fixture := newYandexFixture(t)
		if tc.mutate != nil {
			tc.mutate(fixture)
		}
		if got := fixture.call(http.MethodPost, "/api/auth/yandex", "", tc.body).Code; got != tc.want {
			t.Errorf("%s: status = %d, want %d", name, got, tc.want)
		}
	}
}

func TestYandexSignInRefusesADisabledMaster(t *testing.T) {
	fixture := newYandexFixture(t)
	fixture.signIn(t)
	masters, _ := fixture.store.ListMasters(context.Background(), dayStart(time.Now()))
	_ = fixture.store.SetDisabled(context.Background(), masters[0].ID, true)

	response := fixture.call(http.MethodPost, "/api/auth/yandex", "", `{"code":"abc","redirectUri":"`+yandexOrigin+`/"}`)

	if response.Code != http.StatusForbidden {
		t.Errorf("status = %d", response.Code)
	}
}

func TestYandexSignInIsRateLimited(t *testing.T) {
	fixture := newYandexFixture(t)
	body := `{"code":"abc","redirectUri":"` + yandexOrigin + `/"}`

	var last int
	for range SignInLimitPerWindow + 1 {
		last = fixture.call(http.MethodPost, "/api/auth/yandex", "", body).Code
	}

	if last != http.StatusTooManyRequests {
		t.Errorf("last status = %d", last)
	}
}

func TestLinkYandexToAnExistingMaster(t *testing.T) {
	fixture := newYandexFixture(t)
	master, _ := fixture.store.CreateMaster(context.Background(), "Анна", "hash-of-password")
	code := "ABCDE-FGHJK-LMNPQ-RSTUV"
	_ = fixture.store.AddToken(context.Background(), master.ID, auth.HashCode(code))

	linked := fixture.call(http.MethodPost, "/api/me/yandex", code, `{"code":"abc","redirectUri":"`+yandexOrigin+`/"}`)
	again := fixture.call(http.MethodPost, "/api/auth/yandex", "", `{"code":"abc","redirectUri":"`+yandexOrigin+`/"}`)

	if linked.Code != http.StatusOK || !strings.Contains(linked.Body.String(), `"providers":["yandex"]`) {
		t.Fatalf("link = %d %s", linked.Code, linked.Body)
	}
	if !strings.Contains(again.Body.String(), `"name":"Анна"`) {
		t.Errorf("sign in after linking must reach the same master: %s", again.Body)
	}
}

func TestLinkYandexRefusals(t *testing.T) {
	fixture := newYandexFixture(t)
	other := fixture.signIn(t)
	master, _ := fixture.store.CreateMaster(context.Background(), "Мария", "hash-2")
	code := "BCDEF-GHJKL-MNPQR-STUVW"
	_ = fixture.store.AddToken(context.Background(), master.ID, auth.HashCode(code))
	body := `{"code":"abc","redirectUri":"` + yandexOrigin + `/"}`

	cases := map[string]struct {
		token string
		want  int
	}{
		"already linked to another master": {code, http.StatusConflict},
		"no token":                         {"", http.StatusUnauthorized},
		"owner":                            {testPassword, http.StatusForbidden},
	}
	for name, tc := range cases {
		if got := fixture.call(http.MethodPost, "/api/me/yandex", tc.token, body).Code; got != tc.want {
			t.Errorf("%s: status = %d, want %d", name, got, tc.want)
		}
	}
	if got := fixture.call(http.MethodPost, "/api/me/yandex", other.Token, body).Code; got != http.StatusOK {
		t.Errorf("linking the same identity to its own master must be a no-op conflict-free call, got %d", got)
	}
}
