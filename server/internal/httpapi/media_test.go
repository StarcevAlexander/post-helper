package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strconv"
	"strings"
	"testing"
	"time"

	"post-helper/server/internal/media"
	"post-helper/server/internal/push"
)

var (
	jpegBytes   = []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0}
	mp4Bytes    = []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'm', 'p', '4', '1', 'i', 's', 'o', 'm', 1, 2, 3, 4, 5, 6, 7, 8}
	movBytes    = []byte("fake-quicktime-original-0123456789")
	textBytes   = []byte("this is only text, not a picture")
	uploadMeta  = `{"key":"w1-mon","unit":"w1-mon:frame:0","format":"reels","pillar":"Процесс","idea":"Снятие гель-лака","overlay":"До и после","note":"  Снимаю гель-лак. Записывайтесь в директ  "}`
	planRequest = `{"width":1920,"height":1080,"durationMs":14800,"segments":[{"start":0,"end":2.4,"text":" привет "},{"start":2.4,"end":3,"text":"  "}]}`
)

type fakeMediaPlanner struct {
	plan    media.Plan
	err     error
	request media.Request
	calls   int
}

func (f *fakeMediaPlanner) Plan(_ context.Context, request media.Request) (media.Plan, error) {
	f.calls++
	f.request = request
	return f.plan, f.err
}

type mediaFixture struct {
	*accountFixture
	planner *fakeMediaPlanner
	files   *media.MemoryFiles
	store   *media.Memory
	pusher  *fakePusher
}

func newMediaFixture(t *testing.T, withPlanner bool) *mediaFixture {
	t.Helper()
	base := newAccountFixture(t, 50)
	fixture := &mediaFixture{
		accountFixture: base,
		planner: &fakeMediaPlanner{plan: media.Plan{
			Preset: media.PresetWarm, Focus: media.FocusTop, Title: "До и после",
			Subtitles: []media.Segment{{Start: 0, End: 2.4, Text: "Привет!"}},
			Note:      "Подровнял под 9:16, добавил тепла", Caption: "Гель-лак без сколов\nПишите в директ", Source: media.PlanSourceClaude,
		}},
		files:  media.NewMemoryFiles(),
		store:  media.NewMemory(),
		pusher: newFakePusher(1),
	}
	options := Options{
		Accounts:       base.store,
		Media:          fixture.store,
		MediaFiles:     fixture.files,
		Pusher:         fixture.pusher,
		RetentionDays:  1095,
		AllowedOrigins: []string{testOrigin},
		Logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if withPlanner {
		options.MediaPlanner = fixture.planner
	}
	base.handler = bothHandlers(options)
	return fixture
}

type filePart struct {
	field       string
	name        string
	contentType string
	data        []byte
}

func multipartBody(fields map[string]string, parts ...filePart) (*bytes.Buffer, string) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for name, value := range fields {
		_ = writer.WriteField(name, value)
	}
	for _, part := range parts {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", `form-data; name="`+part.field+`"; filename="`+part.name+`"`)
		if part.contentType != "" {
			header.Set("Content-Type", part.contentType)
		}
		out, _ := writer.CreatePart(header)
		_, _ = out.Write(part.data)
	}
	_ = writer.Close()
	return body, writer.FormDataContentType()
}

func (f *mediaFixture) send(method, path, token string, body io.Reader, contentType string, headers ...string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, body)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		request.Header.Set("Authorization", BearerPrefix+token)
	}
	for index := 0; index+1 < len(headers); index += 2 {
		request.Header.Set(headers[index], headers[index+1])
	}
	recorder := httptest.NewRecorder()
	f.handler.ServeHTTP(recorder, request)
	return recorder
}

func (f *mediaFixture) upload(token, meta string, part filePart) *httptest.ResponseRecorder {
	body, contentType := multipartBody(map[string]string{FieldData: meta}, part)
	return f.send(http.MethodPost, "/api/media/upload", token, body, contentType)
}

func (f *mediaFixture) uploadMov(t *testing.T, token string) MediaStatus {
	t.Helper()
	recorder := f.upload(token, uploadMeta, filePart{FieldFile, "IMG_0001.MOV", "video/quicktime", movBytes})
	var status MediaStatus
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &status) != nil {
		t.Fatalf("upload = %d %s", recorder.Code, recorder.Body)
	}
	return status
}

func (f *mediaFixture) statuses(t *testing.T, token string) []MediaStatus {
	t.Helper()
	recorder := f.call(http.MethodGet, "/api/media/status", token, "")
	var statuses []MediaStatus
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &statuses) != nil {
		t.Fatalf("status = %d %s", recorder.Code, recorder.Body)
	}
	return statuses
}

func (f *mediaFixture) claim(t *testing.T) AgentMediaItem {
	t.Helper()
	recorder := f.call(http.MethodGet, "/api/agent/media/next", "", "")
	var item AgentMediaItem
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &item) != nil {
		t.Fatalf("claim = %d %s", recorder.Code, recorder.Body)
	}
	return item
}

func (f *mediaFixture) result(id string, data string, parts ...filePart) *httptest.ResponseRecorder {
	body, contentType := multipartBody(map[string]string{FieldData: data}, parts...)
	return f.send(http.MethodPost, "/api/agent/media/"+id+"/result", "", body, contentType)
}

