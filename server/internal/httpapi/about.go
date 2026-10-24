package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/intake"
)

func aboutMaster(ctx context.Context, people accounts.Store, intakes intake.Store, masterID string) string {
	var text strings.Builder
	text.WriteString("Сведения о мастере:\n")
	if master, err := people.GetMaster(ctx, masterID); err == nil {
		if name := strings.TrimSpace(master.Name); name != "" {
			fmt.Fprintf(&text, "Имя: %s\n", name)
		}
		if city := strings.TrimSpace(master.City); city != "" {
			fmt.Fprintf(&text, "Населённый пункт: %s\n", city)
		}
	}
	if request, err := intakes.Latest(ctx, masterID); err == nil {
		goals := make([]string, 0, len(request.Goals))
		for _, goal := range request.Goals {
			if label := intake.GoalLabel(goal); label != "" {
				goals = append(goals, label)
			}
		}
		if len(goals) > 0 {
			fmt.Fprintf(&text, "Цели: %s\n", strings.Join(goals, "; "))
		}
		if note := strings.TrimSpace(request.Note); note != "" {
			fmt.Fprintf(&text, "Пожелания: %s\n", note)
		}
	}
	if state, err := people.LoadState(ctx, masterID); err == nil {
		var stored struct {
			Strategy struct {
				Positioning string `json:"positioning"`
			} `json:"strategy"`
		}
		if json.Unmarshal(state.Data, &stored) == nil {
			if positioning := strings.TrimSpace(stored.Strategy.Positioning); positioning != "" {
				fmt.Fprintf(&text, "Позиционирование: %s\n", positioning)
			}
		}
	}
	return text.String()
}
