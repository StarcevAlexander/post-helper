package httpapi

import (
	"log/slog"
	"net/http"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
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
	accountStore := options.Accounts
	if accountStore == nil {
		accountStore = accounts.NewMemory()
	}
	authenticator := auth.New(options.Password, accountStore)
	protected := func(next http.Handler) http.Handler { return withAuth(authenticator, next) }
	quota := func(kind string, next http.Handler) http.Handler {
		return protected(withQuota(accountStore, options.DailyAILimit, kind, logger, next))
	}

	state := &stateHandler{accounts: accountStore, logger: logger}
	admin := &adminHandler{accounts: accountStore, logger: logger}

	mux := http.NewServeMux()
	mux.HandleFunc(HealthRoute, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	mux.Handle(HistoryRoute, protected(requireAdmin(&historyHandler{reader: history, logger: logger})))
	mux.Handle(EventsRoute, protected(requireAdmin(&eventsHandler{reader: history, logger: logger})))
	mux.Handle(ErrorsRoute, protected(requireAdmin(&errorsHandler{reader: history, logger: logger})))
	mux.Handle(IngestRoute, protected(requireAdmin(&ingestHandler{recorder: history})))
	mux.Handle(ClientErrorRoute, protected(&clientErrorHandler{recorder: history}))

	mux.Handle(MeRoute, protected(&meHandler{accounts: accountStore, dailyLimit: options.DailyAILimit, logger: logger}))
	mux.Handle(StateGetRoute, protected(requireMaster(http.HandlerFunc(state.get))))
	mux.Handle(StatePutRoute, protected(requireMaster(http.HandlerFunc(state.put))))
	mux.Handle(AdminMastersRoute, protected(requireAdmin(http.HandlerFunc(admin.list))))
	mux.Handle(AdminCreateMasterRoute, protected(requireAdmin(http.HandlerFunc(admin.create))))
	mux.Handle(AdminDisableMasterRoute, protected(requireAdmin(http.HandlerFunc(admin.disable))))

	mux.Handle(KitRoute, quota(UsageKit, &kitHandler{generator: options.KitMaker, recorder: history, logger: logger}))
	mux.Handle(StrategyRoute, quota(UsageStrategy, &strategyHandler{generator: options.Strategist, recorder: history, logger: logger}))
	mux.Handle(AuditRoute, quota(UsageAudit, &auditHandler{generator: options.Auditor, recorder: history, logger: logger}))
	mux.Handle(ReviewRoute, quota(UsageReview, &reviewHandler{generator: options.Reviewer, recorder: history, logger: logger}))
	mux.Handle(ChatRoute, quota(UsageChat, &chatHandler{responder: options.Responder, recorder: history, logger: logger}))
	return withCORS(options.AllowedOrigins, withLogging(logger, withRecover(logger, mux)))
}
