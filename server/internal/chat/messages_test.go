package chat

import (
	"strings"
	"testing"
)

func TestHistoryMessages(t *testing.T) {
	longHistory := make([]Turn, 0, MaxHistoryTurns+10)
	for range MaxHistoryTurns + 10 {
		longHistory = append(longHistory, Turn{Role: RoleUser, Text: "вопрос"})
	}

	tests := []struct {
		name    string
		history []Turn
		want    int
	}{
		{name: "empty", history: nil, want: 0},
		{name: "leading assistant dropped", history: []Turn{{Role: RoleAssistant, Text: "привет"}, {Role: RoleUser, Text: "q"}}, want: 1},
		{name: "blank turns skipped", history: []Turn{{Role: RoleUser, Text: "  "}, {Role: RoleUser, Text: "q"}}, want: 1},
		{name: "unknown role skipped", history: []Turn{{Role: "system", Text: "x"}, {Role: RoleUser, Text: "q"}}, want: 1},
		{name: "capped", history: longHistory, want: MaxHistoryTurns},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := len(historyMessages(tt.history)); got != tt.want {
				t.Errorf("len = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestBuildAttachmentBlock(t *testing.T) {
	tests := []struct {
		name    string
		data    []byte
		wantErr bool
	}{
		{name: "png", data: []byte(testPNG)},
		{name: "pdf", data: []byte("%PDF-1.4\n1 0 obj\n")},
		{name: "text", data: []byte("просто заметки")},
		{name: "binary", data: []byte{0x00, 0x01, 0x02, 0xff, 0xfe}, wantErr: true},
		{name: "empty", data: nil, wantErr: true},
		{name: "invalid utf8 text", data: []byte(strings.Repeat("a", 10) + "\xff\xfe"), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := buildAttachmentBlock(Attachment{Name: "f", Data: tt.data})
			if (err != nil) != tt.wantErr {
				t.Errorf("err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
