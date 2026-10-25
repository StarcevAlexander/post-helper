package digest

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func rowFromState(raw json.RawMessage, today time.Time) (MasterRow, bool) {
	var state struct {
		Calendar *calendar `json:"calendar"`
	}
	if json.Unmarshal(raw, &state) != nil || state.Calendar == nil || len(state.Calendar.Items) == 0 {
		return MasterRow{}, false
	}
	todayKey := today.Format(DateLayout)
	weekEnd := today.AddDate(0, 0, WeekDays).Format(DateLayout)
	row := MasterRow{HasPlan: true}
	for _, item := range state.Calendar.Items {
		if item.Date <= todayKey {
			row.PlannedSoFar++
			if item.Done {
				row.DoneSoFar++
			} else if item.Date < todayKey {
				row.Overdue++
			}
		}
		if item.Date > todayKey && item.Date <= weekEnd {
			row.ThisWeek++
		}
		if item.Date > row.EndsOn {
			row.EndsOn = item.Date
		}
	}
	if end, err := time.ParseInLocation(DateLayout, row.EndsOn, today.Location()); err == nil {
		row.DaysLeft = int(end.Sub(startOfDay(today)).Hours() / 24)
	}
	return row, true
}

func Render(report Report) string {
	var text strings.Builder
	fmt.Fprintf(&text, "%s, %s\n", Title, report.Date)
	if len(report.Masters) == 0 {
		text.WriteString(LineNobody)
		return text.String()
	}
	fmt.Fprintf(&text, LineMasters, len(report.Masters), report.WithPlan)
	shown := report.Masters
	if len(shown) > MaxMasters {
		shown = shown[:MaxMasters]
	}
	for _, row := range shown {
		text.WriteString("\n\n")
		text.WriteString(row.Name)
		if row.City != "" {
			fmt.Fprintf(&text, " (%s)", row.City)
		}
		for _, line := range rowLines(row) {
			fmt.Fprintf(&text, "\n• %s", line)
		}
	}
	if len(report.Masters) > len(shown) {
		fmt.Fprintf(&text, "\n\n"+LineMore, len(report.Masters)-len(shown))
	}
	return text.String()
}

func rowLines(row MasterRow) []string {
	var lines []string
	if row.HasPlan {
		progress := fmt.Sprintf(LineDone, row.DoneSoFar, row.PlannedSoFar)
		if row.Overdue > 0 {
			progress += fmt.Sprintf(LineOverdue, row.Overdue)
		}
		lines = append(lines, progress)
		if row.DaysLeft < 0 {
			lines = append(lines, fmt.Sprintf(LineCalendarOver, humanDate(row.EndsOn)))
		} else {
			lines = append(lines, fmt.Sprintf(LineWeek, row.ThisWeek, humanDate(row.EndsOn), row.DaysLeft))
		}
	} else {
		lines = append(lines, LineNoPlan)
	}
	if row.Waiting != "" {
		lines = append(lines, fmt.Sprintf(row.Waiting, humanDate(row.WaitingSince)))
	}
	presence := LinePushOff
	if row.Pushes {
		presence = LinePushOn
	}
	switch {
	case row.NeverSeen:
		presence += LineNeverSeen
	case row.LastSeenDays <= 0:
		presence += LineSeenToday
	default:
		presence += fmt.Sprintf(LineSeenDays, row.LastSeenDays)
	}
	return append(lines, presence)
}

func humanDate(key string) string {
	day, err := time.Parse(DateLayout, key)
	if err != nil {
		return key
	}
	return fmt.Sprintf("%d %s", day.Day(), monthNames[day.Month()])
}

func headerDate(now time.Time) string {
	return fmt.Sprintf("%s %d %s", weekdayNames[now.Weekday()], now.Day(), monthNames[now.Month()])
}

func startOfDay(moment time.Time) time.Time {
	return time.Date(moment.Year(), moment.Month(), moment.Day(), 0, 0, 0, 0, moment.Location())
}

func weekKey(now time.Time) string {
	offset := (int(now.Weekday()) + 6) % 7
	monday := startOfDay(now).AddDate(0, 0, -offset)
	return KeyPrefix + ":" + monday.Format(DateLayout)
}

func RenderWaiting(rows []WaitingRow, now time.Time) string {
	var text strings.Builder
	fmt.Fprintf(&text, "%s, %s\n", TitleWaiting, headerDate(now))
	for _, row := range rows {
		kind := WaitingKindPlan
		if row.Review {
			kind = WaitingKindReview
		}
		name := row.Name
		if row.City != "" {
			name += fmt.Sprintf(" (%s)", row.City)
		}
		text.WriteString("\n")
		fmt.Fprintf(&text, LineWaitingRow, name, kind, humanMoment(row.Since), humanAge(row.Age), row.MasterID)
	}
	text.WriteString("\n\n" + LineHowToHandle)
	return text.String()
}

func humanMoment(moment time.Time) string {
	return fmt.Sprintf("%d %s %s", moment.Day(), monthNames[moment.Month()], moment.Format("15:04"))
}

func humanAge(age time.Duration) string {
	hours := int(age.Hours())
	if hours >= HoursPerDay {
		return fmt.Sprintf(LineAgeDays, hours/HoursPerDay)
	}
	return fmt.Sprintf(LineAgeHours, hours)
}

func dayKey(now time.Time) string {
	return RemindPrefix + ":" + startOfDay(now).Format(DateLayout)
}
