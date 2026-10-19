package store

import "time"

const (
	SourceApp        = "app"
	SourceClaudeCode = "claude-code"
)

const (
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

const (
	EventChatRequest      = "chat.request"
	EventHTTPRequest      = "http.request"
	EventIngest           = "ingest"
	ErrorSourceServer     = "server"
	ErrorSourceClient     = "client"
	queueSize             = 512
	writeTimeout          = 5 * time.Second
	readTimeout           = 10 * time.Second
	closeTimeout          = 8 * time.Second
	DefaultListLimit      = 100
	MaxListLimit          = 1000
	MaxStoredTextBytes    = 512 << 10
	MaxStoredMessageBytes = 8 << 10
)
