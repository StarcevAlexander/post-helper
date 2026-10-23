package push

import (
	"context"
	"errors"
	"time"
)

var (
	ErrInvalidSubscription = errors.New("invalid push subscription")
	ErrInvalidMessage      = errors.New("invalid push message")
)

type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

type Message struct {
	Title string
	Body  string
	URL   string
}

type Store interface {
	Save(ctx context.Context, masterID string, subscription Subscription, now time.Time) error
	Remove(ctx context.Context, masterID, endpoint string) error
	RemoveEndpoint(ctx context.Context, endpoint string) error
	List(ctx context.Context, masterID string) ([]Subscription, error)
}

type Sender interface {
	Send(ctx context.Context, masterID string, message Message) (int, error)
	PublicKey() string
}

type payload struct {
	Notification notification `json:"notification"`
}

type notification struct {
	Title string           `json:"title"`
	Body  string           `json:"body"`
	Icon  string           `json:"icon"`
	Data  notificationData `json:"data"`
}

type notificationData struct {
	OnActionClick map[string]actionClick `json:"onActionClick"`
}

type actionClick struct {
	Operation string `json:"operation"`
	URL       string `json:"url"`
}
