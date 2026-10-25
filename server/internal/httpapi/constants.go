package httpapi

import "time"

const (
	HealthRoute = "GET /healthz"
)

const HealthPath = "/healthz"

const (
	ClientErrorRoute     = "POST /api/client-error"
	MaxClientErrorBytes  = 32 << 10
	QueryLimit           = "limit"
	maxClientErrorFields = 2000
)

const (
	FieldFiles = "files"
)

const (
	MaxFormMemory  int64 = 8 << 20
	AuthFailDelay        = 400 * time.Millisecond
	journalTimeout       = 5 * time.Second
	SniffLength          = 512
	RequestTimeout       = 120 * time.Second
	CORSMaxAge           = "600"
	CORSMethods          = "GET, POST, PUT, DELETE, OPTIONS"
	CORSHeaders          = "Authorization, Content-Type"
	BearerPrefix         = "Bearer "
)

const (
	MsgUnauthorized    = "Неверный пароль"
	MsgAuthUnavailable = "Сервис временно недоступен, попробуйте позже"
	MsgBadRequest      = "Не удалось разобрать запрос"
	MsgEmptyMessage    = "Напишите текст или приложите файл"
	MsgTooLarge        = "Файлы слишком большие"
	MsgUnsupportedFile = "Этот тип файла не поддерживается"
	MsgUpstreamFailed  = "Помощник временно недоступен, попробуйте ещё раз"
)

const (
	MeRoute                       = "GET /api/me"
	MeRenameRoute                 = "POST /api/me/name"
	AdminShutdownRoute            = "POST /api/admin/shutdown"
	ShutdownDelay                 = 300 * time.Millisecond
	AuthConfigRoute               = "GET /api/auth/config"
	AuthYandexRoute               = "POST /api/auth/yandex"
	MeYandexRoute                 = "POST /api/me/yandex"
	StateGetRoute                 = "GET /api/state"
	StatePutRoute                 = "PUT /api/state"
	AdminMastersRoute             = "GET /api/admin/masters"
	AdminCreateMasterRoute        = "POST /api/admin/masters"
	AdminDisableMasterRoute       = "POST /api/admin/masters/{id}/disabled"
	AdminLocationRoute            = "POST /api/admin/masters/{id}/location"
	MaxStateBodyBytes       int64 = 3 << 20
	MaxMasterNameRunes            = 60
	MsgBadState                   = "Не удалось разобрать сохранённые данные"
	MsgStateConflict              = "Данные уже изменены с другого устройства"
	MsgStateFailed                = "Не удалось сохранить данные, попробуйте ещё раз"
	MsgNoMasterName               = "Укажите имя мастера"
	MsgMasterNameTooLong          = "Имя мастера слишком длинное"
	MsgRenameFailed               = "Не удалось сменить имя"
	MsgYandexRejected             = "Яндекс не подтвердил вход. Попробуйте ещё раз"
	MsgYandexUnavailable          = "Яндекс сейчас недоступен. Попробуйте позже"
	MsgYandexTaken                = "Этот Яндекс-аккаунт уже привязан к другому мастеру"
	MsgAccessDisabled             = "Доступ для этого аккаунта отключён"
	MsgTooManySignIns             = "Слишком много попыток входа. Подождите минуту"
	MsgSignInFailed               = "Не удалось войти. Попробуйте ещё раз"
	DefaultMasterName             = "Мастер"
	MaxYandexCodeBytes            = 4096
	SignInLimitPerWindow          = 10
	SignInLimitWindow             = time.Minute
	MsgMasterNotFound             = "Мастер не найден"
	MsgBadPlace                   = "Укажите населённый пункт и, если знаете, часовой пояс IANA, например Asia/Irkutsk"
	MsgPlaceUnknown               = "Не удалось определить часовой пояс по населённому пункту, укажите его явно"
	MsgMasterFailed               = "Не удалось выполнить действие с мастером"
)

const MaxAdminBodyBytes int64 = 4 << 10

const (
	FieldImages              = "images"
	MaxAuditBodyBytes  int64 = 52 << 20
	MsgNoImages              = "Приложите скриншоты профиля"
	MsgTooManyImages         = "Слишком много скриншотов, достаточно восьми"
	MsgAuditFailed           = "Не удалось разобрать профиль, попробуйте ещё раз"
	MsgAuditRefused          = "По этим скриншотам разбор подготовить не получилось"
	MsgAuditUnreadable       = "Скриншоты не подошли: "
)