const resultData = `{"width":1080,"height":1920,"durationMs":14800,"subtitled":true,"note":"Подровнял под 9:16, добавил тепла, наложил субтитры"}`

func waitPush(t *testing.T, pusher *fakePusher) {
	t.Helper()
	select {
	case <-pusher.sent:
	case <-time.After(2 * time.Second):
		t.Fatal("no push was sent")
	}
}

func TestMediaFlowFromUploadToTheReadyFile(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, master := fixture.master(t, "Анна")

	uploaded := fixture.uploadMov(t, code)
	if uploaded.Status != media.StatusQueued || uploaded.Kind != media.KindVideo || uploaded.Key != "w1-mon" || uploaded.Unit != "w1-mon:frame:0" ||
		uploaded.Format != media.FormatReels || uploaded.Source.Name != "IMG_0001.MOV" || uploaded.Source.Type != "video/quicktime" ||
		uploaded.Source.Size != int64(len(movBytes)) || uploaded.Result != nil || uploaded.FinishedAt != nil || uploaded.ID == "" {
		t.Fatalf("uploaded = %+v", uploaded)
	}
	if listed := fixture.statuses(t, code); len(listed) != 1 || listed[0].ID != uploaded.ID {
		t.Fatalf("statuses = %+v", listed)
	}

	item := fixture.claim(t)
	if item.ID != uploaded.ID || item.Kind != media.KindVideo || item.SourceType != "video/quicktime" || item.SourceName != "IMG_0001.MOV" ||
		item.SourceSize != int64(len(movBytes)) || item.Idea != "Снятие гель-лака" || item.Pillar != "Процесс" ||
		item.Overlay != "До и после" || item.Note != "Снимаю гель-лак. Записывайтесь в директ" || item.Attempts != 1 || item.Unit != "w1-mon:frame:0" {
		t.Fatalf("claimed = %+v", item)
	}
	if got := fixture.call(http.MethodGet, "/api/agent/media/next", "", "").Code; got != http.StatusNoContent {
		t.Errorf("queue after the claim: status = %d", got)
	}

	source := fixture.call(http.MethodGet, "/api/agent/media/"+item.ID+"/source", "", "")
	if source.Code != http.StatusOK || !bytes.Equal(source.Body.Bytes(), movBytes) || source.Header().Get("Content-Type") != "video/quicktime" ||
		source.Header().Get("Content-Length") != strconv.Itoa(len(movBytes)) {
		t.Errorf("source = %d %q %q", source.Code, source.Header().Get("Content-Type"), source.Header().Get("Content-Length"))
	}

	planBody, planType := multipartBody(map[string]string{FieldData: planRequest}, filePart{FieldPreview, "preview.jpg", "image/jpeg", jpegBytes})
	plan := fixture.send(http.MethodPost, "/api/agent/media/"+item.ID+"/plan", "", planBody, planType)
	var made media.Plan
	if plan.Code != http.StatusOK || json.Unmarshal(plan.Body.Bytes(), &made) != nil {
		t.Fatalf("plan = %d %s", plan.Code, plan.Body)
	}
	if made.Preset != media.PresetWarm || made.Focus != media.FocusTop || made.Title != "До и после" || made.Source != media.PlanSourceClaude ||
		len(made.Subtitles) != 1 || made.Subtitles[0].Text != "Привет!" {
		t.Errorf("plan = %+v", made)
	}
	request := fixture.planner.request
	if !strings.Contains(request.About, "Анна") || request.Item.Overlay != "До и после" || request.Item.Format != media.FormatReels ||
		request.Width != 1920 || request.Height != 1080 || request.DurationMs != 14800 || !bytes.Equal(request.Preview, jpegBytes) ||
		len(request.Segments) != 1 || request.Segments[0].Text != "привет" || request.Item.Note != "Снимаю гель-лак. Записывайтесь в директ" {
		t.Errorf("planner got %+v", request)
	}
	if stored, _ := fixture.store.Find(context.Background(), item.ID); stored.Status != media.StatusRunning {
		t.Errorf("the plan must not change the state, got %q", stored.Status)
	}

	done := fixture.result(item.ID, resultData,
		filePart{FieldFile, "result.mp4", "video/mp4", mp4Bytes},
		filePart{FieldThumb, "thumb.jpg", "image/jpeg", jpegBytes})
	if done.Code != http.StatusOK || !strings.Contains(done.Body.String(), `"ok":true`) {
		t.Fatalf("result = %d %s", done.Code, done.Body)
	}
	waitPush(t, fixture.pusher)
	fixture.pusher.mu.Lock()
	pushed, pushedTo := fixture.pusher.messages, fixture.pusher.masters
	fixture.pusher.mu.Unlock()
	if len(pushed) != 1 || pushed[0].Title != PushMediaTitle || pushed[0].Body != PushMediaBody || pushed[0].URL != PushMediaURL || pushedTo[0] != master.ID ||
		pushed[0].Topic.Kind != push.KindMedia || len(pushed[0].Topic.ItemIDs) != 1 || pushed[0].Topic.ItemIDs[0] != item.Key {
		t.Errorf("pushes = %+v to %v", pushed, pushedTo)
	}
	if !fixture.files.Has(media.RefOf(master.ID, item.ID, "source", "video/quicktime")) {
		t.Error("the source must be kept after the result for a redo")
	}

	ready := fixture.statuses(t, code)[0]
	if ready.Status != media.StatusDone || ready.FinishedAt == nil || ready.Result == nil || ready.Source.Name != "IMG_0001.MOV" {
		t.Fatalf("ready = %+v", ready)
	}
	if got := *ready.Result; got.Type != "video/mp4" || got.Size != int64(len(mp4Bytes)) || got.Width != 1080 || got.Height != 1920 ||
		got.DurationMs != 14800 || !got.Subtitled || !got.Thumb || !strings.Contains(got.Note, "субтитры") || got.Caption != "Гель-лак без сколов\nПишите в директ" || ready.Note != "Снимаю гель-лак. Записывайтесь в директ" {
		t.Errorf("result = %+v", got)
	}

	file := fixture.call(http.MethodGet, "/api/media/files/"+item.ID, code, "")
	if file.Code != http.StatusOK || !bytes.Equal(file.Body.Bytes(), mp4Bytes) || file.Header().Get("Content-Type") != "video/mp4" ||
		file.Header().Get("Cache-Control") != "private, max-age=86400" || file.Header().Get("X-Content-Type-Options") != "nosniff" ||
		file.Header().Get("Content-Disposition") != `inline; filename="w1-mon-1.mp4"` {
		t.Errorf("file = %d %v", file.Code, file.Header())
	}
	ranged := fixture.send(http.MethodGet, "/api/media/files/"+item.ID, code, nil, "", "Range", "bytes=2-5")
	if ranged.Code != http.StatusPartialContent || !bytes.Equal(ranged.Body.Bytes(), mp4Bytes[2:6]) ||
		ranged.Header().Get("Content-Range") != "bytes 2-5/"+strconv.Itoa(len(mp4Bytes)) || ranged.Header().Get("Content-Type") != "video/mp4" {
		t.Errorf("ranged = %d %q %v", ranged.Code, ranged.Body.Bytes(), ranged.Header())
	}
	thumb := fixture.call(http.MethodGet, "/api/media/files/"+item.ID+"/thumb", code, "")
	if thumb.Code != http.StatusOK || !bytes.Equal(thumb.Body.Bytes(), jpegBytes) || thumb.Header().Get("Content-Type") != "image/jpeg" ||
		thumb.Header().Get("Cache-Control") != "private, max-age=86400" {
		t.Errorf("thumb = %d %v", thumb.Code, thumb.Header())
	}

	removed := fixture.call(http.MethodDelete, "/api/media/"+item.ID, code, "")
	if removed.Code != http.StatusOK || !strings.Contains(removed.Body.String(), `"ok":true`) {
		t.Fatalf("delete = %d %s", removed.Code, removed.Body)
	}
	if got := fixture.call(http.MethodGet, "/api/media/files/"+item.ID, code, "").Code; got != http.StatusNotFound {
		t.Errorf("file after delete: status = %d", got)
	}
	if len(fixture.statuses(t, code)) != 0 || fixture.files.Count() != 0 {
		t.Errorf("records or files are left: %d files", fixture.files.Count())
	}
}

