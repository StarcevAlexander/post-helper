package reminders

import (
	"context"
	"log/slog"
	"runtime/debug"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/push"
)

type Scheduler struct {
	Accounts accounts.Store
	Sender   push.Sender
	Sent     Sent
	Location *time.Location
	Logger   *slog.Logger
	Now      func() time.Time
}

func (s *Scheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(Tick)
	defer ticker.Stop()
	for {
		s.Tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Scheduler) Tick(ctx context.Context) {
	now := s.now()
	masters, err := s.Accounts.ListMasters(ctx, now)
	if err != nil {
		s.Logger.Error("reminders: list masters failed", slog.Any("error", err))
		return
	}
	for _, master := range masters {
		if !master.Disabled {
			s.remindSafely(ctx, master.Master, now)
		}
	}
	if err := s.Sent.Forget(ctx, now.Add(-ForgetAfter)); err != nil {
		s.Logger.Error("reminders: forget old failed", slog.Any("error", err))
	}
}

func (s *Scheduler) remindSafely(ctx context.Context, master accounts.Master, now time.Time) {
	defer func() {
		if recovered := recover(); recovered != nil {
			s.Logger.Error("reminders: panic while reminding a master",
				slog.String("master", master.ID),
				slog.Any("panic", recovered),
				slog.String("stack", string(debug.Stack())),
			)
		}
	}()
	s.remind(ctx, master, now)
}

func (s *Scheduler) remind(ctx context.Context, master accounts.Master, now time.Time) {
	masterID := master.ID
	state, err := s.Accounts.LoadState(ctx, masterID)
	if err != nil || len(state.Data) == 0 {
		return
	}
	for _, reminder := range Due(state.Data, now, s.locationOf(master)) {
		already, err := s.Sent.Has(ctx, masterID, reminder.Key)
		if err != nil {
			s.Logger.Error("reminders: check failed", slog.Any("error", err))
			continue
		}
		if already {
			continue
		}
		sendCtx, cancel := context.WithTimeout(ctx, SendTimeout)
		sent, err := s.Sender.Send(sendCtx, masterID, push.Message{Title: reminder.Title, Body: reminder.Body, URL: reminder.URL, Topic: reminder.Topic})
		cancel()
		if err != nil {
			s.Logger.Error("reminders: push failed", slog.String("key", reminder.Key), slog.Any("error", err))
			continue
		}
		if sent == 0 {
			s.Logger.Warn("reminders: no device received the push, will retry inside the window", slog.String("key", reminder.Key))
			continue
		}
		if err := s.Sent.Mark(ctx, masterID, reminder.Key, now); err != nil {
			s.Logger.Error("reminders: mark failed", slog.Any("error", err))
			continue
		}
		s.Logger.Info("reminder sent", slog.String("key", reminder.Key), slog.Int("devices", sent))
	}
}

func (s *Scheduler) locationOf(master accounts.Master) *time.Location {
	if master.Timezone != "" {
		if location, err := time.LoadLocation(master.Timezone); err == nil {
			return location
		}
		s.Logger.Warn("reminders: the time zone of the master is not known, the server one is used", slog.String("zone", master.Timezone))
	}
	return s.Location
}

func (s *Scheduler) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}
