package media

import (
	"crypto/rand"
	"encoding/hex"
	"mime"
	"path"
	"strings"
	"unicode/utf8"
)

func NewID() string {
	buffer := make([]byte, 8)
	_, _ = rand.Read(buffer)
	return hex.EncodeToString(buffer)
}

func ValidFormat(format string) bool {
	return format == FormatReels || format == FormatPost || format == FormatStories
}

func ValidPreset(preset string) bool {
	switch preset {
	case PresetClean, PresetWarm, PresetCool, PresetSoft, PresetBright, PresetNone:
		return true
	}
	return false
}

func ValidFocus(focus string) bool {
	return focus == FocusTop || focus == FocusCenter || focus == FocusBottom
}

func KindOf(mediaType string) (string, bool) {
	kind, ok := typeKinds[mediaType]
	return kind, ok
}

func ResolveType(contentType, fileName string) string {
	declared := ""
	if parsed, _, err := mime.ParseMediaType(contentType); err == nil {
		declared = strings.ToLower(parsed)
	}
	if declared != "" && declared != OctetStreamType {
		return declared
	}
	return extensionTypes[strings.ToLower(path.Ext(fileName))]
}

func Extension(mediaType string) string {
	return typeExtensions[mediaType]
}

func Truncate(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit])
}

func CleanSegments(segments []Segment) []Segment {
	cleaned := make([]Segment, 0, len(segments))
	for _, segment := range segments {
		text := strings.TrimSpace(segment.Text)
		if text == "" || segment.Start < 0 || segment.End <= segment.Start {
			continue
		}
		cleaned = append(cleaned, Segment{Start: segment.Start, End: segment.End, Text: Truncate(text, MaxSubtitleRunes)})
		if len(cleaned) == MaxSegments {
			break
		}
	}
	return cleaned
}

func DefaultPlan(segments []Segment, masterNote string) Plan {
	return Plan{
		Preset:    PresetClean,
		Focus:     FocusCenter,
		Subtitles: CleanSegments(segments),
		Note:      DefaultNote,
		Caption:   Truncate(strings.TrimSpace(masterNote), MaxCaptionRunes),
		Source:    PlanSourceDefault,
	}
}

func RefOf(masterID, id, part, mediaType string) string {
	return masterID + "/" + id + "-" + part + Extension(mediaType)
}
