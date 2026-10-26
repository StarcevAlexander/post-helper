package notices

const (
	ListLimit = 50
	KeepDays  = 60
	IDBytes   = 8

	DateLayout = "2006-01-02"
	DaysInWeek = 7

	StateActual   = "actual"
	StateDone     = "done"
	StateOutdated = "outdated"
	StateInfo     = "info"

	ReasonPlanRemoved     = "planRemoved"
	ReasonPlanReplaced    = "planReplaced"
	ReasonRefsGone        = "refsGone"
	ReasonMediaGone       = "mediaGone"
	ReasonDayPassed       = "dayPassed"
	ReasonScheduleChanged = "scheduleChanged"
	ReasonItemRemoved     = "itemRemoved"
	ReasonPublished       = "published"
	ReasonMoved           = "moved"

	LinkCalendar = "/calendar"
	LinkToday    = "/today"
	LinkKit      = "/kit/"
	LinkContent  = "/content/"
	LinkShoot    = "/shoot/"

	MessageURLPrefix = "./"
	ScreenQuery      = "?screen="
)
