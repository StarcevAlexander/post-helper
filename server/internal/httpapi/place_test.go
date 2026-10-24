package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"post-helper/server/internal/accounts"
	"post-helper/server/internal/audit"
	"post-helper/server/internal/intake"
	"post-helper/server/internal/places"
)

type fakeResolver struct {
	mu       sync.Mutex
	location places.Location
	err      error
	queries  []places.Query
}

func (f *fakeResolver) Locate(_ context.Context, query places.Query) (places.Location, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.queries = append(f.queries, query)
	return f.location, f.err
}

func (f *fakeResolver) calls() []places.Query {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]places.Query(nil), f.queries...)
}

func waitUntil(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func newPlaceFixture(t *testing.T, resolver places.Resolver) *accountFixture {
	t.Helper()
	base := newAccountFixture(t, 50)
	base.handler = bothHandlers(Options{
		Accounts:       base.store,
		Intake:         intake.NewMemory(),
		Places:         resolver,
		RetentionDays:  1095,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return base
}

func masterOf(t *testing.T, f *accountFixture, id string) accounts.Master {
	t.Helper()
	master, err := f.store.GetMaster(context.Background(), id)
	if err != nil {
		t.Fatalf("GetMaster: %v", err)
	}
	return master
}

const intakeWithCity = `{"links":["vk.com/anna"],"goals":["reach"],"city":"  Иркутск ","timeZone":"Europe/Moscow","note":"Без танцев"}`

func TestIntakeSavesTheCityAndStartsWithTheZoneOfTheBrowser(t *testing.T) {
	resolver := &fakeResolver{err: places.ErrUnknown}
	fixture := newPlaceFixture(t, resolver)
	code, master := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/intake", code, intakeWithCity)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"city":"Иркутск"`) {
		t.Fatalf("submit = %d %s", response.Code, response.Body)
	}
	got := masterOf(t, fixture, master.ID)
	if got.City != "Иркутск" || got.Timezone != "Europe/Moscow" {
		t.Errorf("master = %+v", got)
	}
}

func TestTheZoneFoundByTheNetworkBeatsTheZoneOfTheBrowser(t *testing.T) {
	resolver := &fakeResolver{location: places.Location{City: "Иркутск", Zone: "Asia/Irkutsk"}}
	fixture := newPlaceFixture(t, resolver)
	code, master := fixture.master(t, "Анна")

	fixture.call(http.MethodPost, "/api/intake", code, intakeWithCity)

	waitUntil(t, "the found time zone", func() bool { return masterOf(t, fixture, master.ID).Timezone == "Asia/Irkutsk" })
	calls := resolver.calls()
	if len(calls) != 1 || calls[0].City != "Иркутск" || calls[0].Note != "Без танцев" {
		t.Errorf("calls = %+v", calls)
	}
}

func TestTheCityIsTakenFromTheNotesWhenTheFieldIsEmpty(t *testing.T) {
	resolver := &fakeResolver{location: places.Location{City: "Ангарск", Zone: "Asia/Irkutsk"}}
	fixture := newPlaceFixture(t, resolver)
	code, master := fixture.master(t, "Анна")
	body := `{"links":["vk.com/anna"],"goals":["reach"],"note":"Работаю в Ангарске, по вторникам свободна"}`

	response := fixture.call(http.MethodPost, "/api/intake", code, body)

	if response.Code != http.StatusOK {
		t.Fatalf("submit = %d %s", response.Code, response.Body)
	}
	waitUntil(t, "the place from the notes", func() bool {
		got := masterOf(t, fixture, master.ID)
		return got.City == "Ангарск" && got.Timezone == "Asia/Irkutsk"
	})
	if calls := resolver.calls(); len(calls) != 1 || calls[0].City != "" || !strings.Contains(calls[0].Note, "Ангарске") {
		t.Errorf("calls = %+v", calls)
	}
}

func TestTheNetworkIsNotAskedAgainForAKnownPlace(t *testing.T) {
	resolver := &fakeResolver{location: places.Location{City: "Иркутск", Zone: "Asia/Irkutsk"}}
	fixture := newPlaceFixture(t, resolver)
	code, master := fixture.master(t, "Анна")
	fixture.call(http.MethodPost, "/api/intake", code, intakeWithCity)
	waitUntil(t, "the found time zone", func() bool { return masterOf(t, fixture, master.ID).Timezone == "Asia/Irkutsk" })

	fixture.call(http.MethodPost, "/api/intake", code, intakeWithCity)
	fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"note":"Новые пожелания"}`)
	time.Sleep(100 * time.Millisecond)

	if calls := resolver.calls(); len(calls) != 1 {
		t.Errorf("calls = %+v", calls)
	}
}

func TestANewCityIsLookedUpAgain(t *testing.T) {
	resolver := &fakeResolver{location: places.Location{City: "Москва", Zone: "Europe/Moscow"}}
	fixture := newPlaceFixture(t, resolver)
	code, master := fixture.master(t, "Анна")
	_ = fixture.store.SetLocation(context.Background(), master.ID, "Иркутск", "Asia/Irkutsk")

	fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"city":"Москва"}`)

	waitUntil(t, "the new zone", func() bool { return masterOf(t, fixture, master.ID).Timezone == "Europe/Moscow" })
	if got := masterOf(t, fixture, master.ID); got.City != "Москва" {
		t.Errorf("master = %+v", got)
	}
}

