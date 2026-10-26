package notices

import (
	"encoding/json"

	"post-helper/server/internal/plan"
)

func PlanOf(raw json.RawMessage) (plan.Calendar, bool) {
	var state struct {
		Calendar *plan.Calendar `json:"calendar"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &state) != nil || state.Calendar == nil || state.Calendar.StartedOn == "" {
		return plan.Calendar{}, false
	}
	return *state.Calendar, true
}
