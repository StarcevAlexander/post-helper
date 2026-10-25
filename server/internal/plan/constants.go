package plan

import "regexp"

const (
	StateStrategy        = "strategy"
	StateCalendar        = "calendar"
	StateKits            = "kits"
	StateReviews         = "monthReviews"
	StateRecommendations = "recommendations"

	DateLayout         = "2006-01-02"
	MaxItems           = 120
	MaxSlots           = 7
	MaxListItems       = 40
	MaxTextRunes       = 2000
	MaxIDRunes         = 80
	MaxNoteRunes       = 1000
	MaxKitFrames       = 12
	MaxReviews         = 24
	MaxRecommendations = 30
	MaxCount           = 100000

	FormatReels   = "reels"
	FormatPost    = "post"
	FormatStories = "stories"
)

var timePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

var formatLabels = map[string]string{
	FormatReels:   "Reels",
	FormatPost:    "Пост",
	FormatStories: "Сторис",
}

func FormatLabel(format string) string {
	if label, ok := formatLabels[format]; ok {
		return label
	}
	return format
}

func (i Item) Label() string {
	return FormatLabel(i.Format) + ", " + i.Date + " " + i.Time + ": " + i.Idea
}
