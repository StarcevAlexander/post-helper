package audit

import "context"

type Image struct {
	Name      string
	MediaType string
	Data      []byte
}

type Request struct {
	About  string
	Images []Image
	Extra  string
}

type Result struct {
	Summary        string   `json:"summary"`
	Strengths      []string `json:"strengths"`
	Problems       []string `json:"problems"`
	Fixes          []string `json:"fixes"`
	BioSuggestion  string   `json:"bioSuggestion"`
	NameSuggestion string   `json:"nameSuggestion"`
	ContentNotes   []string `json:"contentNotes"`
	Missing        []string `json:"missing"`
}

type UnreadableError struct {
	Reason string
}

func (e *UnreadableError) Error() string {
	return "unreadable screenshots: " + e.Reason
}

type Generator interface {
	Generate(ctx context.Context, request Request) (Result, error)
}
