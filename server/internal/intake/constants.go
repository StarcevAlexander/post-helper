package intake

import (
	"errors"
	"time"
)

const (
	StatusNew   = "new"
	StatusReady = "ready"
)

const (
	MaxNetworks      = 12
	MaxGoals         = 12
	MaxURLRunes      = 300
	MaxNoteRunes     = 2000
	MaxReplyRunes    = 1000
	MinPathRunes     = 2
	TelegramTimeout  = 10 * time.Second
	TelegramBaseURL  = "https://api.telegram.org"
	TelegramMaxRunes = 3800
)

const (
	PlatformInstagram = "instagram"
	PlatformVK        = "vk"
	PlatformTelegram  = "telegram"
	PlatformYouTube   = "youtube"
	PlatformTikTok    = "tiktok"
	PlatformOK        = "ok"
	PlatformDzen      = "dzen"
	PlatformRutube    = "rutube"
	PlatformMax       = "max"
	PlatformOther     = "other"
)

var (
	ErrNotFound   = errors.New("intake request not found")
	ErrNoNetworks = errors.New("no social links")
	ErrTooMany    = errors.New("too many social links")
	ErrBadLink    = errors.New("bad social link")
	ErrBadGoal    = errors.New("unknown goal")
	ErrNoGoals    = errors.New("no goals")
	ErrLongText   = errors.New("text is too long")
)

var platformHosts = map[string]string{
	"instagram.com": PlatformInstagram,
	"vk.com":        PlatformVK,
	"vk.ru":         PlatformVK,
	"vkontakte.ru":  PlatformVK,
	"t.me":          PlatformTelegram,
	"telegram.me":   PlatformTelegram,
	"telegram.org":  PlatformTelegram,
	"youtube.com":   PlatformYouTube,
	"youtu.be":      PlatformYouTube,
	"tiktok.com":    PlatformTikTok,
	"ok.ru":         PlatformOK,
	"dzen.ru":       PlatformDzen,
	"zen.yandex.ru": PlatformDzen,
	"rutube.ru":     PlatformRutube,
	"max.ru":        PlatformMax,
}

var platformLabels = map[string]string{
	PlatformInstagram: "Instagram",
	PlatformVK:        "ВКонтакте",
	PlatformTelegram:  "Telegram",
	PlatformYouTube:   "YouTube",
	PlatformTikTok:    "TikTok",
	PlatformOK:        "Одноклассники",
	PlatformDzen:      "Дзен",
	PlatformRutube:    "RuTube",
	PlatformMax:       "MAX",
	PlatformOther:     "Сайт или другое",
}

var goalLabels = map[string]string{
	"reach":      "Увеличить охваты",
	"followers":  "Больше подписчиков",
	"leads":      "Больше заявок и записей",
	"check":      "Поднять средний чек",
	"repeat":     "Вернуть и удержать клиентов",
	"brand":      "Узнаваемость и личный бренд",
	"expert":     "Выглядеть экспертом, вызвать доверие",
	"premium":    "Привлечь платёжеспособных клиентов",
	"engagement": "Больше лайков, комментариев и сохранений",
	"schedule":   "Заполнить окна в расписании",
	"products":   "Продавать продукты, курсы и сертификаты",
	"system":     "Вести соцсети регулярно и без выгорания",
}
