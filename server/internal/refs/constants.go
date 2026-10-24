package refs

import (
	"errors"
	"time"
)

const (
	StatusQueued  = "queued"
	StatusRunning = "running"
	StatusDone    = "done"
	StatusFailed  = "failed"
	StatusMade    = "made"
)

const KindPhoto = "photo"

const (
	FormatReels   = "reels"
	FormatPost    = "post"
	FormatStories = "stories"
)

const (
	PerItem         = 3
	MaxOrderItems   = 120
	MaxFileBytes    = 6 * 1024 * 1024
	MaxAttempts     = 3
	Lease           = 45 * time.Minute
	StaleAfter      = 48 * time.Hour
	DateLayout      = "2006-01-02"
	MaxKeyRunes     = 80
	MaxFieldRunes   = 600
	MaxPromptRunes  = 700
	MaxCaptionRunes = 1200
	MaxOutputTokens = 4000
)

var (
	ErrNotFound = errors.New("ref not found")
	ErrState    = errors.New("ref is in another state")
	ErrBadPlan  = errors.New("bad prompts")
	ErrRefused  = errors.New("prompts refused")
)

func ValidFormat(format string) bool {
	return format == FormatReels || format == FormatPost || format == FormatStories
}

const SystemPrompt = `Ты помогаешь мастеру бьюти-сферы подготовиться к съёмочному дню. Тебе дают анкету мастера и один пункт плана: формат, рубрику и идею. По ним нужно придумать ровно 3 разных фото-референса к этой публикации: для каждого промпт для локальной нейросети, которая рисует низкокачественную картинку, и подробное описание кадра для мастера.

Ответь строго одним JSON-объектом без markdown и пояснений:
{"prompts":[{"prompt":"...","caption":"..."},{"prompt":"...","caption":"..."},{"prompt":"...","caption":"..."}]}

Правила:
- prompt: на английском, одно-два предложения, конкретная сцена для фотографии: кто или что в кадре, действие, ракурс, свет, место. Без текста на изображении, без логотипов, без имён, без цен.
- Три промпта должны различаться ракурсом, планом или композицией, но все иллюстрировать одну идею. Не показывай лица крупным планом и узнаваемых людей, мастер снимет свою версию сам.
- caption: по-русски, подробное описание кадра для съёмки, от трёх до пяти предложений (60-100 слов). Укажи: что в кадре, какой план и с какой точки снимать, какой свет и фон, какой реквизит нужен, что делают руки или модель, как повторить кадр своими материалами и чего избегать. Пиши так, чтобы мастер мог снять кадр без картинки, только по тексту.
- Используй только то, что есть в анкете и идее. Ничего не выдумывай про услуги, которых нет.
- Выдай ровно один JSON-объект один раз.`
