package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
	"post-helper/server/internal/places"
)

type placeKeeper struct {
	accounts accounts.Store
	places   places.Resolver
	logger   *slog.Logger
}

func (k *placeKeeper) set(ctx context.Context, masterID, rawCity, rawZone string) (accounts.Master, int, string) {
	city, ok := places.CleanCity(rawCity)
	if !ok {
		return accounts.Master{}, http.StatusBadRequest, MsgBadPlace
	}
	zone := strings.TrimSpace(rawZone)
	if zone != "" && !places.ValidZone(zone) {
		return accounts.Master{}, http.StatusBadRequest, MsgBadPlace
	}
	if _, err := k.accounts.GetMaster(ctx, masterID); errors.Is(err, accounts.ErrNotFound) {
		return accounts.Master{}, http.StatusNotFound, MsgMasterNotFound
	} else if err != nil {
		k.logger.Error("load master for place failed", slog.Any("error", err))
		return accounts.Master{}, http.StatusInternalServerError, MsgMasterFailed
	}
	if zone == "" {
		if k.places == nil {
			return accounts.Master{}, http.StatusUnprocessableEntity, MsgPlaceUnknown
		}
		found, err := k.places.Locate(ctx, places.Query{City: city})
		if err != nil {
			k.logger.Warn("time zone of the place is unknown", slog.String("city", city), slog.Any("error", err))
			return accounts.Master{}, http.StatusUnprocessableEntity, MsgPlaceUnknown
		}
		zone = found.Zone
	}
	if err := k.accounts.SetLocation(ctx, masterID, city, zone); err != nil {
		k.logger.Error("save place failed", slog.Any("error", err))
		return accounts.Master{}, http.StatusInternalServerError, MsgMasterFailed
	}
	master, _ := k.accounts.GetMaster(ctx, masterID)
	return master, 0, ""
}

func (k *placeKeeper) learnFromSocial(ctx context.Context, masterID string, collected audit.Collected) {
	hint := collected.PlaceHint()
	if hint == "" || k.places == nil {
		return
	}
	master, err := k.accounts.GetMaster(ctx, masterID)
	if err != nil || (master.City != "" && master.Timezone != "") {
		return
	}
	detached := context.WithoutCancel(ctx)
	go func() {
		lookupCtx, cancel := context.WithTimeout(detached, places.RequestTimeout)
		defer cancel()
		found, err := k.places.Locate(lookupCtx, places.Query{City: master.City, Social: hint})
		if err != nil {
			k.logger.Warn("place of the master is not clear from the social pages", slog.Any("error", err))
			return
		}
		city := master.City
		if city == "" {
			city = found.City
		}
		if err := k.accounts.SetLocation(lookupCtx, masterID, city, found.Zone); err != nil {
			k.logger.Error("save place from the social pages failed", slog.Any("error", err))
		}
	}()
}

type placeHandler struct {
	keeper *placeKeeper
}

func (h *placeHandler) set(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAdminBodyBytes)
	var body AdminLocationRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, MsgBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*places.RequestTimeout)
	defer cancel()
	master, status, message := h.keeper.set(ctx, r.PathValue("id"), body.City, body.Timezone)
	if message != "" {
		writeError(w, status, message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"city": master.City, "timezone": master.Timezone})
}
