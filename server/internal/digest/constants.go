package digest

import "time"

const (
	Tick        = 10 * time.Minute
	SendTimeout = 15 * time.Second
	Weekday     = time.Monday
	Hour        = 9
	KeyPrefix   = "week"
	DateLayout  = "2006-01-02"
	WeekDays    = 7
	MaxMasters  = 40

	Title            = "Недельный дайджест"
	LineMasters      = "Мастеров: %d, с планом: %d"
	LineNoPlan       = "Плана нет"
	LineWaitingPlan  = "Ждёт план с %s"
	LineWaitingWork  = "Ждёт итоги месяца с %s"
	LineDone         = "Опубликовано %d из %d за прошедшие дни"
	LineOverdue      = ", не отмечено %d"
	LineWeek         = "На этой неделе публикаций: %d, календарь до %s (дней: %d)"
	LineCalendarOver = "Календарь закончился %s, нового плана нет"
	LinePushOn       = "Напоминания включены"
	LinePushOff      = "Напоминания выключены"
	LineSeenToday    = ", в приложении сегодня"
	LineSeenDays     = ", в приложении %d дн. назад"
	LineNeverSeen    = ", в приложение не заходила"
	LineMore         = "…и ещё мастеров: %d"
	LineNobody       = "Мастеров пока нет"
)

var weekdayNames = map[time.Weekday]string{
	time.Monday:    "пн",
	time.Tuesday:   "вт",
	time.Wednesday: "ср",
	time.Thursday:  "чт",
	time.Friday:    "пт",
	time.Saturday:  "сб",
	time.Sunday:    "вс",
}

var monthNames = map[time.Month]string{
	time.January:   "янв",
	time.February:  "фев",
	time.March:     "мар",
	time.April:     "апр",
	time.May:       "мая",
	time.June:      "июн",
	time.July:      "июл",
	time.August:    "авг",
	time.September: "сен",
	time.October:   "окт",
	time.November:  "ноя",
	time.December:  "дек",
}
