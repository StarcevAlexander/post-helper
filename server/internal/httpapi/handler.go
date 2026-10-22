package httpapi

import (
	"log/slog"
	"net/http"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/refs"
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

	events := &journal{accounts: accountStore, logger: logger}
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

	mux.Handle(MeRoute, protected(&meHandler{accounts: accountStore, dailyLimit: options.DailyAILimit, retentionDays: options.RetentionDays, logger: logger}))
	mux.Handle(StateGetRoute, protected(requireMaster(http.HandlerFunc(state.get))))
	mux.Handle(StatePutRoute, protected(requireMaster(http.HandlerFunc(state.put))))
	mux.Handle(AdminMastersRoute, protected(requireAdmin(http.HandlerFunc(admin.list))))
	mux.Handle(AdminCreateMasterRoute, protected(requireAdmin(http.HandlerFunc(admin.create))))
	mux.Handle(AdminEventsRoute, protected(requireAdmin(http.HandlerFunc(admin.events))))
	mux.Handle(AdminVersionsRoute, protected(requireAdmin(http.HandlerFunc(admin.versions))))
	mux.Handle(AdminExportRoute, protected(requireAdmin(http.HandlerFunc(admin.export))))
	mux.Handle(AdminDeleteMasterRoute, protected(requireAdmin(http.HandlerFunc(admin.deleteMaster))))
	mux.Handle(AdminRestoreRoute, protected(requireAdmin(http.HandlerFunc(admin.restore))))
	mux.Handle(AdminDisableMasterRoute, protected(requireAdmin(http.HandlerFunc(admin.disable))))

	mux.Handle(KitRoute, quota(UsageKit, &kitHandler{journal: events, generator: options.KitMaker, recorder: history, logger: logger}))
	mux.Handle(StrategyRoute, quota(UsageStrategy, &strategyHandler{journal: events, generator: options.Strategist, recorder: history, logger: logger}))
	jobs := &auditJobsHandler{accounts: accountStore, logger: logger}
	mux.Handle(AuditJobCreateRoute, protected(requireMaster(http.HandlerFunc(jobs.create))))
	mux.Handle(AuditJobLatestRoute, protected(requireMaster(http.HandlerFunc(jobs.latest))))
	mux.Handle(AuditJobCancelRoute, protected(requireMaster(http.HandlerFunc(jobs.cancel))))
	mux.Handle(AdminAuditJobsRoute, protected(requireAdmin(http.HandlerFunc(jobs.list))))
	if options.AgentToken != "" {
		agent := &agentHandler{auditJobsHandler: *jobs, generator: options.Auditor}
		mux.Handle(AgentNextRoute, withAgentToken(options.AgentToken, http.HandlerFunc(agent.next)))
		mux.Handle(AgentResultRoute, withAgentToken(options.AgentToken, http.HandlerFunc(agent.result)))
		mux.Handle(AgentFailRoute, withAgentToken(options.AgentToken, http.HandlerFunc(agent.fail)))
	}
	refsStore := options.Refs
	if refsStore == nil {
		refsStore = refs.NewMemory()
	}
	refsMaster := &refsHandler{refs: refsStore, accounts: accountStore, planner: options.RefPlanner, logger: logger}
	mux.Handle(RefsOrderRoute, protected(requireMaster(http.HandlerFunc(refsMaster.order))))
	mux.Handle(RefsStatusRoute, protected(requireMaster(http.HandlerFunc(refsMaster.status))))
	mux.Handle(RefsMadeRoute, protected(requireMaster(http.HandlerFunc(refsMaster.made))))
	mux.Handle(RefsFileRoute, protected(requireMaster(http.HandlerFunc(refsMaster.file))))
	intakeStore := options.Intake
	if intakeStore == nil {
		intakeStore = intake.NewMemory()
	}
	intakes := &intakeHandler{intake: intakeStore, accounts: accountStore, refs: refsStore, notifier: options.Notifier, logger: logger}
	mux.Handle(IntakeSubmitRoute, protected(requireMaster(http.HandlerFunc(intakes.submit))))
	mux.Handle(IntakeLatestRoute, protected(requireMaster(http.HandlerFunc(intakes.latest))))
	mux.Handle(AdminIntakesRoute, protected(requireAdmin(http.HandlerFunc(intakes.list))))
	mux.Handle(AdminPlanRoute, protected(requireAdmin(http.HandlerFunc(intakes.deliverPlan))))
	mux.Handle(AdminRefsDeliverRoute, protected(requireAdmin(http.HandlerFunc(intakes.deliverRefs))))
	if options.AgentToken != "" && options.RefPlanner != nil {
		refsAgent := &refsAgentHandler{refsHandler: *refsMaster}
		mux.Handle(AgentRefsNextRoute, withAgentToken(options.AgentToken, http.HandlerFunc(refsAgent.next)))
		mux.Handle(AgentRefsResultRoute, withAgentToken(options.AgentToken, http.HandlerFunc(refsAgent.result)))
		mux.Handle(AgentRefsFailRoute, withAgentToken(options.AgentToken, http.HandlerFunc(refsAgent.fail)))
	}
	mux.Handle(AuditRoute, quota(UsageAudit, &auditHandler{journal: events, generator: options.Auditor, recorder: history, logger: logger}))
	mux.Handle(ReviewRoute, quota(UsageReview, &reviewHandler{journal: events, generator: options.Reviewer, recorder: history, logger: logger}))
	mux.Handle(ChatRoute, quota(UsageChat, &chatHandler{journal: events, responder: options.Responder, recorder: history, logger: logger}))
	return withCORS(options.AllowedOrigins, withLogging(logger, withRecover(logger, mux)))
}
