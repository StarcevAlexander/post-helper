package media

import (
	"errors"
	"time"
)

const (
	StatusQueued  = "queued"
	StatusRunning = "running"
	StatusDone    = "done"
	StatusFailed  = "failed"
)

const (
	KindPhoto = "photo"
	KindVideo = "video"
)

const (
	FormatReels   = "reels"
	FormatPost    = "post"
	FormatStories = "stories"
)

const (
	PresetClean  = "clean"
	PresetWarm   = "warm"
	PresetCool   = "cool"
	PresetSoft   = "soft"
	PresetBright = "bright"
	PresetNone   = "none"
)

const (
	FocusTop    = "top"
	FocusCenter = "center"
	FocusBottom = "bottom"
)

const (
	PlanSourceClaude  = "claude"
	PlanSourceDefault = "default"
)

const (
	MaxPerMaster      = 60
	MaxSourceBytes    = 300 << 20
	MaxResultBytes    = 400 << 20
	MaxThumbBytes     = 2 << 20
	MaxPreviewBytes   = 2 << 20
	MaxAttempts       = 3
	Lease             = 45 * time.Minute
	MaxKeyRunes       = 80
	MaxUnitRunes      = 120
	MaxFieldRunes     = 600
	MaxOverlayRunes   = 300
	MaxNameRunes      = 200
	MaxErrorRunes     = 300
	MaxNoteRunes      = 300
	MaxWishRunes      = 300
	MaxRedos          = 3
	MaxMasterNote     = 1000
	MaxCaptionRunes   = 900
	MaxTitleRunes     = 40
	MaxSubtitleRunes  = 200
	MaxSegments       = 400
	MaxAdminList      = 200
	MaxOutputTokens   = 8000
	TimeTolerance     = 0.5
	PlanTimeout       = 120 * time.Second
	DefaultNote       = "Подогнал под формат публикации"
	DefaultFailReason = "Не удалось обработать на ПК"
	PreviewMediaType  = "image/jpeg"
	ResultPhotoType   = "image/jpeg"
	ResultVideoType   = "video/mp4"
	OctetStreamType   = "application/octet-stream"
)

var (
	ErrNotFound     = errors.New("media not found")
	ErrState        = errors.New("media is in another state")
	ErrTooMany      = errors.New("too many media items")
	ErrRedoLimit    = errors.New("media was redone too many times")
	ErrBadPlan      = errors.New("bad media plan")
	ErrRefused      = errors.New("media plan refused")
	ErrNoFile       = errors.New("media file not found")
	ErrFileTooLarge = errors.New("media file is too large")
	ErrBadRef       = errors.New("bad media file reference")
)

var typeKinds = map[string]string{
	"image/jpeg":      KindPhoto,
	"image/png":       KindPhoto,
	"image/webp":      KindPhoto,
	"image/heic":      KindPhoto,
	"image/heif":      KindPhoto,
	"video/mp4":       KindVideo,
	"video/quicktime": KindVideo,
	"video/webm":      KindVideo,
	"video/3gpp":      KindVideo,
	"video/x-m4v":     KindVideo,
}

var extensionTypes = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".heic": "image/heic",
	".heif": "image/heif",
	".mp4":  "video/mp4",
	".mov":  "video/quicktime",
	".webm": "video/webm",
	".3gp":  "video/3gpp",
	".m4v":  "video/x-m4v",
}

var typeExtensions = map[string]string{
	"image/jpeg":      ".jpg",
	"image/png":       ".png",
	"image/webp":      ".webp",
	"image/heic":      ".heic",
	"image/heif":      ".heif",
	"video/mp4":       ".mp4",
	"video/quicktime": ".mov",
	"video/webm":      ".webm",
	"video/3gpp":      ".3gp",
	"video/x-m4v":     ".m4v",
}

const SystemPrompt = `Ты монтажёр-помощник мастера бьюти-сферы. Мастер снял фото или видео для публикации, и тебе нужно решить, как его обработать. Тебе дают сведения о мастере, идею и рубрику публикации, формат, текст на кадре из комплекта, размеры и длительность файла, расшифровку речи по отрезкам времени и уменьшенный кадр.

Ответь строго одним JSON-объектом без markdown и пояснений:
{"preset":"clean","focus":"center","title":"","subtitles":[{"start":0.0,"end":2.4,"text":"Привет!"}],"note":"...","caption":""}

Правила:
- preset: один из clean, warm, cool, soft, bright, none. По кадру выбери цветовую обработку: clean для нейтрального света, warm если кадр холодный или тусклый и нужна уютная теплота, cool для светлых «чистых» кадров, soft для мягкого воздушного вида, bright если кадр тёмный. none только если кадр уже идеален.
- focus: один из top, center, bottom. Куда смещать кадрирование, когда кадр режется под вертикальный или квадратный формат: top если важное в верхней части, bottom если внизу (руки, стол), иначе center.
- title: короткий заголовок для верхней части кадра, не длиннее 40 знаков. Бери его из текста на кадре из комплекта, если он есть и уместен. Иначе оставь пустую строку.
- subtitles: те же отрезки речи с теми же start и end, но с исправленной пунктуацией, без слов-паразитов и обрывков. Каждый текст не больше двух коротких строк, примерно по 32 знака в строке, перенос строки пиши как \n. Отрезки можно склеивать и делить, но времена должны оставаться внутри исходных. Если речи нет, верни пустой массив. Если мастер в пожелании просит убрать субтитры, тоже верни пустой массив. Ничего не выдумывай: только то, что было сказано.
- note: одна короткая фраза мастеру на русском, что именно ты сделал, например «Подровнял под 9:16, добавил тепла, наложил субтитры». Не обещай того, чего нет в ответе.
- caption: продающий текст публикации. Пиши его только из текста мастера, который дан в запросе, учитывая идею, рубрику, текст на кадре и речь. Если текста мастера нет, caption должен быть пустой строкой: без текста мастера подпись не нужна. Первая строка: цепляющий заголовок или крючок. Дальше польза для клиента. В конце призыв к действию: записаться или написать в директ. Пиши живым языком от первого лица мастера, 400-700 знаков, не больше 900. Без хэштегов, без обещаний результата медицинского характера, без англицизмов и канцелярита. Ничего не выдумывай про услуги, цены и сроки, которых нет в тексте мастера.
- Выдай ровно один JSON-объект один раз.`
