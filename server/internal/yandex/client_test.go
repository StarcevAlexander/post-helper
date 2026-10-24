package yandex

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeYandex struct {
	tokenStatus int
	tokenBody   string
	infoStatus  int
	infoBody    string
	form        map[string]string
	infoAuth    string
}

func (f *fakeYandex) client(t *testing.T) *Client {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.form = map[string]string{}
		for key := range r.PostForm {
			f.form[key] = r.PostForm.Get(key)
		}
		w.WriteHeader(f.tokenStatus)
		_, _ = w.Write([]byte(f.tokenBody))
	})
	mux.HandleFunc("/info", func(w http.ResponseWriter, r *http.Request) {
		f.infoAuth = r.Header.Get("Authorization")
		w.WriteHeader(f.infoStatus)
		_, _ = w.Write([]byte(f.infoBody))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	client := NewClient("app-id", "app-secret")
	client.TokenURL = server.URL + "/token"
	client.InfoURL = server.URL + "/info"
	return client
}

func goodYandex() *fakeYandex {
	return &fakeYandex{
		tokenStatus: http.StatusOK,
		tokenBody:   `{"access_token":"tok","token_type":"bearer"}`,
		infoStatus:  http.StatusOK,
		infoBody:    `{"id":"42","client_id":"app-id","login":"anna","display_name":"Анна","real_name":"Анна Иванова","default_email":"anna@yandex.ru"}`,
	}
}

func TestExchangeReturnsTheProfile(t *testing.T) {
	fake := goodYandex()
	profile, err := fake.client(t).Exchange(context.Background(), "the-code", "https://app.example/")
	if err != nil {
		t.Fatal(err)
	}
	want := Profile{ID: "42", Login: "anna", DisplayName: "Анна", RealName: "Анна Иванова", Email: "anna@yandex.ru"}
	if profile != want {
		t.Errorf("profile = %+v", profile)
	}
	for key, value := range map[string]string{
		"grant_type": "authorization_code", "code": "the-code", "client_id": "app-id",
		"client_secret": "app-secret", "redirect_uri": "https://app.example/",
	} {
		if fake.form[key] != value {
			t.Errorf("form[%s] = %q, want %q", key, fake.form[key], value)
		}
	}
	if fake.infoAuth != "OAuth tok" {
		t.Errorf("info auth = %q", fake.infoAuth)
	}
}

func TestExchangeRefusals(t *testing.T) {
	cases := map[string]struct {
		mutate func(*fakeYandex)
		want   error
	}{
		"code refused":      {func(f *fakeYandex) { f.tokenStatus = http.StatusBadRequest }, ErrRejected},
		"no token":          {func(f *fakeYandex) { f.tokenBody = `{}` }, ErrRejected},
		"token refused":     {func(f *fakeYandex) { f.infoStatus = http.StatusUnauthorized }, ErrRejected},
		"other application": {func(f *fakeYandex) { f.infoBody = `{"id":"42","client_id":"someone-else"}` }, ErrRejected},
		"no user id":        {func(f *fakeYandex) { f.infoBody = `{"client_id":"app-id"}` }, ErrRejected},
		"yandex is down":    {func(f *fakeYandex) { f.tokenStatus = http.StatusBadGateway }, ErrUpstream},
		"garbage":           {func(f *fakeYandex) { f.tokenBody = `not json` }, ErrUpstream},
	}
	for name, tc := range cases {
		fake := goodYandex()
		tc.mutate(fake)
		if _, err := fake.client(t).Exchange(context.Background(), "c", ""); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", name, err, tc.want)
		}
	}
}
