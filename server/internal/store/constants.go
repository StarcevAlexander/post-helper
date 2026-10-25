package store

import "time"

const (
	ErrorSourceServer  = "server"
	ErrorSourceClient  = "client"
	queueSize          = 512
	writeTimeout       = 5 * time.Second
	closeTimeout       = 8 * time.Second
	MaxStoredTextBytes = 512 << 10
	LogRetentionDays   = 90
)

var purgeStatements = []string{
	`DELETE FROM error_log WHERE created_at < $1`,
	`DELETE FROM events WHERE created_at < $1`,
}
