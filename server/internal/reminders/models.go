package reminders

import (
	"context"
	"time"
)

type Reminder struct {
	Key   string
	At    time.Time
	Title string
	Body  string
	URL   string
}

type Sent interface {
	Has(ctx context.Context, masterID, key string) (bool, error)
	Mark(ctx context.Context, masterID, key string, at time.Time) error
	Forget(ctx context.Context, before time.Time) error
}

type calendar struct {
	StartedOn string `json:"startedOn"`
	Schedule  struct {
		Slots []struct {
			Weekday int    `json:"weekday"`
			Time    string `json:"time"`
		} `json:"slots"`
	} `json:"schedule"`
	Items []struct {
		ID     string `json:"id"`
		Date   string `json:"date"`
		Time   string `json:"time"`
		Format string `json:"format"`
		Idea   string `json:"idea"`
		Done   bool   `json:"done"`
	} `json:"items"`
}