const (
	AdminEventsRoute       = "GET /api/admin/masters/{id}/events"
	AdminVersionsRoute     = "GET /api/admin/masters/{id}/versions"
	AdminExportRoute       = "GET /api/admin/masters/{id}/export"
	AdminDeleteMasterRoute = "DELETE /api/admin/masters/{id}"
	AdminRestoreRoute      = "POST /api/admin/masters/{id}/restore"
	MsgNoVersion           = "Такой версии нет в истории"
	MsgRestoreFailed       = "Не удалось вернуть версию"
	UsageAdminRestore      = "admin.restore"
	MaxEventsLimit         = 500
	ExportFileNameFormat   = "master-%s-export.json"
)

const (
	AuditJobCreateRoute = "POST /api/audit/jobs"
	AuditJobLatestRoute = "GET /api/audit/jobs/latest"
	AuditJobCancelRoute = "POST /api/audit/jobs/{id}/cancel"
	AgentNextRoute      = "GET /api/agent/jobs/next"
	AgentResultRoute    = "POST /api/agent/jobs/{id}/result"
	AgentFailRoute      = "POST /api/agent/jobs/{id}/fail"
	AdminAuditJobsRoute = "GET /api/admin/audit-jobs"
	FieldData           = "data"
	JobLease            = 20 * time.Minute
	MaxJobReasonRunes   = 300
	MsgConsentRequired  = "Нужно согласие на разбор вашего открытого аккаунта"
	MsgBadHandle        = "Не удалось понять ссылку или ник. Пример: anna_nails или instagram.com/anna_nails* (* Instagram принадлежит Meta, запрещённой в РФ)"
	MsgJobActive        = "Разбор уже заказан и ещё не закончен"
	MsgJobFailed        = "Не удалось выполнить действие с заказом на разбор"
	MsgJobNotFound      = "Заказ на разбор не найден"
	MsgJobState         = "Заказ в другом состоянии"
	MsgBadCollected     = "Не удалось разобрать данные профиля"
	UsageAuditJob       = "audit.job"
	EventJobCreated     = "audit.job.created"
	EventJobFailed      = "audit.job.failed"
)

type JobProfile struct {
	Name      string `json:"name,omitempty"`
	Specialty string `json:"specialty,omitempty"`
	City      string `json:"city,omitempty"`
}

const (
	RefsOrderRoute       = "POST /api/refs/order"
	RefsStatusRoute      = "GET /api/refs/status"
	RefsFileRoute        = "GET /api/refs/files/{id}"
	AgentRefsNextRoute   = "GET /api/agent/refs/next"
	AgentRefsResultRoute = "POST /api/agent/refs/{id}/result"
	AgentRefsFailRoute   = "POST /api/agent/refs/{id}/fail"

	MaxRefsOrderBytes  int64 = 128 << 10
	MaxRefsResultBytes int64 = 24 << 20

	MsgRefsFailed   = "Не удалось обработать референсы"
	MsgRefsNotFound = "Референс не найден"
	MsgRefsState    = "Референс уже в другом состоянии"
	MsgRefsTooMany  = "Слишком много пунктов плана"
	MsgRefsFiles    = "Нужно от 1 до 6 файлов"
)

const (
	IntakeSubmitRoute           = "POST /api/intake"
	IntakeLatestRoute           = "GET /api/intake"
	AdminIntakesRoute           = "GET /api/admin/intakes"
	AdminPlanRoute              = "POST /api/admin/masters/{id}/plan"
	AdminRefsDeliverRoute       = "POST /api/admin/masters/{id}/refs/{key}"
	AdminRefsClearRoute         = "DELETE /api/admin/masters/{id}/refs"
	QueryStatus                 = "status"
	EventPlanDelivered          = "plan.delivered"
	MaxIntakeBodyBytes    int64 = 96 << 10
	MaxPlanBodyBytes      int64 = 512 << 10
	MsgIntakeFailed             = "Не удалось обработать заявку, попробуйте ещё раз"
	MsgIntakeNoLinks            = "Добавьте хотя бы одну ссылку на свою соцсеть"
	MsgIntakeTooManyLinks       = "Слишком много ссылок"
	MsgIntakeTooManyRefs        = "Слишком много референсов, оставьте самые важные"
	MsgIntakeBadCity            = "Не удалось понять населённый пункт. Напишите его название коротко, например Иркутск"
	MsgIntakeBadLink            = "Не удалось понять ссылку. Пример: instagram.com/anna_nails* или t.me/anna_nails (* Instagram принадлежит Meta, запрещённой в РФ)"
	MsgIntakeBadGoal            = "Неизвестная цель в списке"
	MsgIntakeNoGoals            = "Отметьте хотя бы одну цель"
	MsgIntakeLongNote           = "Пожелания слишком длинные, сократите до двух тысяч знаков"
	MsgBadPlan                  = "Не удалось разобрать план"
	MsgPlanFailed               = "Не удалось сохранить план"
	MsgRefsNoItem               = "Такой публикации нет в календаре мастера"
)

