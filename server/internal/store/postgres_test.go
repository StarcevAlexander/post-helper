package store

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Postgres {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	p, err := Open(context.Background(), url, slog.Default())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func waitFor(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("condition was not met in time")
}

func TestMessagesRoundTripAndDedupe(t *testing.T) {
	p := openTestStore(t)
	conversation := "test-" + time.Now().Format("150405.000000")
	batch := []Message{
		{Source: SourceApp, ConversationID: conversation, Role: RoleUser, Text: "привет", Attachments: []string{"a.png"}, CreatedAt: time.Now()},
		{Source: SourceApp, ConversationID: conversation, Role: RoleAssistant, Text: "здравствуйте", CreatedAt: time.Now().Add(time.Millisecond)},
		{Source: SourceClaudeCode, ConversationID: conversation, ExternalID: conversation + "-1", Role: RoleUser, Text: "из терминала"},
	}
	p.SaveMessages(batch)
	p.SaveMessages(batch[2:])

	var got []Message
	waitFor(t, func() bool {
		var err error
		got, err = p.Messages(context.Background(), MessageFilter{ConversationID: conversation})
		return err == nil && len(got) >= 3
	})
	time.Sleep(200 * time.Millisecond)
	got, err := p.Messages(context.Background(), MessageFilter{ConversationID: conversation})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 messages after dedupe, got %d", len(got))
	}
	if got[0].Text != "привет" || got[0].Attachments[0] != "a.png" || got[1].Role != RoleAssistant {
		t.Fatalf("unexpected order or content: %+v", got)
	}
	onlyApp, err := p.Messages(context.Background(), MessageFilter{Source: SourceApp, ConversationID: conversation})
	if err != nil || len(onlyApp) != 2 {
		t.Fatalf("source filter: %v, %d", err, len(onlyApp))
	}
}

func TestEventsAndErrors(t *testing.T) {
	p := openTestStore(t)
	marker := "marker-" + time.Now().Format("150405.000000")
	p.SaveEvent(EventChatRequest, marker, map[string]string{"request": "x"})
	p.SaveError(ErrorSourceClient, marker, map[string]string{"where": "test"})

	waitFor(t, func() bool {
		events, err := p.Events(context.Background(), EventChatRequest, 10)
		if err != nil {
			return false
		}
		for _, e := range events {
			if e.Ref == marker {
				return true
			}
		}
		return false
	})
	waitFor(t, func() bool {
		entries, err := p.Errors(context.Background(), 10)
		if err != nil {
			return false
		}
		for _, e := range entries {
			if e.Message == marker && e.Source == ErrorSourceClient {
				return true
			}
		}
		return false
	})
}

func TestErrorHandlerStoresOnlyErrors(t *testing.T) {
	p := openTestStore(t)
	marker := "slog-" + time.Now().Format("150405.000000")
	logger := slog.New(NewErrorHandler(slog.NewTextHandler(os.Stderr, nil), p)).With("component", "test")
	logger.Info("not stored " + marker)
	logger.Error(marker, slog.String("path", "/x"))

	waitFor(t, func() bool {
		entries, err := p.Errors(context.Background(), 20)
		if err != nil {
			return false
		}
		stored := false
		for _, e := range entries {
			if e.Message == "not stored "+marker {
				t.Fatal("info record must not be stored")
			}
			if e.Message == marker && e.Source == ErrorSourceServer {
				stored = true
			}
		}
		return stored
	})
}
