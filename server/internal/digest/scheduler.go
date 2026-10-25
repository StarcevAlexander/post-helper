package digest

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/push"
)

type Scheduler struct {
	Accounts accounts.Store
	Pushes   push.Store
	Intakes  intake.Store
	Notifier intake.Notifier
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
	s.remind(ctx, now)
	if now.Weekday() != Weekday || now.Hour() < Hour {
		return
	}
	key := weekKey(now)
	already, err := s.Sent.Has(ctx, key)
	if err != nil {
		s.Logger.Error("digest: check failed", slog.Any("error", err))
		return
	}
	if already {
		return
	}
	if _, err := s.Send(ctx); err != nil {
		s.Logger.Error("digest: send failed", slog.Any("error", err))
		return
	}
	if err := s.Sent.Mark(ctx, key, now); err != nil {
		s.Logger.Error("digest: mark failed", slog.Any("error", err))
	}
}

func (s *Scheduler) Send(ctx context.Context) (string, error) {
	report, err := s.Build(ctx)
	if err != nil {
		return "", err
	}
	text := Render(report)
	sendCtx, cancel := context.WithTimeout(ctx, SendTimeout)
	defer cancel()
	if err := s.Notifier.Notify(sendCtx, text); err != nil {
		return "", err
	}
	s.Logger.Info("digest sent", slog.Int("masters", len(report.Masters)))
	return text, nil
}

func (s *Scheduler) Build(ctx context.Context) (Report, error) {
	now := s.now()
	masters, err := s.Accounts.ListMasters(ctx, now)
	if err != nil {
		return Report{}, err
	}
	report := Report{Date: headerDate(now)}
	for _, master := range masters {
		if master.Disabled {
			continue
		}
		row := s.row(ctx, master.Master, now)
		if row.HasPlan {
			report.WithPlan++
		}
		report.Masters = append(report.Masters, row)
	}
	return report, nil
}

func (s *Scheduler) row(ctx context.Context, master accounts.Master, now time.Time) MasterRow {
	today := now.In(s.locationOf(master))
	row := MasterRow{Name: master.Name, City: master.City}
	if state, err := s.Accounts.LoadState(ctx, master.ID); err == nil && len(state.Data) > 0 {
		if planned, ok := rowFromState(state.Data, today); ok {
			planned.Name, planned.City = row.Name, row.City
			row = planned
		}
	}
	if s.Pushes != nil {
		if subscriptions, err := s.Pushes.List(ctx, master.ID); err == nil {
			row.Pushes = len(subscriptions) > 0
		}
	}
	if master.LastSeenAt.IsZero() {
		row.NeverSeen = true
	} else {
		row.LastSeenDays = int(startOfDay(today).Sub(startOfDay(master.LastSeenAt.In(today.Location()))).Hours() / 24)
	}
	if s.Intakes != nil {
		if request, err := s.Intakes.Latest(ctx, master.ID); err == nil && request.Status == intake.StatusNew {
			row.Waiting = LineWaitingPlan
			if request.Review {
				row.Waiting = LineWaitingWork
			}
			row.WaitingSince = request.UpdatedAt.In(today.Location()).Format(DateLayout)
		} else if err != nil && !errors.Is(err, intake.ErrNotFound) {
			s.Logger.Warn("digest: intake lookup failed", slog.String("master", master.ID), slog.Any("error", err))
		}
	}
	return row
}

func (s *Scheduler) locationOf(master accounts.Master) *time.Location {
	if master.Timezone != "" {
		if location, err := time.LoadLocation(master.Timezone); err == nil {
			return location
		}
	}
	return s.location()
}

func (s *Scheduler) location() *time.Location {
	if s.Location != nil {
		return s.Location
	}
	return time.Local
}

func (s *Scheduler) now() time.Time {
	if s.Now != nil {
		return s.Now().In(s.location())
	}
	return time.Now().In(s.location())
}

func (s *Scheduler) remind(ctx context.Context, now time.Time) {
	if s.Intakes == nil || now.Hour() < RemindFromHour || now.Hour() >= RemindToHour {
		return
	}
	key := dayKey(now)
	already, err := s.Sent.Has(ctx, key)
	if err != nil {
		s.Logger.Error("waiting requests: check failed", slog.Any("error", err))
		return
	}
	if already {
		return
	}
	waiting, err := s.Waiting(ctx, now)
	if err != nil {
		s.Logger.Error("waiting requests: list failed", slog.Any("error", err))
		return
	}
	if len(waiting) == 0 {
		return
	}
	sendCtx, cancel := context.WithTimeout(ctx, SendTimeout)
	defer cancel()
	if err := s.Notifier.Notify(sendCtx, RenderWaiting(waiting, now)); err != nil {
		s.Logger.Error("waiting requests: send failed", slog.Any("error", err))
		return
	}
	s.Logger.Info("waiting requests reminder sent", slog.Int("requests", len(waiting)))
	if err := s.Sent.Mark(ctx, key, now); err != nil {
		s.Logger.Error("waiting requests: mark failed", slog.Any("error", err))
	}
}

func (s *Scheduler) Waiting(ctx context.Context, now time.Time) ([]WaitingRow, error) {
	requests, err := s.Intakes.List(ctx, intake.StatusNew, MaxMasters)
	if err != nil {
		return nil, err
	}
	rows := make([]WaitingRow, 0, len(requests))
	for _, request := range requests {
		age := now.Sub(request.UpdatedAt)
		if age < RemindAfter {
			continue
		}
		master, err := s.Accounts.GetMaster(ctx, request.MasterID)
		if err != nil {
			s.Logger.Warn("waiting requests: master lookup failed", slog.String("master", request.MasterID), slog.Any("error", err))
			continue
		}
		if master.Disabled {
			continue
		}
		rows = append(rows, WaitingRow{
			MasterID: master.ID, Name: master.Name, City: master.City, Review: request.Review,
			Since: request.UpdatedAt.In(s.locationOf(master)), Age: age,
		})
	}
	return rows, nil
}
