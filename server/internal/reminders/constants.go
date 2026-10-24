package reminders

import "time"

const (
	Tick            = time.Minute
	Window          = 30 * time.Minute
	ContentDayLead  = time.Hour
	PublicationLead = 15 * time.Minute
	SendTimeout     = 30 * time.Second
	ForgetAfter     = 60 * 24 * time.Hour
	PlanWeeks       = 4

	DateLayout = "2006-01-02"
	TimeLayout = "15:04"

	TitleContentDay  = "День контента"
	BodyContentDay   = "Откройте список съёмки на неделю: кадры, референсы и описание каждого кадра."
	TitlePublication = "Пора публиковать"
	URLToday         = "./?screen=today"

	KeyContentDay  = "content"
	KeyPublication = "item"
)

var formatLabels = map[string]string{
	"reels":   "Reels",
	"post":    "Пост",
	"stories": "Сторис",
}
