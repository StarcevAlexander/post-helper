package httpapi

import (
	"log/slog"
	"net/http"

	"post-helper/server/internal/store"
)

func NewHandler(options Options) http.Handler {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}

	history := options.Store
	if history == nil {
		history = store.Noop{}
	}

	mux := http.NewServeMux()
	mux.Handle(HistoryRoute, withPassword(options.Password, &historyHandler{reader: history, logger: logger}))
	mux.Handle(EventsRoute, withPassword(options.Password, &eventsHandler{reader: history, logger: logger}))
	mux.Handle(ErrorsRoute, withPassword(options.Password, &errorsHandler{reader: history, logger: logger}))
	mux.Handle(IngestRoute, withPassword(options.Password, &ingestHandler{recorder: history}))
	mux.Handle(ClientErrorRoute, withPassword(options.Password, &clientErrorHandler{recorder: history}))
	mux.HandleFunc(HealthRoute, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.Handle(KitRoute, withPassword(options.Password, &kitHandler{
		generator: options.KitMaker,
		recorder:  history,
		logger:    logger,
	}))
	mux.Handle(StrategyRoute, withPassword(options.Password, &strategyHandler{
		generator: options.Strategist,
		recorder:  history,
		logger:    logger,
	}))
	mux.Handle(ChatRoute, withPassword(options.Password, &chatHandler{
		responder: options.Responder,
		recorder:  history,
		logger:    logger,
	}))
	return withCORS(options.AllowedOrigins, withLogging(logger, withRecover(logger, mux)))
}