func TestWithoutAPlannerTheDefaultPlanKeepsTheSpeech(t *testing.T) {
	fixture := newMediaFixture(t, false)
	code, _ := fixture.master(t, "Анна")
	fixture.uploadMov(t, code)
	item := fixture.claim(t)

	body, contentType := multipartBody(map[string]string{FieldData: planRequest})
	plan := fixture.send(http.MethodPost, "/api/agent/media/"+item.ID+"/plan", "", body, contentType)

	var made media.Plan
	if plan.Code != http.StatusOK || json.Unmarshal(plan.Body.Bytes(), &made) != nil {
		t.Fatalf("plan = %d %s", plan.Code, plan.Body)
	}
	if made.Preset != media.PresetClean || made.Focus != media.FocusCenter || made.Title != "" || made.Source != media.PlanSourceDefault ||
		made.Note != media.DefaultNote || len(made.Subtitles) != 1 || made.Subtitles[0].Text != "привет" {
		t.Errorf("plan = %+v", made)
	}
}

func TestWhenClaudeFailsTheDefaultPlanIsReturned(t *testing.T) {
	fixture := newMediaFixture(t, true)
	fixture.planner.err = errors.New("claude is down")
	code, _ := fixture.master(t, "Анна")
	fixture.uploadMov(t, code)
	item := fixture.claim(t)

	body, contentType := multipartBody(map[string]string{FieldData: planRequest})
	plan := fixture.send(http.MethodPost, "/api/agent/media/"+item.ID+"/plan", "", body, contentType)

	var made media.Plan
	if plan.Code != http.StatusOK || json.Unmarshal(plan.Body.Bytes(), &made) != nil || made.Source != media.PlanSourceDefault || made.Preset != media.PresetClean {
		t.Errorf("plan = %d %s", plan.Code, plan.Body)
	}
	if fixture.planner.calls != 1 {
		t.Errorf("planner calls = %d", fixture.planner.calls)
	}
}

