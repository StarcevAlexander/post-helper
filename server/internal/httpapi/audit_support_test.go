package httpapi

import (
	"context"

	"post-helper/server/internal/audit"
)

type fakeAuditor struct {
	result   audit.Result
	err      error
	requests []audit.Request
}

func (f *fakeAuditor) Generate(_ context.Context, request audit.Request) (audit.Result, error) {
	f.requests = append(f.requests, request)
	return f.result, f.err
}

var pngSignature = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13, 'I', 'H', 'D', 'R'}

type auditFile struct {
	name string
	data []byte
}

func pngFiles(count int) []auditFile {
	files := make([]auditFile, count)
	for i := range files {
		files[i] = auditFile{name: "shot.png", data: pngSignature}
	}
	return files
}
