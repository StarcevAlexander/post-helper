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
	CORSMethods         = "GET, POST, OPTIONS"
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