func TestABrokenCityOrBrowserZoneIsHandledGently(t *testing.T) {
	resolver := &fakeResolver{err: places.ErrUnknown}
	fixture := newPlaceFixture(t, resolver)
	code, master := fixture.master(t, "Анна")

	bad := fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"city":"Иркутск<script>"}`)
	odd := fixture.call(http.MethodPost, "/api/intake", code, `{"links":["vk.com/anna"],"goals":["reach"],"city":"Иркутск","timeZone":"Mars/Base"}`)

	if bad.Code != http.StatusBadRequest || !strings.Contains(bad.Body.String(), "населённый пункт") {
		t.Errorf("bad city = %d %s", bad.Code, bad.Body)
	}
	if odd.Code != http.StatusOK {
		t.Fatalf("odd zone = %d %s", odd.Code, odd.Body)
	}
	if got := masterOf(t, fixture, master.ID); got.City != "Иркутск" || got.Timezone != "" {
		t.Errorf("the zone of the browser was not valid, nothing should be saved: %+v", got)
	}
}

func TestOwnerSetsThePlaceWithTheZone(t *testing.T) {
	fixture := newPlaceFixture(t, nil)
	_, master := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/location", "", `{"city":"Тюмень","timezone":"Asia/Yekaterinburg"}`)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"timezone":"Asia/Yekaterinburg"`) {
		t.Fatalf("response = %d %s", response.Code, response.Body)
	}
	if got := masterOf(t, fixture, master.ID); got.City != "Тюмень" || got.Timezone != "Asia/Yekaterinburg" {
		t.Errorf("master = %+v", got)
	}
}

func TestOwnerSetsThePlaceAndTheNetworkFindsTheZone(t *testing.T) {
	resolver := &fakeResolver{location: places.Location{City: "Тюмень", Zone: "Asia/Yekaterinburg"}}
	fixture := newPlaceFixture(t, resolver)
	_, master := fixture.master(t, "Анна")

	response := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/location", "", `{"city":"Тюмень"}`)

	if response.Code != http.StatusOK || masterOf(t, fixture, master.ID).Timezone != "Asia/Yekaterinburg" {
		t.Fatalf("response = %d %s", response.Code, response.Body)
	}
}

