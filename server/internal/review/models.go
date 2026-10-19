package review

import (
	"context"

	"post-helper/server/internal/strategy"
)

type Item struct {
	Format string `json:"format"`
	Pillar string `json:"pillar"`
	Idea   string `json:"idea"`
	Done   bool   `json:"done"`
}

type Pillar struct {
	Title string   `json:"title"`
	Ideas []string `json:"ideas"`
}

type Results struct {
	Inquiries *int   `json:"inquiries"`
	BestIdea  string `json:"bestIdea"`
	Hard      string `json:"hard"`
}

type Request struct {
	Profile     strategy.Profile `json:"profile"`
	Positioning string           `json:"positioning"`
	Cadence     strategy.Cadence `json:"cadence"`
	Pillars     []Pillar         `json:"pillars"`
	Items       []Item           `json:"items"`
	Results     Results          `json:"results"`
}

type NewIdeas struct {
	Pillar string   `json:"pillar"`
	Ideas  []string `json:"ideas"`
}

type Review struct {
	Headline     string           `json:"headline"`
	WhatWorked   []string         `json:"whatWorked"`
	WhatToChange []string         `json:"whatToChange"`
	NextFocus    string           `json:"nextFocus"`
	Cadence      strategy.Cadence `json:"cadence"`
	NewIdeas     []NewIdeas       `json:"newIdeas"`
}

type Generator interface {
	Generate(ctx context.Context, request Request) (Review, error)
}
