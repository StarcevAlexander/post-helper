package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"post-helper/server/internal/feedback"
	"post-helper/server/internal/intake"
)

func TestTheMasterAsksToReplaceAnIdeaAndTheOwnerSeesWhichPublication(t *testing.T) {
	fixture := newFeedbackFixture(t)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", testPassword, planJSON)

	response := fixture.call(http.MethodPost, "/api/feedback", code, `{"text":"Хочу про уход за блондом, не тонирование","itemId":"w1-a"}`)
	sent := fixture.notifier.wait(t)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status %d %s", response.Code, response.Body)
	}
	for _, want := range []string{"заменить идею", "Reels, 2026-10-26 19:00: Тонирование", "(id w1-a)", "про уход за блондом", `kits["w1-a"]`, master.ID} {
		if !strings.Contains(sent, want) {
			t.Errorf("notification lacks %q:\n%s", want, sent)
		}
	}
	saved, _ := fixture.messages.List(context.Background(), 10)
	if len(saved) != 1 || saved[0].ItemID != "w1-a" || !strings.Contains(saved[0].ItemLabel, "Тонирование") {
		t.Fatalf("saved = %+v", saved)
	}
	listed := fixture.call(http.MethodGet, "/api/admin/feedback", "", "")
	if !strings.Contains(listed.Body.String(), `"itemId":"w1-a"`) {
		t.Errorf("admin list lacks the item: %s", listed.Body)
	}
}

func TestReplacingAnUnknownPublicationIsRefused(t *testing.T) {
	fixture := newFeedbackFixture(t)
	code, _ := fixture.master(t, "Анна")

	missing := fixture.call(http.MethodPost, "/api/feedback", code, `{"text":"Другое","itemId":"nope"}`)
	malformed := fixture.call(http.MethodPost, "/api/feedback", code, `{"text":"Другое","itemId":"has space"}`)

	if missing.Code != http.StatusNotFound || malformed.Code != http.StatusBadRequest {
		t.Fatalf("missing %d, malformed %d", missing.Code, malformed.Code)
	}
	if saved, _ := fixture.messages.List(context.Background(), 10); len(saved) != 0 {
		t.Errorf("saved %d messages for an unknown publication", len(saved))
	}
}

func TestTheOwnerReadsTheMonthNumbersOfTheMaster(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, _ := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/intake", code,
		`{"links":["vk.com/anna"],"goals":["reach"],"review":true,"stats":{"followers":340,"reach":12500,"bestPost":"Сторис про спину"}}`)
	sent := fixture.notifier.wait(t)
	list := fixture.call(http.MethodGet, "/api/admin/intakes?status=new", testPassword, "")

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"stats":{"followers":340,"reach":12500,"bestPost":"Сторис про спину"}`) {
		t.Fatalf("submit = %d %s", response.Code, response.Body)
	}
	for _, want := range []string{"Цифры за месяц", "Подписчиков сейчас: 340", "Охват за месяц: 12500", "Лучшая публикация: Сторис про спину"} {
		if !strings.Contains(sent, want) {
			t.Errorf("notification lacks %q:\n%s", want, sent)
		}
	}
	if !strings.Contains(list.Body.String(), `"followers":340`) {
		t.Errorf("list lacks the stats: %s", list.Body)
	}
}

func TestBadMonthNumbersAreRefusedAndEmptyOnesAreDropped(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, _ := fixture.master(t, "Анна")

	negative := fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"stats":{"followers":-1}}`)
	long := fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"stats":{"bestPost":"`+strings.Repeat("я", intake.MaxBestPostRunes+1)+`"}}`)
	empty := fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"stats":{"bestPost":"  "}}`)
	fixture.notifier.wait(t)

	if negative.Code != http.StatusBadRequest || long.Code != http.StatusBadRequest {
		t.Errorf("negative %d, long %d", negative.Code, long.Code)
	}
	if empty.Code != http.StatusOK || strings.Contains(empty.Body.String(), `"stats"`) {
		t.Errorf("empty stats = %d %s", empty.Code, empty.Body)
	}
}

type fakeDigest struct {
	err error
}

func (f fakeDigest) Send(context.Context) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	return "Недельный дайджест", nil
}

func TestTheOwnerSendsTheDigestOnDemandThroughTheAdminPort(t *testing.T) {
	fixture := newAccountFixture(t, 5)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	off := fixture.call(http.MethodPost, "/api/admin/digest", "", "")
	fixture.handler = bothHandlers(Options{Accounts: fixture.store, Digest: fakeDigest{}, Logger: logger})
	sent := fixture.call(http.MethodPost, "/api/admin/digest", "", "")
	fixture.handler = bothHandlers(Options{Accounts: fixture.store, Digest: fakeDigest{err: errors.New("telegram down")}, Logger: logger})
	failed := fixture.call(http.MethodPost, "/api/admin/digest", "", "")
	public := NewHandler(Options{Accounts: fixture.store, Digest: fakeDigest{}, Feedback: feedback.NewMemory(), Logger: logger})

	if off.Code != http.StatusServiceUnavailable {
		t.Errorf("without telegram = %d", off.Code)
	}
	if sent.Code != http.StatusOK || !strings.Contains(sent.Body.String(), "Недельный дайджест") {
		t.Errorf("sent = %d %s", sent.Code, sent.Body)
	}
	if failed.Code != http.StatusBadGateway {
		t.Errorf("failed = %d", failed.Code)
	}
	request, _ := http.NewRequest(http.MethodPost, "/api/admin/digest", nil)
	recorder := httptest.NewRecorder()
	public.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Errorf("public port answered %d", recorder.Code)
	}
}

func TestTheOwnerReadsWhenTheMasterIsAvailable(t *testing.T) {
	fixture := newIntakeFixture(t)
	code, _ := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/intake", code,
		`{"links":["vk.com/anna"],"goals":["reach"],"schedule":{"shootDays":[3,1],"shootTime":"11:00","publishTime":"19:30"}}`)
	sent := fixture.notifier.wait(t)
	list := fixture.call(http.MethodGet, "/api/admin/intakes?status=new", testPassword, "")

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"schedule":{"shootDays":[1,3],"shootTime":"11:00","publishTime":"19:30"}`) {
		t.Fatalf("submit = %d %s", response.Code, response.Body)
	}
	for _, want := range []string{"Когда мастеру удобно", "Дни съёмки: вторник, четверг", "Время съёмки: 11:00", "Время публикаций: 19:30"} {
		if !strings.Contains(sent, want) {
			t.Errorf("telegram lacks %q:\n%s", want, sent)
		}
	}
	if !strings.Contains(list.Body.String(), `"shootDays":[1,3]`) {
		t.Errorf("list lacks the schedule: %s", list.Body)
	}

	bad := fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"schedule":{"shootDays":[9]}}`)
	empty := fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"schedule":{"shootDays":[],"shootTime":" "}}`)
	if bad.Code != http.StatusBadRequest || !strings.Contains(bad.Body.String(), MsgIntakeBadSchedule) {
		t.Errorf("bad schedule = %d %s", bad.Code, bad.Body)
	}
	if empty.Code != http.StatusOK || strings.Contains(empty.Body.String(), `"schedule"`) {
		t.Errorf("empty schedule = %d %s", empty.Code, empty.Body)
	}
}