func TestPlanIsOnlyForARunningItem(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	queued := fixture.uploadMov(t, code)
	body := func() (*bytes.Buffer, string) { return multipartBody(map[string]string{FieldData: planRequest}) }

	buffer, contentType := body()
	if got := fixture.send(http.MethodPost, "/api/agent/media/"+queued.ID+"/plan", "", buffer, contentType).Code; got != http.StatusNotFound {
		t.Errorf("queued item: status = %d", got)
	}
	buffer, contentType = body()
	if got := fixture.send(http.MethodPost, "/api/agent/media/missing/plan", "", buffer, contentType).Code; got != http.StatusNotFound {
		t.Errorf("missing item: status = %d", got)
	}
	if got := fixture.call(http.MethodGet, "/api/agent/media/"+queued.ID+"/source", "", "").Code; got != http.StatusNotFound {
		t.Errorf("source of a queued item: status = %d", got)
	}
}

func TestMediaUploadRejections(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	tests := []struct {
		name  string
		token string
		meta  string
		part  filePart
		want  int
	}{
		{"unknown type", code, uploadMeta, filePart{FieldFile, "notes.txt", "text/plain", textBytes}, http.StatusUnsupportedMediaType},
		{"no type and unknown extension", code, uploadMeta, filePart{FieldFile, "clip.xyz", "application/octet-stream", movBytes}, http.StatusUnsupportedMediaType},
		{"bad format", code, `{"key":"a","format":"podcast"}`, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes}, http.StatusBadRequest},
		{"empty key", code, `{"key":" ","format":"post"}`, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes}, http.StatusBadRequest},
		{"key too long", code, `{"key":"` + strings.Repeat("я", 81) + `","format":"post"}`, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes}, http.StatusBadRequest},
		{"bad json", code, `nope`, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes}, http.StatusBadRequest},
		{"wrong field", code, uploadMeta, filePart{"photo", "a.jpg", "image/jpeg", jpegBytes}, http.StatusBadRequest},
		{"empty file", code, uploadMeta, filePart{FieldFile, "a.jpg", "image/jpeg", nil}, http.StatusBadRequest},
		{"no login", "", uploadMeta, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes}, http.StatusUnauthorized},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := fixture.upload(test.token, test.meta, test.part).Code; got != test.want {
				t.Errorf("status = %d, want %d", got, test.want)
			}
		})
	}
	if len(fixture.statuses(t, code)) != 0 || fixture.files.Count() != 0 {
		t.Error("a rejected upload must leave nothing behind")
	}
}

func TestUploadTakesTheTypeFromTheExtensionAndCutsLongFields(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	meta := `{"key":"a","unit":"` + strings.Repeat("u", 200) + `","format":"post","pillar":"` + strings.Repeat("р", 700) + `","idea":"` + strings.Repeat("и", 700) + `","overlay":"` + strings.Repeat("о", 400) + `"}`

	recorder := fixture.upload(code, meta, filePart{FieldFile, "photo.HEIC", "application/octet-stream", jpegBytes})

	var status MediaStatus
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &status) != nil {
		t.Fatalf("upload = %d %s", recorder.Code, recorder.Body)
	}
	if status.Kind != media.KindPhoto || status.Source.Type != "image/heic" || len([]rune(status.Unit)) != media.MaxUnitRunes {
		t.Errorf("status = %+v", status)
	}
	stored, _ := fixture.store.Find(context.Background(), status.ID)
	if len([]rune(stored.Pillar)) != media.MaxFieldRunes || len([]rune(stored.Idea)) != media.MaxFieldRunes || len([]rune(stored.Overlay)) != media.MaxOverlayRunes {
		t.Errorf("stored = %+v", stored)
	}
}

func TestAMasterCannotHaveMoreThanSixtyRecords(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	other, _ := fixture.master(t, "Вера")
	for index := range media.MaxPerMaster {
		if recorder := fixture.upload(code, uploadMeta, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes}); recorder.Code != http.StatusOK {
			t.Fatalf("upload %d = %d %s", index, recorder.Code, recorder.Body)
		}
	}

	over := fixture.upload(code, uploadMeta, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes})
	another := fixture.upload(other, uploadMeta, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes})

	if over.Code != http.StatusConflict || !strings.Contains(over.Body.String(), MsgMediaTooMany) {
		t.Errorf("sixty-first = %d %s", over.Code, over.Body)
	}
	if another.Code != http.StatusOK {
		t.Errorf("another master = %d", another.Code)
	}
	if len(fixture.statuses(t, code)) != media.MaxPerMaster || fixture.files.Count() != media.MaxPerMaster+1 {
		t.Errorf("records %d, files %d", len(fixture.statuses(t, code)), fixture.files.Count())
	}
}

