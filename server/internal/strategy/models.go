package strategy

import "context"

type Profile struct {
	Name       string `json:"name"`
	Specialty  string `json:"specialty"`
	City       string `json:"city"`
	Experience string `json:"experience"`
	Services   string `json:"services"`
	Clients    string `json:"clients"`
	Goal       string `json:"goal"`
	Instagram  string `json:"instagram"`
	Style      string `json:"style"`
}

type Pillar struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Ideas       []string `json:"ideas"`
}

type Cadence struct {
	Reels   int    `json:"reels"`
	Posts   int    `json:"posts"`
	Stories int    `json:"stories"`
	Note    string `json:"note"`
}

type Strategy struct {
	Insufficient string   `json:"insufficient,omitempty"`
	Summary      string   `json:"summary"`
	Positioning  string   `json:"positioning"`
	ProfileFixes []string `json:"profileFixes"`
	Pillars      []Pillar `json:"pillars"`
	Cadence      Cadence  `json:"cadence"`
	FirstSteps   []string `json:"firstSteps"`
}

type InsufficientError struct {
	Reason string
}

func (e *InsufficientError) Error() string {
	return "insufficient profile: " + e.Reason
}

type Generator interface {
	Generate(ctx context.Context, profile Profile) (Strategy, error)
}