func TestOwnerPlaceRefusals(t *testing.T) {
	failing := newPlaceFixture(t, &fakeResolver{err: errors.New("boom")})
	_, master := failing.master(t, "Анна")
	withoutNetwork := newPlaceFixture(t, nil)
	_, other := withoutNetwork.master(t, "Вера")

	cases := []struct {
		name    string
		fixture *accountFixture
		id      string
		body    string
		want    int
	}{
		{"no city", failing, master.ID, `{"city":"  "}`, http.StatusBadRequest},
		{"bad zone", failing, master.ID, `{"city":"Тюмень","timezone":"Mars/Base"}`, http.StatusBadRequest},
		{"bad json", failing, master.ID, `{`, http.StatusBadRequest},
		{"network failed", failing, master.ID, `{"city":"Тюмень"}`, http.StatusUnprocessableEntity},
		{"no network", withoutNetwork, other.ID, `{"city":"Тюмень"}`, http.StatusUnprocessableEntity},
		{"unknown master", failing, "missing", `{"city":"Тюмень","timezone":"Asia/Yekaterinburg"}`, http.StatusNotFound},
	}
	for _, tc := range cases {
		if got := tc.fixture.call(http.MethodPost, "/api/admin/masters/"+tc.id+"/location", "", tc.body).Code; got != tc.want {
			t.Errorf("%s: status = %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestPlanCanCarryThePlaceOfTheMaster(t *testing.T) {
	fixture := newPlaceFixture(t, nil)
	_, master := fixture.master(t, "Анна")
	withPlace := strings.Replace(planJSON, `"note": "План на месяц готов",`, `"note": "План на месяц готов", "location": {"city":"Иркутск","timezone":"Asia/Irkutsk"},`, 1)

	response := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", "", withPlace)

	if response.Code != http.StatusOK {
		t.Fatalf("plan = %d %s", response.Code, response.Body)
	}
	if got := masterOf(t, fixture, master.ID); got.City != "Иркутск" || got.Timezone != "Asia/Irkutsk" {
		t.Errorf("master = %+v", got)
	}
}

func TestPlanWithABrokenPlaceIsRefusedBeforeAnythingIsSaved(t *testing.T) {
	fixture := newPlaceFixture(t, nil)
	_, master := fixture.master(t, "Анна")
	broken := strings.Replace(planJSON, `"note": "План на месяц готов",`, `"note": "План на месяц готов", "location": {"city":"Иркутск","timezone":"Mars/Base"},`, 1)

	response := fixture.call(http.MethodPost, "/api/admin/masters/"+master.ID+"/plan", "", broken)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("plan = %d %s", response.Code, response.Body)
	}
	if _, err := fixture.store.LoadState(context.Background(), master.ID); !errors.Is(err, accounts.ErrNotFound) {
		t.Errorf("the plan was saved although its place is broken: %v", err)
	}
}

func TestThePlaceIsLearnedFromTheSocialPagesOnceTheAuditIsDone(t *testing.T) {
	resolver := &fakeResolver{location: places.Location{City: "Ангарск", Zone: "Asia/Irkutsk"}}
	fixture := newJobsFixture(t)
	fixture.handler = bothHandlers(Options{
		Auditor:        fixture.auditor,
		Accounts:       fixture.store,
		Places:         resolver,
		RetentionDays:  1095,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	code, master := fixture.master(t, "Анна")
	fixture.order(t, code)
	job := fixture.claim(t)
	data := `{"handle":"anna_nails","bio":"Маникюр","location":"Ангарск, 7 микрорайон","geoTags":[{"name":"Ангарск","count":12},{"name":"Иркутск","count":2}],"posts":[]}`

	recorder := fixture.upload(job.ID, agentToken, data, pngFiles(1))

	if recorder.Code != http.StatusOK {
		t.Fatalf("upload = %d %s", recorder.Code, recorder.Body)
	}
	waitUntil(t, "the place from the social pages", func() bool {
		got := masterOf(t, fixture.accountFixture, master.ID)
		return got.City == "Ангарск" && got.Timezone == "Asia/Irkutsk"
	})
	calls := resolver.calls()
	if len(calls) != 1 || !strings.Contains(calls[0].Social, "Ангарск (12)") || !strings.Contains(calls[0].Social, "7 микрорайон") {
		t.Errorf("calls = %+v", calls)
	}
}

func TestTheSocialPagesAreNotUsedWhenThePlaceIsKnown(t *testing.T) {
	resolver := &fakeResolver{location: places.Location{City: "Москва", Zone: "Europe/Moscow"}}
	fixture := newJobsFixture(t)
	fixture.handler = bothHandlers(Options{
		Auditor:        fixture.auditor,
		Accounts:       fixture.store,
		Places:         resolver,
		RetentionDays:  1095,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	code, master := fixture.master(t, "Анна")
	_ = fixture.store.SetLocation(context.Background(), master.ID, "Иркутск", "Asia/Irkutsk")
	fixture.order(t, code)
	job := fixture.claim(t)

	fixture.upload(job.ID, agentToken, `{"handle":"anna_nails","location":"Москва"}`, pngFiles(1))
	time.Sleep(100 * time.Millisecond)

	if calls := resolver.calls(); len(calls) != 0 {
		t.Errorf("calls = %+v", calls)
	}
	if got := masterOf(t, fixture.accountFixture, master.ID); got.City != "Иркутск" {
		t.Errorf("master = %+v", got)
	}
}

func TestCollectedDataDescribesThePlaceHints(t *testing.T) {
	count := 12
	collected := audit.Collected{Handle: "anna_nails", Location: "Ангарск", GeoTags: []audit.GeoTag{{Name: "Ангарск", Count: &count}, {Name: "Иркутск"}}}

	hint := collected.PlaceHint()
	described := audit.DescribeCollected(collected)

	for _, want := range []string{"Ангарск", "Ангарск (12)", "Иркутск"} {
		if !strings.Contains(hint, want) || !strings.Contains(described, want) {
			t.Errorf("%q is missing, hint = %q", want, hint)
		}
	}
	if (audit.Collected{Handle: "x"}).PlaceHint() != "" {
		t.Error("nothing is known: the hint must be empty")
	}
	var parsed audit.Collected
	if err := json.Unmarshal([]byte(`{"geoTags":[{"name":"Тюмень","count":3}]}`), &parsed); err != nil || len(parsed.GeoTags) != 1 {
		t.Errorf("parsed = %+v, %v", parsed, err)
	}
}