func TestAnotherMasterSeesAndTouchesNothing(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	other, _ := fixture.master(t, "Вера")
	uploaded := fixture.uploadMov(t, code)
	item := fixture.claim(t)
	fixture.result(item.ID, resultData, filePart{FieldFile, "result.mp4", "video/mp4", mp4Bytes})

	for _, path := range []string{"/api/media/files/" + uploaded.ID, "/api/media/files/" + uploaded.ID + "/thumb"} {
		if got := fixture.call(http.MethodGet, path, other, "").Code; got != http.StatusNotFound {
			t.Errorf("GET %s: status = %d", path, got)
		}
	}
	if got := fixture.call(http.MethodDelete, "/api/media/"+uploaded.ID, other, "").Code; got != http.StatusNotFound {
		t.Errorf("delete: status = %d", got)
	}
	if len(fixture.statuses(t, other)) != 0 {
		t.Error("another master must not see the records")
	}
	if got := fixture.call(http.MethodGet, "/api/media/files/"+uploaded.ID, code, "").Code; got != http.StatusOK {
		t.Errorf("the owner lost the file: status = %d", got)
	}
}

func TestFilesAreNotServedBeforeTheyAreDone(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	uploaded := fixture.uploadMov(t, code)

	for _, path := range []string{"/api/media/files/" + uploaded.ID, "/api/media/files/" + uploaded.ID + "/thumb", "/api/media/files/missing"} {
		if got := fixture.call(http.MethodGet, path, code, "").Code; got != http.StatusNotFound {
			t.Errorf("GET %s: status = %d", path, got)
		}
	}
	if got := fixture.call(http.MethodGet, "/api/media/files/"+uploaded.ID, "", "").Code; got != http.StatusUnauthorized {
		t.Errorf("no login: status = %d", got)
	}
}

func TestAPhotoResultIsItsOwnPosterWhenNoThumbIsSent(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	uploaded := fixture.upload(code, uploadMeta, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes})
	var status MediaStatus
	_ = json.Unmarshal(uploaded.Body.Bytes(), &status)
	item := fixture.claim(t)

	done := fixture.result(item.ID, `{"width":1080,"height":1920,"durationMs":0,"subtitled":true}`, filePart{FieldFile, "result.jpg", "image/jpeg", jpegBytes})

	if done.Code != http.StatusOK {
		t.Fatalf("result = %d %s", done.Code, done.Body)
	}
	ready := fixture.statuses(t, code)[0]
	if ready.Result == nil || !ready.Result.Thumb || ready.Result.Subtitled || ready.Result.DurationMs != 0 || ready.Result.Note != media.DefaultNote {
		t.Errorf("ready = %+v", ready.Result)
	}
	thumb := fixture.call(http.MethodGet, "/api/media/files/"+status.ID+"/thumb", code, "")
	if thumb.Code != http.StatusOK || !bytes.Equal(thumb.Body.Bytes(), jpegBytes) {
		t.Errorf("thumb = %d", thumb.Code)
	}
	file := fixture.call(http.MethodGet, "/api/media/files/"+status.ID, code, "")
	if file.Header().Get("Content-Disposition") != `inline; filename="w1-mon-1.jpg"` {
		t.Errorf("disposition = %q", file.Header().Get("Content-Disposition"))
	}
}

func TestVideoWithoutAThumbHasNoPoster(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	uploaded := fixture.uploadMov(t, code)
	item := fixture.claim(t)
	fixture.result(item.ID, resultData, filePart{FieldFile, "result.mp4", "video/mp4", mp4Bytes})

	if got := fixture.call(http.MethodGet, "/api/media/files/"+uploaded.ID+"/thumb", code, "").Code; got != http.StatusNotFound {
		t.Errorf("thumb: status = %d", got)
	}
	if ready := fixture.statuses(t, code)[0]; ready.Result == nil || ready.Result.Thumb {
		t.Errorf("ready = %+v", ready.Result)
	}
}

func TestMediaResultRejections(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	queued := fixture.uploadMov(t, code)

	if got := fixture.result(queued.ID, resultData, filePart{FieldFile, "r.mp4", "video/mp4", mp4Bytes}).Code; got != http.StatusConflict {
		t.Errorf("result for a queued item: status = %d", got)
	}
	if got := fixture.result("missing", resultData, filePart{FieldFile, "r.mp4", "video/mp4", mp4Bytes}).Code; got != http.StatusNotFound {
		t.Errorf("result for a missing item: status = %d", got)
	}
	item := fixture.claim(t)
	tests := []struct {
		name string
		data string
		part []filePart
		want int
	}{
		{"no file", resultData, nil, http.StatusBadRequest},
		{"a picture for a video", resultData, []filePart{{FieldFile, "r.jpg", "image/jpeg", jpegBytes}}, http.StatusUnsupportedMediaType},
		{"text", resultData, []filePart{{FieldFile, "r.mp4", "video/mp4", textBytes}}, http.StatusUnsupportedMediaType},
		{"a bad thumb", resultData, []filePart{{FieldFile, "r.mp4", "video/mp4", mp4Bytes}, {FieldThumb, "t.jpg", "image/jpeg", textBytes}}, http.StatusUnsupportedMediaType},
		{"bad json", `nope`, []filePart{{FieldFile, "r.mp4", "video/mp4", mp4Bytes}}, http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := fixture.result(item.ID, test.data, test.part...).Code; got != test.want {
				t.Errorf("status = %d, want %d", got, test.want)
			}
		})
	}
	if fixture.files.Count() != 1 {
		t.Errorf("only the source must stay on disk, files = %d", fixture.files.Count())
	}
	if again := fixture.result(item.ID, resultData, filePart{FieldFile, "r.mp4", "video/mp4", mp4Bytes}); again.Code != http.StatusOK {
		t.Fatalf("result = %d %s", again.Code, again.Body)
	}
	if got := fixture.result(item.ID, resultData, filePart{FieldFile, "r.mp4", "video/mp4", mp4Bytes}).Code; got != http.StatusConflict {
		t.Errorf("second result: status = %d", got)
	}
}

