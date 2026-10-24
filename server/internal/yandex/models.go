package yandex

import (
	"context"
	"errors"
)

var (
	ErrRejected = errors.New("yandex rejected the code")
	ErrUpstream = errors.New("yandex is unavailable")
)

type Profile struct {
	ID          string
	Login       string
	DisplayName string
	RealName    string
	Email       string
}

type Exchanger interface {
	Exchange(ctx context.Context, code, redirectURI string) (Profile, error)
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
}

type infoResponse struct {
	ID           string `json:"id"`
	ClientID     string `json:"client_id"`
	Login        string `json:"login"`
	DisplayName  string `json:"display_name"`
	RealName     string `json:"real_name"`
	DefaultEmail string `json:"default_email"`
}
