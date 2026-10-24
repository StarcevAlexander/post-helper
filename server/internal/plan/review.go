package plan

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

type Review struct {
	ID          string   `json:"id"`
	From        string   `json:"from"`
	To          string   `json:"to"`
	Planned     int      `json:"planned"`
	Done        int      `json:"done"`
	Headline    string   `json:"headline"`
	Facts       []string `json:"facts"`
	Conclusions []string `json:"conclusions"`
	Changes     []string `json:"changes"`
	Note        string   `json:"note"`
}

func (r *Review) Validate() error {
	r.ID = strings.TrimSpace(r.ID)
	r.Headline = strings.TrimSpace(r.Headline)
	r.Note = strings.TrimSpace(r.Note)
	if r.ID == "" || utf8.RuneCountInString(r.ID) > MaxIDRunes {
		return fmt.Errorf("review.id: от 1 до %d символов", MaxIDRunes)
	}
	from, err := time.Parse(DateLayout, r.From)
	if err != nil {
		return fmt.Errorf("review.from: нужна дата ГГГГ-ММ-ДД")
	}
	to, err := time.Parse(DateLayout, r.To)
	if err != nil || to.Before(from) {
		return fmt.Errorf("review.to: нужна дата ГГГГ-ММ-ДД не раньше from")
	}
	if r.Planned < 0 || r.Planned > MaxCount || r.Done < 0 || r.Done > r.Planned {
		return fmt.Errorf("review: planned и done должны быть числами, done не больше planned")
	}
	if r.Headline == "" || tooLong(r.Headline, r.Note) {
		return fmt.Errorf("review: нужен короткий headline")
	}
	if r.Facts, err = cleanList("review.facts", r.Facts, false); err != nil {
		return err
	}
	if r.Conclusions, err = cleanList("review.conclusions", r.Conclusions, true); err != nil {
		return err
	}
	if r.Changes, err = cleanList("review.changes", r.Changes, false); err != nil {
		return err
	}
	return nil
}

func mergeReview(data map[string]json.RawMessage, submitted Review) ([]Review, error) {
	var stored []Review
	if raw, ok := data[StateReviews]; ok {
		if json.Unmarshal(raw, &stored) != nil {
			stored = nil
		}
	}
	reviews := make([]Review, 0, len(stored)+1)
	for _, review := range stored {
		if review.ID != submitted.ID {
			reviews = append(reviews, review)
		}
	}
	reviews = append(reviews, submitted)
	if len(reviews) > MaxReviews {
		reviews = reviews[len(reviews)-MaxReviews:]
	}
	return reviews, nil
}
