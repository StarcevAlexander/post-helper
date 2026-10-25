package plan

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"
)

func (s Submission) CarriesPlan() bool {
	return s.Strategy != nil || s.Calendar != nil || len(s.Kits) > 0 || s.Review != nil
}

func Merge(existing json.RawMessage, submission Submission) (Merged, error) {
	if submission.Strategy == nil && submission.Calendar == nil && len(submission.Kits) == 0 && submission.Review == nil && submission.Recommendations == nil && submission.Location == nil {
		return Merged{}, fmt.Errorf("в плане нет ни стратегии, ни календаря, ни комплектов, ни итогов, ни рекомендаций, ни места")
	}
	if utf8.RuneCountInString(strings.TrimSpace(submission.Note)) > MaxNoteRunes {
		return Merged{}, fmt.Errorf("note: слишком длинная записка")
	}
	data := map[string]json.RawMessage{}
	if len(existing) > 0 {
		if err := json.Unmarshal(existing, &data); err != nil {
			return Merged{}, fmt.Errorf("сохранённые данные мастера не разобрать")
		}
	}

	if submission.Strategy != nil {
		if err := submission.Strategy.Validate(); err != nil {
			return Merged{}, err
		}
		if err := put(data, StateStrategy, submission.Strategy); err != nil {
			return Merged{}, err
		}
	}

	calendar, err := resolveCalendar(data, submission.Calendar)
	if err != nil {
		return Merged{}, err
	}
	if submission.Calendar != nil {
		if err := put(data, StateCalendar, calendar); err != nil {
			return Merged{}, err
		}
	}

	if len(submission.Kits) > 0 || submission.Calendar != nil {
		kits, err := mergeKits(data, calendar, submission.Kits)
		if err != nil {
			return Merged{}, err
		}
		if err := put(data, StateKits, kits); err != nil {
			return Merged{}, err
		}
	}

	if submission.Recommendations != nil {
		recommendations, err := mergeRecommendations(data, submission.Recommendations)
		if err != nil {
			return Merged{}, err
		}
		if err := put(data, StateRecommendations, recommendations); err != nil {
			return Merged{}, err
		}
	}

	if submission.Review != nil {
		if err := submission.Review.Validate(); err != nil {
			return Merged{}, err
		}
		reviews, err := mergeReview(data, *submission.Review)
		if err != nil {
			return Merged{}, err
		}
		if err := put(data, StateReviews, reviews); err != nil {
			return Merged{}, err
		}
	}

	merged, err := json.Marshal(data)
	if err != nil {
		return Merged{}, err
	}
	var items []Item
	if calendar != nil {
		items = calendar.Items
	}
	return Merged{Data: merged, Items: items}, nil
}

func resolveCalendar(data map[string]json.RawMessage, submitted *Calendar) (*Calendar, error) {
	var previous *Calendar
	if raw, ok := data[StateCalendar]; ok {
		var stored Calendar
		if json.Unmarshal(raw, &stored) == nil {
			previous = &stored
		}
	}
	if submitted == nil {
		return previous, nil
	}
	if err := submitted.Validate(); err != nil {
		return nil, err
	}
	if previous != nil {
		done := make(map[string]bool, len(previous.Items))
		for _, item := range previous.Items {
			done[item.ID] = item.Done
		}
		for index := range submitted.Items {
			submitted.Items[index].Done = submitted.Items[index].Done || done[submitted.Items[index].ID]
		}
	}
	return submitted, nil
}

func mergeKits(data map[string]json.RawMessage, calendar *Calendar, submitted map[string]Kit) (map[string]StoredKit, error) {
	if calendar == nil {
		return nil, fmt.Errorf("kits: сначала нужен календарь, к его публикациям привязываются комплекты")
	}
	byID := make(map[string]Item, len(calendar.Items))
	for _, item := range calendar.Items {
		byID[item.ID] = item
	}
	kits := map[string]StoredKit{}
	if raw, ok := data[StateKits]; ok {
		var stored map[string]StoredKit
		if json.Unmarshal(raw, &stored) == nil {
			for id, entry := range stored {
				if _, present := byID[id]; present {
					kits[id] = entry
				}
			}
		}
	}
	ids := make([]string, 0, len(submitted))
	for id := range submitted {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		item, present := byID[id]
		if !present {
			return nil, fmt.Errorf("kits[%s]: такой публикации нет в календаре", id)
		}
		kit := submitted[id]
		if err := kit.Validate(); err != nil {
			return nil, fmt.Errorf("kits[%s]: %w", id, err)
		}
		kits[id] = StoredKit{ItemID: id, Format: item.Format, Pillar: item.Pillar, Idea: item.Idea, Kit: kit}
	}
	return kits, nil
}

func put(data map[string]json.RawMessage, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data[key] = encoded
	return nil
}
