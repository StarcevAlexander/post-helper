package push

import "time"

const (
	MaxSubscriptionsPerMaster = 10
	MaxEndpointLength         = 2048
	MaxKeyLength              = 256
	SendTimeout               = 15 * time.Second
	MessageTTLSeconds         = 86400
	DefaultURL                = "./"
	ActionOpen                = "navigateLastFocusedOrOpen"
	ActionDefault             = "default"
	IconPath                  = "icons/icon-192x192.png"
	MaxTitleRunes             = 80
	MaxBodyRunes              = 300
	MaxURLLength              = 300
)

const (
	StatusGone     = 410
	StatusNotFound = 404
)