func TestAFailedItemGoesBackToTheQueueUntilTheLimitOrAFinalFailure(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, master := fixture.master(t, "Анна")
	uploaded := fixture.uploadMov(t, code)

	first := fixture.claim(t)
	soft := fixture.call(http.MethodPost, "/api/agent/media/"+first.ID+"/fail", "", `{"reason":"нет видеокарты","final":false}`)
	again := fixture.claim(t)
	hard := fixture.call(http.MethodPost, "/api/agent/media/"+again.ID+"/fail", "", `{"reason":"файл не читается","final":true}`)
	failed := fixture.statuses(t, code)[0]

	if soft.Code != http.StatusOK || again.ID != first.ID || again.Attempts != 2 {
		t.Errorf("soft = %d, again = %+v", soft.Code, again)
	}
	if hard.Code != http.StatusOK || failed.Status != media.StatusFailed || failed.Error != "файл не читается" || failed.Result != nil {
		t.Errorf("hard = %d, failed = %+v", hard.Code, failed)
	}
	if fixture.files.Has(media.RefOf(master.ID, uploaded.ID, "source", "video/quicktime")) {
		t.Error("the source of a failed item must be deleted")
	}
	if got := fixture.call(http.MethodGet, "/api/agent/media/next", "", "").Code; got != http.StatusNoContent {
		t.Errorf("a failed item must not come back, status = %d", got)
	}
	if got := fixture.call(http.MethodPost, "/api/agent/media/"+again.ID+"/fail", "", `{"reason":"ещё"}`).Code; got != http.StatusConflict {
		t.Errorf("fail of a failed item: status = %d", got)
	}
	if got := fixture.call(http.MethodPost, "/api/agent/media/missing/fail", "", `{"reason":"x"}`).Code; got != http.StatusNotFound {
		t.Errorf("fail of a missing item: status = %d", got)
	}
}

func TestThirdSoftFailureIsFinalAndTheReasonIsClipped(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	fixture.uploadMov(t, code)
	var last AgentMediaItem
	for range media.MaxAttempts {
		last = fixture.claim(t)
		reason := `{"reason":"` + strings.Repeat("я", 500) + `"}`
		if got := fixture.call(http.MethodPost, "/api/agent/media/"+last.ID+"/fail", "", reason).Code; got != http.StatusOK {
			t.Fatalf("fail = %d", got)
		}
	}

	failed := fixture.statuses(t, code)[0]

	if failed.Status != media.StatusFailed || len([]rune(failed.Error)) != media.MaxErrorRunes {
		t.Errorf("failed = %+v", failed)
	}
	empty := newMediaFixture(t, true)
	other, _ := empty.master(t, "Вера")
	empty.uploadMov(t, other)
	item := empty.claim(t)
	empty.call(http.MethodPost, "/api/agent/media/"+item.ID+"/fail", "", `{"reason":"  ","final":true}`)
	if got := empty.statuses(t, other)[0].Error; got != media.DefaultFailReason {
		t.Errorf("default reason = %q", got)
	}
}

func TestOnePushWhenNothingIsLeftToProcess(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	fixture.uploadMov(t, code)
	fixture.uploadMov(t, code)
	first, second := fixture.claim(t), fixture.claim(t)

	fixture.result(first.ID, resultData, filePart{FieldFile, "r.mp4", "video/mp4", mp4Bytes})
	select {
	case <-fixture.pusher.sent:
		t.Fatal("a push was sent while a file is still waiting")
	case <-time.After(200 * time.Millisecond):
	}
	fixture.result(second.ID, resultData, filePart{FieldFile, "r.mp4", "video/mp4", mp4Bytes})

	waitPush(t, fixture.pusher)
}

func TestDeletingAnItemInProgressMakesTheWorkerGetNotFound(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	uploaded := fixture.uploadMov(t, code)
	item := fixture.claim(t)

	removed := fixture.call(http.MethodDelete, "/api/media/"+uploaded.ID, code, "")
	done := fixture.result(item.ID, resultData, filePart{FieldFile, "r.mp4", "video/mp4", mp4Bytes})
	failed := fixture.call(http.MethodPost, "/api/agent/media/"+item.ID+"/fail", "", `{"reason":"x"}`)
	source := fixture.call(http.MethodGet, "/api/agent/media/"+item.ID+"/source", "", "")

	if removed.Code != http.StatusOK || fixture.files.Count() != 0 {
		t.Errorf("delete = %d, files = %d", removed.Code, fixture.files.Count())
	}
	if done.Code != http.StatusNotFound || failed.Code != http.StatusNotFound || source.Code != http.StatusNotFound {
		t.Errorf("result %d, fail %d, source %d", done.Code, failed.Code, source.Code)
	}
}

