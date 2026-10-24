package plan

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

type Recommendation struct {
	ID         string `json:"id"`
	Text       string `json:"text"`
	Importance int    `json:"importance"`
	Done       bool   `json:"done"`
}

func validateRecommendations(items []Recommendation) ([]Recommendation, error) {
	if len(items) > MaxRecommendations {
		return nil, fmt.Errorf("recommendations: не больше %d пунктов", MaxRecommendations)
	}
	seen := make(map[string]struct{}, len(items))
	cleaned := make([]Recommendation, 0, len(items))
	for index, item := range items {
		item.ID = strings.TrimSpace(item.ID)
		item.Text = strings.TrimSpace(item.Text)
		if item.ID == "" || utf8.RuneCountInString(item.ID) > MaxIDRunes {
			return nil, fmt.Errorf("recommendations[%d].id: от 1 до %d символов", index, MaxIDRunes)
		}
		if _, duplicate := seen[item.ID]; duplicate {
			return nil, fmt.Errorf("recommendations[%d].id: %q повторяется", index, item.ID)
		}
		seen[item.ID] = struct{}{}
		if item.Text == "" || tooLong(item.Text) {
			return nil, fmt.Errorf("recommendations[%d].text: нужен текст до %d знаков", index, MaxTextRunes)
		}
		if item.Importance < 0 || item.Importance > 100 {
			return nil, fmt.Errorf("recommendations[%d].importance: процент от 0 до 100", index)
		}
		cleaned = append(cleaned, item)
	}
	return cleaned, nil
}

func mergeRecommendations(data map[string]json.RawMessage, submitted []Recommendation) ([]Recommendation, error) {
	cleaned, err := validateRecommendations(submitted)
	if err != nil {
		return nil, err
	}
	done := map[string]bool{}
	if raw, ok := data[StateRecommendations]; ok {
		var stored []Recommendation
		if json.Unmarshal(raw, &stored) == nil {
			for _, item := range stored {
				done[item.ID] = item.Done
			}
		}
	}
	for index := range cleaned {
		cleaned[index].Done = cleaned[index].Done || done[cleaned[index].ID]
	}
	return cleaned, nil
}
