package notices

import (
	"net/url"
	"strconv"
	"strings"
	"time"

	"post-helper/server/internal/plan"
	"post-helper/server/internal/push"
)

func Judge(entry Entry, facts Facts) Verdict {
	topic := entry.Topic
	switch topic.Kind {
	case push.KindPlan:
		if verdict, gone := planGone(topic, facts); gone {
			return verdict
		}
		return actual(LinkCalendar)
	case push.KindRefs:
		if verdict, gone := planGone(topic, facts); gone {
			return verdict
		}
		if !facts.RefsReady {
			return outdated(ReasonRefsGone)
		}
		return actual(LinkCalendar)
	case push.KindMedia:
		return judgeMedia(topic, facts)
	case push.KindContentDay:
		return judgeContentDay(topic, facts)
	case push.KindPublication:
		return judgePublication(topic, facts)
	case push.KindMessage:
		return judgeMessage(entry.URL)
	}
	return Verdict{State: StateInfo}
}

func judgeMedia(topic push.Topic, facts Facts) Verdict {
	if verdict, gone := planGone(topic, facts); gone {
		return verdict
	}
	var alive []string
	for _, id := range topic.ItemIDs {
		if facts.MediaDone[id] {
			alive = append(alive, id)
		}
	}
	switch len(alive) {
	case 0:
		return outdated(ReasonMediaGone)
	case 1:
		return actual(LinkContent + url.PathEscape(alive[0]))
	}
	return actual(LinkToday)
}

func judgeContentDay(topic push.Topic, facts Facts) Verdict {
	if verdict, gone := planGone(topic, facts); gone {
		return verdict
	}
	if topic.Date < facts.Today {
		return outdated(ReasonDayPassed)
	}
	week, ok := weekOf(facts.Plan, topic.Date, topic.Time)
	if !ok {
		return outdated(ReasonScheduleChanged)
	}
	return actual(LinkShoot + strconv.Itoa(week))
}

func judgePublication(topic push.Topic, facts Facts) Verdict {
	if verdict, gone := planGone(topic, facts); gone {
		return verdict
	}
	for _, item := range facts.Plan.Items {
		if item.ID != topic.ItemID {
			continue
		}
		if item.Done {
			return Verdict{State: StateDone, Reason: ReasonPublished}
		}
		verdict := actual(LinkKit + url.PathEscape(item.ID))
		if item.Date != topic.Date {
			verdict.Reason, verdict.MovedTo = ReasonMoved, item.Date
		}
		return verdict
	}
	return outdated(ReasonItemRemoved)
}

func judgeMessage(target string) Verdict {
	path := strings.TrimPrefix(target, MessageURLPrefix)
	if screen, ok := strings.CutPrefix(path, ScreenQuery); ok {
		path = screen
	}
	if path == "" || strings.ContainsAny(path, "?#") {
		return Verdict{State: StateInfo}
	}
	return actual("/" + path)
}

func planGone(topic push.Topic, facts Facts) (Verdict, bool) {
	if !facts.HasPlan {
		return outdated(ReasonPlanRemoved), true
	}
	if topic.PlanStart != "" && topic.PlanStart != facts.Plan.StartedOn {
		return outdated(ReasonPlanReplaced), true
	}
	return Verdict{}, false
}

func weekOf(calendar plan.Calendar, date, clock string) (int, bool) {
	start, err := time.Parse(DateLayout, calendar.StartedOn)
	if err != nil {
		return 0, false
	}
	day, err := time.Parse(DateLayout, date)
	if err != nil || day.Before(start) {
		return 0, false
	}
	weekday := (int(day.Weekday()) + 6) % DaysInWeek
	for _, slot := range calendar.Schedule.Slots {
		if slot.Weekday == weekday && slot.Time == clock {
			return int(day.Sub(start).Hours()/24) / DaysInWeek, true
		}
	}
	return 0, false
}

func actual(link string) Verdict {
	return Verdict{State: StateActual, Link: link}
}

func outdated(reason string) Verdict {
	return Verdict{State: StateOutdated, Reason: reason}
}