func TestAdminListsTheLatestRecordsOfAllMasters(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, master := fixture.master(t, "Анна")
	other, second := fixture.master(t, "Вера")
	fixture.uploadMov(t, code)
	fixture.uploadMov(t, other)

	recorder := fixture.call(http.MethodGet, "/api/admin/media", "", "")

	var listed []MediaAdminStatus
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &listed) != nil || len(listed) != 2 {
		t.Fatalf("list = %d %s", recorder.Code, recorder.Body)
	}
	owners := map[string]bool{listed[0].MasterID: true, listed[1].MasterID: true}
	if !owners[master.ID] || !owners[second.ID] || listed[0].Key != "w1-mon" {
		t.Errorf("list = %+v", listed)
	}
	if !strings.Contains(recorder.Body.String(), `"masterId"`) || strings.Contains(recorder.Body.String(), `"result"`) {
		t.Errorf("body = %s", recorder.Body)
	}
}

func TestAgentRoutesAreNotOnThePublicPort(t *testing.T) {
	fixture := newMediaFixture(t, true)
	public := NewHandler(Options{Accounts: fixture.accountFixture.store, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})

	for _, path := range []string{"/api/agent/media/next", "/api/admin/media"} {
		recorder := httptest.NewRecorder()
		public.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code == http.StatusOK || recorder.Code == http.StatusNoContent {
			t.Errorf("%s answered %d on the public port", path, recorder.Code)
		}
	}
}

func TestMediaMessagesAreInRussian(t *testing.T) {
	for _, message := range []string{MsgMediaNotFound, MsgMediaTooMany, MsgMediaState, PushMediaTitle, PushMediaBody} {
		if !strings.ContainsAny(message, "абвгдеёжзийклмнопрстуфхцчшщъыьэюя") {
			t.Errorf("not Russian: %q", message)
		}
	}
	if MsgMediaTooMany != "Слишком много загрузок: удалите ненужное в готовом контенте" || PushMediaTitle != "Контент готов" {
		t.Error("texts differ from the contract")
	}
}

func TestThePlanCaptionIsStoredAndKeptWithinTheLimit(t *testing.T) {
	fixture := newMediaFixture(t, true)
	fixture.planner.plan.Caption = "  " + strings.Repeat("я", media.MaxCaptionRunes+100) + "  "
	code, _ := fixture.master(t, "Анна")
	uploaded := fixture.uploadMov(t, code)
	item := fixture.claim(t)

	body, contentType := multipartBody(map[string]string{FieldData: planRequest})
	plan := fixture.send(http.MethodPost, "/api/agent/media/"+item.ID+"/plan", "", body, contentType)

	var made media.Plan
	_ = json.Unmarshal(plan.Body.Bytes(), &made)
	stored, _ := fixture.store.Find(context.Background(), uploaded.ID)
	if len([]rune(made.Caption)) != media.MaxCaptionRunes || stored.Caption != made.Caption || stored.Status != media.StatusRunning {
		t.Errorf("caption %d runes, stored %d, status %q", len([]rune(made.Caption)), len([]rune(stored.Caption)), stored.Status)
	}
}

func TestDefaultPlanUsesTheMasterNoteAsTheCaption(t *testing.T) {
	fixture := newMediaFixture(t, false)
	code, _ := fixture.master(t, "Анна")
	fixture.uploadMov(t, code)
	item := fixture.claim(t)

	body, contentType := multipartBody(map[string]string{FieldData: planRequest})
	plan := fixture.send(http.MethodPost, "/api/agent/media/"+item.ID+"/plan", "", body, contentType)

	var made media.Plan
	_ = json.Unmarshal(plan.Body.Bytes(), &made)
	if made.Source != media.PlanSourceDefault || made.Caption != "Снимаю гель-лак. Записывайтесь в директ" {
		t.Errorf("plan = %+v", made)
	}
}

func TestWithoutAMasterNoteThereIsNoCaption(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	body, contentType := multipartBody(map[string]string{FieldData: `{"key":"a","format":"post"}`}, filePart{FieldFile, "a.mov", "video/quicktime", movBytes})
	if up := fixture.send(http.MethodPost, "/api/media/upload", code, body, contentType); up.Code != http.StatusOK {
		t.Fatalf("upload = %d %s", up.Code, up.Body)
	}
	item := fixture.claim(t)

	planBody, planType := multipartBody(map[string]string{FieldData: planRequest})
	plan := fixture.send(http.MethodPost, "/api/agent/media/"+item.ID+"/plan", "", planBody, planType)

	var made media.Plan
	_ = json.Unmarshal(plan.Body.Bytes(), &made)
	if item.Note != "" || made.Caption != "" {
		t.Errorf("note %q, caption %q", item.Note, made.Caption)
	}
}