type AdminLocationRequest struct {
	City     string `json:"city"`
	Timezone string `json:"timezone"`
}

type IntakeRequest struct {
	Links      []string            `json:"links"`
	References []string            `json:"references"`
	Goals      []string            `json:"goals"`
	Note       string              `json:"note"`
	Review     bool                `json:"review"`
	City       string              `json:"city"`
	TimeZone   string              `json:"timeZone"`
	Stats      *IntakeStatsRequest `json:"stats"`
}

type IntakeStatsRequest struct {
	Followers *int   `json:"followers"`
	Reach     *int   `json:"reach"`
	BestPost  string `json:"bestPost"`
}

const (
	PushKeyRoute         = "GET /api/push/key"
	PushSubscribeRoute   = "POST /api/push/subscribe"
	PushUnsubscribeRoute = "POST /api/push/unsubscribe"
	AdminPushRoute       = "POST /api/admin/masters/{id}/push"

	MaxPushBodyBytes int64 = 8 << 10

	MsgPushOff        = "Уведомления на сервере не включены"
	MsgPushBadRequest = "Не удалось разобрать подписку на уведомления"
	MsgPushBadMessage = "Нужен заголовок до 80 знаков, текст до 300 и ссылка вида ./…"
	MsgPushFailed     = "Не удалось сохранить подписку на уведомления"

	PushPlanTitle = "План готов"
	PushPlanBody  = "Ваш контент-план составлен. Откройте приложение и посмотрите календарь публикаций."
	PushPlanURL   = "./"

	PushRefsTitle = "Референсы готовы"
	PushRefsBody  = "Фото и видео к публикациям вашего плана уже в приложении. Откройте календарь и посмотрите."
	PushRefsURL   = "./"

	EventPushSent = "push.sent"
)

const (
	RefsMadeRoute = "POST /api/refs/made"
	MsgRefsBusy   = "Референсы сейчас делаются, подтвердите чуть позже"
)

const (
	FeedbackSubmitRoute          = "POST /api/feedback"
	AdminFeedbackRoute           = "GET /api/admin/feedback"
	MaxFeedbackBodyBytes   int64 = 16 << 10
	MaxFeedbackList              = 200
	MsgFeedbackFailed            = "Не удалось отправить сообщение, попробуйте ещё раз"
	MsgFeedbackEmpty             = "Напишите, что случилось или что хотите предложить"
	MsgFeedbackLongText          = "Сообщение слишком длинное, сократите до двух тысяч знаков"
	MsgFeedbackLongContact       = "Контакт слишком длинный, достаточно ссылки или номера"
	MsgFeedbackTooMany           = "Вы уже отправили несколько сообщений. Подождите час и напишите снова"
)

type FeedbackRequest struct {
	Text    string `json:"text"`
	Contact string `json:"contact"`
	ItemID  string `json:"itemId"`
}

const (
	AdminDigestRoute = "POST /api/admin/digest"
	MsgDigestOff     = "Дайджест владельцу не настроен: нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID"
	MsgDigestFailed  = "Не удалось отправить дайджест"
	MsgIntakeBadStat = "Цифры за месяц: подписчики и охват это целые числа, лучшая публикация до 300 знаков"
)

type DigestResponse struct {
	Text string `json:"text"`
}

const (
	HeaderOrigin      = "Origin"
	HeaderFetchSite   = "Sec-Fetch-Site"
	FetchSiteNone     = "none"
	LoopbackHostV4    = "127.0.0.1"
	LoopbackHostName  = "localhost"
	LoopbackHostV6    = "::1"
	MsgAdminForbidden = "Админский порт доступен только локальным скриптам"
)

const (
	HeaderForwardedFor        = "X-Forwarded-For"
	ClientErrorLimitPerWindow = 30
	ClientErrorLimitWindow    = time.Hour
	MaxLimiterKeys            = 10000
	HealthPingTimeout         = 3 * time.Second
	MsgTooManyClientErrors    = "Слишком много отчётов об ошибках, подождите"
	MsgPlanRefsFailed         = "План сохранён, но заказать референсы не удалось: повторите отправку плана"
)
