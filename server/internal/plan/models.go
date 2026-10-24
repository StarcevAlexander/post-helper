package plan

import "encoding/json"

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
	Summary      string   `json:"summary"`
	Positioning  string   `json:"positioning"`
	ProfileFixes []string `json:"profileFixes"`
	Pillars      []Pillar `json:"pillars"`
	Cadence      Cadence  `json:"cadence"`
	FirstSteps   []string `json:"firstSteps"`
}

type Slot struct {
	Weekday int    `json:"weekday"`
	Time    string `json:"time"`
}

type Schedule struct {
	Slots       []Slot `json:"slots"`
	PublishTime string `json:"publishTime"`
}

type Item struct {
	ID     string `json:"id"`
	Date   string `json:"date"`
	Time   string `json:"time"`
	Format string `json:"format"`
	Pillar string `json:"pillar"`
	Idea   string `json:"idea"`
	Done   bool   `json:"done"`
}

type Calendar struct {
	StartedOn string   `json:"startedOn"`
	Schedule  Schedule `json:"schedule"`
	Items     []Item   `json:"items"`
}

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

type StoredKit struct {
	ItemID string `json:"itemId"`
	Format string `json:"format"`
	Pillar string `json:"pillar"`
	Idea   string `json:"idea"`
	Kit    Kit    `json:"kit"`
}

type Submission struct {
	Strategy        *Strategy        `json:"strategy"`
	Calendar        *Calendar        `json:"calendar"`
	Kits            map[string]Kit   `json:"kits"`
	Review          *Review          `json:"review"`
	Recommendations []Recommendation `json:"recommendations"`
	Note            string           `json:"note"`
}

type Merged struct {
	Data  json.RawMessage
	Items []Item
}
