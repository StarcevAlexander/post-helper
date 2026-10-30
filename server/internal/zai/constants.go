package zai

import "errors"

const (
	DefaultBaseURL        = "https://api.z.ai/api/paas/v4"
	FinishReasonSensitive = "sensitive"
	DetailLimit           = 300
	MaxResponseBytes      = 4 << 20
)

var (
	ErrRefused  = errors.New("zai request refused")
	ErrNoAnswer = errors.New("zai returned no answer")
)
