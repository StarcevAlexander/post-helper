package httpapi

import "time"

const (
	ChatRoute     = "POST /api/chat"
	StrategyRoute = "POST /api/strategy"
	HealthRoute   = "GET /healthz"
)

const HealthPath = "/healthz"

const (
	IngestRoute          = "POST /api/ingest"
	HistoryRoute         = "GET /api/history"
	EventsRoute          = "GET /api/events"
	ErrorsRoute          = "GET /api/errors"
	ClientErrorRoute     = "POST /api/client-error"
	MaxIngestBodyBytes   = 16 << 20
	MaxIngestMessages    = 2000
	MaxClientErrorBytes  = 32 << 10
	MsgBadIngest         = "Неверный пакет сообщений"
	MsgHistoryFailed     = "Не удалось прочитать из базы"
	QueryConversation    = "conversation"
	QuerySource          = "source"
	QueryLimit           = "limit"
	QueryKind            = "kind"
	FieldConversation    = "conversation"
	maxClientErrorFields = 2000
)

const (
	FieldText    = "text"
	FieldHistory = "history"
	FieldFiles   = "files"
)

const (
	MaxBodyBytes  int64 = 25 << 20
	MaxFormMemory int64 = 8 << 20
	MaxFiles            = 8
	AuthFailDelay       = 400 * time.Millisecond
	CORSMaxAge          = "600"
	CORSMethods         = "GET, POST, PUT, OPTIONS"
	CORSHeaders         = "Authorization, Content-Type"
	BearerPrefix        = "Bearer "
)

const (
	MsgUnauthorized    = "Неверный пароль"
	MsgBadRequest      = "Не удалось разобрать запрос"
	MsgBadHistory      = "Не удалось разобрать историю беседы"
	MsgEmptyMessage    = "Напишите текст или приложите файл"
	MsgTooManyFiles    = "Слишком много файлов"
	MsgTooLarge        = "Файлы слишком большие"
	MsgUnsupportedFile = "Этот тип файла не поддерживается"
	MsgUpstreamFailed  = "Помощник временно недоступен, попробуйте ещё раз"
)

const (
	MaxStrategyBodyBytes    int64 = 32 << 10
	MaxProfileFieldRunes          = 1500
	MsgStrategyFailed             = "Не удалось составить стратегию, попробуйте ещё раз"
	MsgStrategyRefused            = "С такой анкетой я стратегию составить не могу. Опишите свою работу иначе"
	MsgStrategyInsufficient       = "Не хватает данных для стратегии. "
	MsgNoSpecialty                = "Расскажите, чем вы занимаетесь"
	MsgProfileTooLong             = "Ответ в анкете слишком длинный"
)

const (
	KitRoute                 = "POST /api/kit"
	MaxKitBodyBytes    int64 = 32 << 10
	MaxKitFieldRunes         = 600
	MsgKitFailed             = "Не удалось подготовить комплект, попробуйте ещё раз"
	MsgKitRefused            = "Для этой идеи комплект подготовить не получилось. Попробуйте другую публикацию"
	MsgBadFormat             = "Неизвестный формат публикации"
	MsgNoIdea                = "Не указана идея публикации"
	MsgKitFieldTooLong       = "Описание публикации слишком длинное"
)

const (
	MeRoute                       = "GET /api/me"
	StateGetRoute                 = "GET /api/state"
	StatePutRoute                 = "PUT /api/state"
	AdminMastersRoute             = "GET /api/admin/masters"
	AdminCreateMasterRoute        = "POST /api/admin/masters"
	AdminDisableMasterRoute       = "POST /api/admin/masters/{id}/disabled"
	ReviewRoute                   = "POST /api/review"
	MaxStateBodyBytes       int64 = 3 << 20
	MaxMasterNameRunes            = 60
	MaxReviewItems                = 60
	MaxReviewPillars              = 12
	MaxReviewFieldRunes           = 600
	MsgForbidden                  = "Это действие доступно только владельцу"
	MsgMasterOnly                 = "Это действие доступно только мастеру"
	MsgQuotaExceeded              = "Дневной лимит обращений к ИИ исчерпан, попробуйте завтра"
	MsgBadState                   = "Не удалось разобрать сохранённые данные"
	MsgStateConflict              = "Данные уже изменены с другого устройства"
	MsgStateFailed                = "Не удалось сохранить данные, попробуйте ещё раз"
	MsgNoMasterName               = "Укажите имя мастера"
	MsgMasterNameTooLong          = "Имя мастера слишком длинное"
	MsgMasterFailed               = "Не удалось выполнить действие с мастером"
	MsgReviewFailed               = "Не удалось подвести итоги, попробуйте ещё раз"
	MsgReviewRefused              = "Итоги по этим данным подвести не получилось"
	MsgReviewTooLarge             = "Слишком много данных для итогов недели"
	MsgNoReviewItems              = "В недельном плане нет публикаций"
	UsageChat                     = "chat"
	UsageStrategy                 = "strategy"
	UsageKit                      = "kit"
	UsageReview                   = "review"
)

const MaxAdminBodyBytes int64 = 4 << 10

const (
	AuditRoute               = "POST /api/audit"
	FieldProfile             = "profile"
	FieldImages              = "images"
	MaxAuditBodyBytes  int64 = 52 << 20
	MsgNoImages              = "Приложите скриншоты профиля"
	MsgTooManyImages         = "Слишком много скриншотов, достаточно восьми"
	MsgAuditFailed           = "Не удалось разобрать профиль, попробуйте ещё раз"
	MsgAuditRefused          = "По этим скриншотам разбор подготовить не получилось"
	MsgAuditUnreadable       = "Скриншоты не подошли: "
	UsageAudit               = "audit"
)
