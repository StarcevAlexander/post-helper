package plan

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

func tooLong(values ...string) bool {
	for _, value := range values {
		if utf8.RuneCountInString(value) > MaxTextRunes {
			return true
		}
	}
	return false
}

func cleanList(name string, values []string, required bool) ([]string, error) {
	if values == nil {
		values = []string{}
	}
	if len(values) > MaxListItems {
		return nil, fmt.Errorf("%s: слишком много пунктов", name)
	}
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if tooLong(value) {
			return nil, fmt.Errorf("%s: пункт слишком длинный", name)
		}
		cleaned = append(cleaned, value)
	}
	if required && len(cleaned) == 0 {
		return nil, fmt.Errorf("%s: нужен хотя бы один пункт", name)
	}
	return cleaned, nil
}

func (s *Strategy) Validate() error {
	s.Summary = strings.TrimSpace(s.Summary)
	s.Positioning = strings.TrimSpace(s.Positioning)
	s.Cadence.Note = strings.TrimSpace(s.Cadence.Note)
	if s.Summary == "" || s.Positioning == "" {
		return fmt.Errorf("strategy: нужны summary и positioning")
	}
	if tooLong(s.Summary, s.Positioning, s.Cadence.Note) {
		return fmt.Errorf("strategy: текст слишком длинный")
	}
	for _, count := range []int{s.Cadence.Reels, s.Cadence.Posts, s.Cadence.Stories} {
		if count < 0 || count > MaxCount {
			return fmt.Errorf("strategy.cadence: неверное число публикаций")
		}
	}
	var err error
	if s.ProfileFixes, err = cleanList("strategy.profileFixes", s.ProfileFixes, false); err != nil {
		return err
	}
	if s.FirstSteps, err = cleanList("strategy.firstSteps", s.FirstSteps, true); err != nil {
		return err
	}
	if len(s.Pillars) == 0 || len(s.Pillars) > MaxListItems {
		return fmt.Errorf("strategy.pillars: нужна хотя бы одна рубрика")
	}
	for index := range s.Pillars {
		pillar := &s.Pillars[index]
		pillar.Title = strings.TrimSpace(pillar.Title)
		pillar.Description = strings.TrimSpace(pillar.Description)
		if pillar.Title == "" || tooLong(pillar.Title, pillar.Description) {
			return fmt.Errorf("strategy.pillars[%d]: нужен короткий title", index)
		}
		if pillar.Ideas, err = cleanList(fmt.Sprintf("strategy.pillars[%d].ideas", index), pillar.Ideas, false); err != nil {
			return err
		}
	}
	return nil
}

func validFormat(format string) bool {
	return format == FormatReels || format == FormatPost || format == FormatStories
}

func (c *Calendar) Validate() error {
	if _, err := time.Parse(DateLayout, c.StartedOn); err != nil {
		return fmt.Errorf("calendar.startedOn: нужна дата ГГГГ-ММ-ДД")
	}
	if !timePattern.MatchString(c.Schedule.PublishTime) {
		return fmt.Errorf("calendar.schedule.publishTime: нужно время ЧЧ:ММ")
	}
	if c.Schedule.Slots == nil {
		c.Schedule.Slots = []Slot{}
	}
	if len(c.Schedule.Slots) > MaxSlots {
		return fmt.Errorf("calendar.schedule.slots: слишком много дней контента")
	}
	for index, slot := range c.Schedule.Slots {
		if slot.Weekday < 0 || slot.Weekday > 6 || !timePattern.MatchString(slot.Time) {
			return fmt.Errorf("calendar.schedule.slots[%d]: weekday 0-6 и время ЧЧ:ММ", index)
		}
	}
	if len(c.Items) == 0 || len(c.Items) > MaxItems {
		return fmt.Errorf("calendar.items: от 1 до %d публикаций", MaxItems)
	}
	seen := make(map[string]struct{}, len(c.Items))
	for index := range c.Items {
		item := &c.Items[index]
		item.ID = strings.TrimSpace(item.ID)
		item.Pillar = strings.TrimSpace(item.Pillar)
		item.Idea = strings.TrimSpace(item.Idea)
		if item.ID == "" || utf8.RuneCountInString(item.ID) > MaxIDRunes {
			return fmt.Errorf("calendar.items[%d].id: от 1 до %d символов", index, MaxIDRunes)
		}
		if _, duplicate := seen[item.ID]; duplicate {
			return fmt.Errorf("calendar.items[%d].id: %q повторяется", index, item.ID)
		}
		seen[item.ID] = struct{}{}
		if _, err := time.Parse(DateLayout, item.Date); err != nil {
			return fmt.Errorf("calendar.items[%d].date: нужна дата ГГГГ-ММ-ДД", index)
		}
		if !timePattern.MatchString(item.Time) {
			return fmt.Errorf("calendar.items[%d].time: нужно время ЧЧ:ММ", index)
		}
		if !validFormat(item.Format) {
			return fmt.Errorf("calendar.items[%d].format: reels, post или stories", index)
		}
		if item.Idea == "" || tooLong(item.Pillar, item.Idea) {
			return fmt.Errorf("calendar.items[%d]: нужна короткая idea", index)
		}
	}
	return nil
}

func (k *Kit) Validate() error {
	k.Caption = strings.TrimSpace(k.Caption)
	k.Tip = strings.TrimSpace(k.Tip)
	if tooLong(k.Caption, k.Tip) {
		return fmt.Errorf("текст слишком длинный")
	}
	var err error
	if k.Shots, err = cleanList("shots", k.Shots, false); err != nil {
		return err
	}
	if k.Hashtags, err = cleanList("hashtags", k.Hashtags, false); err != nil {
		return err
	}
	if k.Frames == nil {
		k.Frames = []Frame{}
	}
	if len(k.Frames) > MaxKitFrames {
		return fmt.Errorf("frames: слишком много кадров")
	}
	for _, frame := range k.Frames {
		if tooLong(frame.Visual, frame.Overlay) {
			return fmt.Errorf("frames: текст слишком длинный")
		}
	}
	return nil
}
