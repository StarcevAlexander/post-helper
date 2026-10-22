package plan

import "regexp"

const (
	StateStrategy = "strategy"
	StateCalendar = "calendar"
	StateKits     = "kits"

	DateLayout   = "2006-01-02"
	MaxItems     = 120
	MaxSlots     = 7
	MaxListItems = 40
	MaxTextRunes = 2000
	MaxIDRunes   = 80
	MaxNoteRunes = 1000
	MaxKitFrames = 12
	MaxCount     = 100000

	FormatReels   = "reels"
	FormatPost    = "post"
	FormatStories = "stories"
)

var timePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