func TestTheMasterNoteIsCut(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	meta := `{"key":"a","format":"post","note":"` + strings.Repeat("т", media.MaxMasterNote+50) + `"}`

	recorder := fixture.upload(code, meta, filePart{FieldFile, "a.jpg", "image/jpeg", jpegBytes})

	var status MediaStatus
	_ = json.Unmarshal(recorder.Body.Bytes(), &status)
	if recorder.Code != http.StatusOK || len([]rune(status.Note)) != media.MaxMasterNote {
		t.Errorf("status %d, note %d runes", recorder.Code, len([]rune(status.Note)))
	}
}

func (f *mediaFixture) finishClaimed(t *testing.T, id string, thumb bool) {
	t.Helper()
	parts := []filePart{{FieldFile, "result.mp4", "video/mp4", mp4Bytes}}
	if thumb {
		parts = append(parts, filePart{FieldThumb, "thumb.jpg", "image/jpeg", jpegBytes})
	}
	if done := f.result(id, resultData, parts...); done.Code != http.StatusOK {
		t.Fatalf("result = %d %s", done.Code, done.Body)
	}
}

func TestRedoProcessesTheSameSourceAgainWithTheWish(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, master := fixture.master(t, "Анна")
	uploaded := fixture.uploadMov(t, code)
	fixture.claim(t)
	fixture.finishClaimed(t, uploaded.ID, true)
	waitPush(t, fixture.pusher)
	if ready := fixture.statuses(t, code)[0]; !ready.CanRedo || ready.Redos != 0 {
		t.Fatalf("ready = %+v", ready)
	}

	redo := fixture.call(http.MethodPost, "/api/media/"+uploaded.ID+"/redo", code, `{"wish":"  Сделай ярче и без субтитров  "}`)
	var queued MediaStatus
	if redo.Code != http.StatusOK || json.Unmarshal(redo.Body.Bytes(), &queued) != nil {
		t.Fatalf("redo = %d %s", redo.Code, redo.Body)
	}
	if queued.Status != media.StatusQueued || queued.Wish != "Сделай ярче и без субтитров" || queued.Redos != 1 || queued.CanRedo || queued.Result != nil {
		t.Fatalf("queued = %+v", queued)
	}
	if again := fixture.call(http.MethodPost, "/api/media/"+uploaded.ID+"/redo", code, `{}`); again.Code != http.StatusConflict {
		t.Errorf("redo while queued = %d", again.Code)
	}

	item := fixture.claim(t)
	planBody, planType := multipartBody(map[string]string{FieldData: planRequest})
	if plan := fixture.send(http.MethodPost, "/api/agent/media/"+item.ID+"/plan", "", planBody, planType); plan.Code != http.StatusOK {
		t.Fatalf("plan = %d %s", plan.Code, plan.Body)
	}
	if fixture.planner.request.Item.Wish != "Сделай ярче и без субтитров" {
		t.Errorf("planner got wish %q", fixture.planner.request.Item.Wish)
	}
	fixture.finishClaimed(t, item.ID, false)
	waitPush(t, fixture.pusher)

	ready := fixture.statuses(t, code)[0]
	if ready.Status != media.StatusDone || ready.Redos != 1 || !ready.CanRedo || ready.Error != "" || ready.Result == nil {
		t.Fatalf("redone = %+v", ready)
	}
	if fixture.files.Has(media.RefOf(master.ID, item.ID, "thumb", media.PreviewMediaType)) {
		t.Error("the old poster must be dropped when the redo has none")
	}
	if !fixture.files.Has(media.RefOf(master.ID, item.ID, "result", "video/mp4")) {
		t.Error("the new result must be on disk")
	}
}

func TestRedoRejections(t *testing.T) {
	fixture := newMediaFixture(t, true)
	code, _ := fixture.master(t, "Анна")
	stranger, _ := fixture.master(t, "Вера")
	uploaded := fixture.uploadMov(t, code)

	if got := fixture.call(http.MethodPost, "/api/media/"+uploaded.ID+"/redo", code, `{}`).Code; got != http.StatusConflict {
		t.Errorf("redo of a queued item = %d", got)
	}
	fixture.claim(t)
	fixture.finishClaimed(t, uploaded.ID, false)
	waitPush(t, fixture.pusher)
	if got := fixture.call(http.MethodPost, "/api/media/"+uploaded.ID+"/redo", stranger, `{}`).Code; got != http.StatusNotFound {
		t.Errorf("redo by another master = %d", got)
	}
	if got := fixture.call(http.MethodPost, "/api/media/"+uploaded.ID+"/redo", code, `not json`).Code; got != http.StatusBadRequest {
		t.Errorf("redo with a broken body = %d", got)
	}
	for range media.MaxRedos {
		if got := fixture.call(http.MethodPost, "/api/media/"+uploaded.ID+"/redo", code, `{}`).Code; got != http.StatusOK {
			t.Fatalf("redo = %d", got)
		}
		fixture.claim(t)
		fixture.finishClaimed(t, uploaded.ID, false)
		waitPush(t, fixture.pusher)
	}
	limit := fixture.call(http.MethodPost, "/api/media/"+uploaded.ID+"/redo", code, `{}`)
	if limit.Code != http.StatusConflict || !strings.Contains(limit.Body.String(), "3 раза") {
		t.Errorf("redo over the limit = %d %s", limit.Code, limit.Body)
	}
}
