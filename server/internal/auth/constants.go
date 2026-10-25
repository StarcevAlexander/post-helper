package auth

import "time"

const (
	codeAlphabet   = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
	codeGroupSize  = 5
	codeGroupCount = 4
)

const TouchInterval = 5 * time.Minute
