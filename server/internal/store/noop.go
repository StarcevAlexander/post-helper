package store

import (
	"context"
	"time"
)

type Noop struct{}

func (Noop) SaveError(string, string, any) {}
func (Noop) Close()                        {}

func (Noop) Purge(context.Context, time.Time) (int64, error) {
	return 0, nil
}

func timeAfter(d time.Duration) <-chan time.Time {
	return time.After(d)
}
