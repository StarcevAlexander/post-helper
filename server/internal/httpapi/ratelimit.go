package httpapi

import (
	"slices"
	"time"
)

func newRateLimiter(max int, window time.Duration) *rateLimiter {
	return &rateLimiter{hits: make(map[string][]time.Time), max: max, window: window}
}

func (l *rateLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.swept) >= l.window {
		l.sweep(now)
	}
	if _, known := l.hits[key]; !known && len(l.hits) >= MaxLimiterKeys {
		clear(l.hits)
	}
	recent := l.fresh(l.hits[key], now)
	if len(recent) >= l.max {
		l.hits[key] = recent
		return false
	}
	l.hits[key] = append(recent, now)
	return true
}

func (l *rateLimiter) fresh(hits []time.Time, now time.Time) []time.Time {
	cutoff := now.Add(-l.window)
	return slices.DeleteFunc(hits, func(at time.Time) bool { return at.Before(cutoff) })
}

func (l *rateLimiter) sweep(now time.Time) {
	for key, hits := range l.hits {
		if kept := l.fresh(hits, now); len(kept) > 0 {
			l.hits[key] = kept
		} else {
			delete(l.hits, key)
		}
	}
	l.swept = now
}
