package yandex

import "time"

const (
	TokenURL           = "https://oauth.yandex.ru/token"
	InfoURL            = "https://login.yandex.ru/info?format=json"
	GrantAuthCode      = "authorization_code"
	InfoAuthScheme     = "OAuth "
	RequestTimeout     = 15 * time.Second
	MaxResponseBytes   = 1 << 20
	StatusBadRequest   = 400
	StatusUnauthorized = 401
)
