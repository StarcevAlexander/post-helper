package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/auth"
	"post-helper/server/internal/feedback"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/push"
	"post-helper/server/internal/refs"
	"post-helper/server/internal/store"
)

type core struct {
	options  Options
	logger   *slog.Logger
	history  store.Store
	people   accounts.Store
	refs     refs.Store
	intake   intake.Store
	feedback feedback.Store
	pushes   *pushHandler
	refsOn   bool
	keeper   *placeKeeper
}

func newCore(options Options) *core {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	history := options.Store
	if history == nil {
		history = store.Noop{}
	}
	people := options.Accounts
	if people == nil {
		people = accounts.NewMemory()
	}
	refsStore := options.Refs
	if refsStore == nil {
		refsStore = refs.NewMemory()
	}
	pushStore := options.PushStore
	if pushStore == nil {
		pushStore = push.NewMemory()
	}
	intakeStore := options.Intake
	if intakeStore == nil {
		intakeStore = intake.NewMemory()
	}
	feedbackStore := options.Feedback
	if feedbackStore == nil {
		feedbackStore = feedback.NewMemory()
	}
	return &core{
		options:  options,
		logger:   logger,
		history:  history,
		people:   people,
		refs:     refsStore,
		intake:   intakeStore,
		feedback: feedbackStore,
		pushes:   &pushHandler{store: pushStore, sender: options.Pusher, accounts: people, logger: logger},
		refsOn:   options.RefPlanner != nil,
		keeper:   &placeKeeper{accounts: people, places: options.Places, logger: logger},
	}
}

func (c *core) refsHandler() *refsHandler {
	return &refsHandler{refs: c.refs, accounts: c.people, intakes: c.intake, planner: c.options.RefPlanner, pushes: c.pushes, logger: c.logger}
}

func (c *core) feedbackHandler() *feedbackHandler {
	return &feedbackHandler{feedback: c.feedback, accounts: c.people, notifier: c.options.Notifier, logger: c.logger}
}

func (c *core) intakeHandler() *intakeHandler {
	return &intakeHandler{intake: c.intake, accounts: c.people, refs: c.refs, notifier: c.options.Notifier, pushes: c.pushes, refsOn: c.refsOn, places: c.options.Places, keeper: c.keeper, logger: c.logger}
}

func NewHandler(options Options) http.Handler {
	c := newCore(options)
	authenticator := auth.New(c.people)
	protected := func(next http.Handler) http.Handler { return withAuth(c.logger, authenticator, next) }
	state := &stateHandler{accounts: c.people, logger: c.logger}
	jobs := &auditJobsHandler{accounts: c.people, intakes: c.intake, keeper: c.keeper, logger: c.logger}
	refsMaster := c.refsHandler()
	intakes := c.intakeHandler()
	signIn := &authHandler{
		accounts:       c.people,
		exchanger:      options.Yandex,
		clientID:       options.YandexClientID,
		allowedOrigins: options.AllowedOrigins,
		limiter:        newRateLimiter(SignInLimitPerWindow, SignInLimitWindow),
		logger:         c.logger,
	}

	mux := http.NewServeMux()
	mux.HandleFunc(HealthRoute, healthHandler(options.Ping, c.logger))
	mux.HandleFunc(AuthConfigRoute, signIn.config)
	mux.HandleFunc(AuthYandexRoute, signIn.login)
	mux.Handle(ClientErrorRoute, protected(&clientErrorHandler{recorder: c.history, limiter: newRateLimiter(ClientErrorLimitPerWindow, ClientErrorLimitWindow)}))
	mux.Handle(MeRoute, protected(&meHandler{accounts: c.people, retentionDays: options.RetentionDays, logger: c.logger}))
	mux.Handle(MeRenameRoute, protected(&renameHandler{accounts: c.people, logger: c.logger}))
	mux.Handle(MeYandexRoute, protected(http.HandlerFunc(signIn.link)))
	mux.Handle(StateGetRoute, protected(http.HandlerFunc(state.get)))
	mux.Handle(StatePutRoute, protected(http.HandlerFunc(state.put)))
	mux.Handle(AuditJobCreateRoute, protected(http.HandlerFunc(jobs.create)))
	mux.Handle(AuditJobLatestRoute, protected(http.HandlerFunc(jobs.latest)))
	mux.Handle(AuditJobCancelRoute, protected(http.HandlerFunc(jobs.cancel)))
	mux.Handle(PushKeyRoute, protected(http.HandlerFunc(c.pushes.key)))
	mux.Handle(PushSubscribeRoute, protected(http.HandlerFunc(c.pushes.subscribe)))
	mux.Handle(PushUnsubscribeRoute, protected(http.HandlerFunc(c.pushes.unsubscribe)))
	mux.Handle(RefsOrderRoute, protected(http.HandlerFunc(refsMaster.order)))
	mux.Handle(RefsStatusRoute, protected(http.HandlerFunc(refsMaster.status)))
	mux.Handle(RefsMadeRoute, protected(http.HandlerFunc(refsMaster.made)))
	mux.Handle(RefsFileRoute, protected(http.HandlerFunc(refsMaster.file)))
	mux.Handle(IntakeSubmitRoute, protected(http.HandlerFunc(intakes.submit)))
	mux.Handle(IntakeLatestRoute, protected(http.HandlerFunc(intakes.latest)))
	mux.Handle(FeedbackSubmitRoute, protected(http.HandlerFunc(c.feedbackHandler().submit)))
	return withCORS(options.AllowedOrigins, withLogging(c.logger, withRecover(c.logger, mux)))
}

