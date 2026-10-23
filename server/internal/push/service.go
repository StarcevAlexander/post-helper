package push

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type Service struct {
	store      Store
	publicKey  string
	privateKey string
	subject    string
	client     *http.Client
}

func New(store Store, publicKey, privateKey, subject string) *Service {
	if publicKey == "" || privateKey == "" {
		return nil
	}
	return &Service{
		store:      store,
		publicKey:  publicKey,
		privateKey: privateKey,
		subject:    subject,
		client:     &http.Client{Timeout: SendTimeout},
	}
}

func (s *Service) PublicKey() string {
	return s.publicKey
}

func (s *Service) Send(ctx context.Context, masterID string, message Message) (int, error) {
	subscriptions, err := s.store.List(ctx, masterID)
	if err != nil {
		return 0, err
	}
	body, err := json.Marshal(payload{Notification: notification{
		Title: message.Title,
		Body:  message.Body,
		Icon:  IconPath,
		Data: notificationData{OnActionClick: map[string]actionClick{
			ActionDefault: {Operation: ActionOpen, URL: message.URL},
		}},
	}})
	if err != nil {
		return 0, err
	}

	delivered := 0
	for _, subscription := range subscriptions {
		response, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
			Endpoint: subscription.Endpoint,
			Keys:     webpush.Keys{P256dh: subscription.P256dh, Auth: subscription.Auth},
		}, &webpush.Options{
			HTTPClient:      s.client,
			Subscriber:      s.subject,
			VAPIDPublicKey:  s.publicKey,
			VAPIDPrivateKey: s.privateKey,
			TTL:             MessageTTLSeconds,
			Urgency:         webpush.UrgencyHigh,
		})
		if err != nil {
			slog.Warn("push send failed", slog.String("master", masterID), slog.Any("error", err))
			continue
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
		_ = response.Body.Close()
		switch {
		case response.StatusCode >= 200 && response.StatusCode < 300:
			delivered++
		case response.StatusCode == StatusGone || response.StatusCode == StatusNotFound:
			if err := s.store.RemoveEndpoint(ctx, subscription.Endpoint); err != nil {
				slog.Warn("push prune failed", slog.String("master", masterID), slog.Any("error", err))
			}
		default:
			slog.Warn("push rejected", slog.String("master", masterID), slog.Int("status", response.StatusCode))
		}
	}
	return delivered, nil
}
