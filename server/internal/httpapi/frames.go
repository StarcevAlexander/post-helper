package httpapi

import (
	"context"
	"encoding/json"
	"strings"

	"post-helper/server/internal/accounts"
)

type storedKits struct {
	Kits map[string]struct {
		Kit struct {
			Frames []struct {
				Visual  string `json:"visual"`
				Overlay string `json:"overlay"`
			} `json:"frames"`
		} `json:"kit"`
	} `json:"kits"`
}

func framesOf(ctx context.Context, people accounts.Store, masterID, key string) []string {
	state, err := people.LoadState(ctx, masterID)
	if err != nil || len(state.Data) == 0 {
		return nil
	}
	var parsed storedKits
	if json.Unmarshal(state.Data, &parsed) != nil {
		return nil
	}
	frames := []string{}
	for _, frame := range parsed.Kits[key].Kit.Frames {
		line := strings.TrimSpace(frame.Visual)
		if overlay := strings.TrimSpace(frame.Overlay); overlay != "" {
			line += " Текст на кадре: " + overlay
		}
		if line != "" {
			frames = append(frames, line)
		}
	}
	return frames
}