func NewAdminHandler(options Options) http.Handler {
	c := newCore(options)
	admin := &adminHandler{accounts: c.people, logger: c.logger}
	jobs := &auditJobsHandler{accounts: c.people, intakes: c.intake, keeper: c.keeper, logger: c.logger}
	intakes := c.intakeHandler()

	mux := http.NewServeMux()
	mux.HandleFunc(HealthRoute, healthHandler(options.Ping, c.logger))
	mux.HandleFunc(AdminMastersRoute, admin.list)
	mux.HandleFunc(AdminCreateMasterRoute, admin.create)
	mux.HandleFunc(AdminEventsRoute, admin.events)
	mux.HandleFunc(AdminVersionsRoute, admin.versions)
	mux.HandleFunc(AdminExportRoute, admin.export)
	mux.HandleFunc(AdminDeleteMasterRoute, admin.deleteMaster)
	mux.HandleFunc(AdminRestoreRoute, admin.restore)
	mux.HandleFunc(AdminDisableMasterRoute, admin.disable)
	mux.HandleFunc(AdminAuditJobsRoute, jobs.list)
	mux.HandleFunc(AdminLocationRoute, (&placeHandler{keeper: c.keeper}).set)
	mux.HandleFunc(AdminPushRoute, c.pushes.adminSend)
	mux.HandleFunc(AdminIntakesRoute, intakes.list)
	mux.HandleFunc(AdminFeedbackRoute, c.feedbackHandler().list)
	mux.HandleFunc(AdminDigestRoute, digestHandler(options.Digest, c.logger))
	mux.HandleFunc(AdminPlanRoute, intakes.deliverPlan)
	mux.HandleFunc(AdminRefsDeliverRoute, intakes.deliverRefs)
	mux.HandleFunc(AdminRefsClearRoute, intakes.clearRefs)

	agent := &agentHandler{auditJobsHandler: *jobs, generator: options.Auditor}
	mux.HandleFunc(AgentNextRoute, agent.next)
	mux.HandleFunc(AgentResultRoute, agent.result)
	mux.HandleFunc(AgentFailRoute, agent.fail)
	if c.refsOn {
		refsAgent := &refsAgentHandler{refsHandler: *c.refsHandler()}
		mux.HandleFunc(AgentRefsNextRoute, refsAgent.next)
		mux.HandleFunc(AgentRefsResultRoute, refsAgent.result)
		mux.HandleFunc(AgentRefsFailRoute, refsAgent.fail)
	}
	if options.Shutdown != nil {
		mux.HandleFunc(AdminShutdownRoute, func(w http.ResponseWriter, _ *http.Request) {
			c.logger.Warn("shutdown requested through the admin port")
			writeJSON(w, http.StatusOK, map[string]bool{"shuttingDown": true})
			time.AfterFunc(ShutdownDelay, options.Shutdown)
		})
	}
	return withLogging(c.logger, withRecover(c.logger, withLocalOnly(mux)))
}
