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
	MaxCaptionRunes = 200
	MaxOutputTokens = 1500
)

var (
	ErrNotFound = errors.New("ref not found")
	ErrState    = errors.New("ref is in another state")
	ErrBadPlan  = errors.New("bad prompts")
	ErrRefused  = errors.New("prompts refused")
)

func KindFor(format string) string {
	if format == FormatReels {
		return KindVideo
	}
	return KindPhoto
}

func ValidFormat(format string) bool {
	return format == FormatReels || format == FormatPost || format == FormatStories
}

const SystemPrompt = `Ты помогаешь мастеру бьюти-сферы увидеть, как может выглядеть кадр будущей публикации. Тебе дают анкету мастера и один пункт плана: формат, рубрику и идею. По ним нужно написать ровно 3 разных промпта для локальной нейросети, которая рисует низкокачественные референсы: фото или короткое видео без звука.

Ответь строго одним JSON-объектом без markdown и пояснений:
{"prompts":[{"prompt":"...","caption":"..."},{"prompt":"...","caption":"..."},{"prompt":"...","caption":"..."}]}

Правила:
- prompt: на английском, одно-два предложения, конкретная сцена: кто или что в кадре, действие, ракурс, свет, место. Для видео опиши короткое простое движение (рука разглаживает, камера плавно приближается). Без текста на изображении, без логотипов, без имён, без цен.
- Три промпта должны различаться ракурсом, планом или композицией, но все иллюстрировать одну идею. Не показывай лица крупным планом и узнаваемых людей, мастер снимет свою версию сам.
- caption: по-русски, одно предложение до 20 слов: что происходит в кадре и на что обратить внимание при съёмке. Звука и озвучки нет, это текст для чтения.
- Используй только то, что есть в анкете и идее. Ничего не выдумывай про услуги, которых нет.
- Выдай ровно один JSON-объект один раз.`
