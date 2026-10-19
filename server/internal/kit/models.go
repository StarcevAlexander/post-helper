package kit

import (
	"context"

	"post-helper/server/internal/strategy"
)

type Frame struct {
	Visual  string `json:"visual"`
	Overlay string `json:"overlay"`
}

type Kit struct {
	Shots    []string `json:"shots"`
	Frames   []Frame  `json:"frames"`
	Caption  string   `json:"caption"`
	Hashtags []string `json:"hashtags"`
	Tip      string   `json:"tip"`
}

type Request struct {
	Profile     strategy.Profile
	Positioning string
	Format      string
	Pillar      string
	Idea        string
}

type Generator interface {
	Generate(ctx context.Context, request Request) (Kit, error)
}
