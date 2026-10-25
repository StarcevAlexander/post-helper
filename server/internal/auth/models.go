package auth

import "errors"

var (
	ErrUnauthorized = errors.New("unknown or disabled access code")
	ErrStore        = errors.New("access code lookup failed")
)
