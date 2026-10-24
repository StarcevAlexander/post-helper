package reminders

import (
	"encoding/json"
	"fmt"
	"time"
)

func Due(raw json.RawMessage, now time.Time, location *time.Location) []Reminder {
	var state struct {
		Calendar *calendar `json:"calendar"`
	}
	if json.Unmarshal(raw, &state) != nil || state.Calendar == nil {
		return nil
	}
	var due []Reminder
	for _, reminder := range all(*state.Calendar, location) {
		if !now.Before(reminder.At) && now.Before(reminder.At.Add(Window)) {
			due = append(due, reminder)
		}
	}
	return due
}

func all(plan calendar, location *time.Location) []Reminder {
	var reminders []Reminder
	started, err := time.ParseInLocation(DateLayout, plan.StartedOn, location)
	if err == nil {
		for week := range PlanWeeks {
			from := started.AddDate(0, 0, week*7)
			for _, slot := range plan.Schedule.Slots {
				offset := (slot.Weekday - mondayFirst(from) + 7) % 7
				day := from.AddDate(0, 0, offset)
				moment, ok := at(day.Format(DateLayout), slot.Time, location)
				if !ok {
					continue
				}
				reminders = append(reminders, Reminder{
					Key:   fmt.Sprintf("%s:%s:%s", KeyContentDay, day.Format(DateLayout), slot.Time),
					At:    moment.Add(-ContentDayLead),
					Title: TitleContentDay,
					Body:  BodyContentDay,
					URL:   URLToday,
				})
			}
		}
	}
	for _, item := range plan.Items {
		if item.Done {
			continue
		}
		moment, ok := at(item.Date, item.Time, location)
		if !ok {
			continue
		}
		body := item.Idea
		if label := formatLabels[item.Format]; label != "" {
			body = label + ": " + item.Idea
		}
		reminders = append(reminders, Reminder{
			Key:   fmt.Sprintf("%s:%s", KeyPublication, item.ID),
			At:    moment.Add(-PublicationLead),
			Title: TitlePublication,
			Body:  body,
			URL:   URLToday,
		})
	}
	return reminders
}

func at(date, clock string, location *time.Location) (time.Time, bool) {
	day, err := time.ParseInLocation(DateLayout, date, location)
	if err != nil {
		return time.Time{}, false
	}
	moment, err := time.ParseInLocation(TimeLayout, clock, location)
	if err != nil {
		return time.Time{}, false
	}
	return time.Date(day.Year(), day.Month(), day.Day(), moment.Hour(), moment.Minute(), 0, 0, location), true
}

func mondayFirst(date time.Time) int {
	return (int(date.Weekday()) + 6) % 7
}
