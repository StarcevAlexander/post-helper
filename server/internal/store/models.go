package store

import (
	"context"
	"time"
)

type Recorder interface {
	SaveError(source, message string, details any)
}

type Store interface {
	Recorder
	Purge(ctx context.Context, before time.Time) (int64, error)
	Close()
}
