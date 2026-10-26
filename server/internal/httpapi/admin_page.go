package httpapi

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed admin
var adminFiles embed.FS

func adminPage() http.Handler {
	files, err := fs.Sub(adminFiles, AdminPageDir)
	if err != nil {
		panic(err)
	}
	pages := http.StripPrefix(AdminPagePrefix, http.FileServer(http.FS(files)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", AdminPageCacheControl)
		w.Header().Set("Content-Security-Policy", AdminPageCSP)
		w.Header().Set("X-Content-Type-Options", MediaNoSniff)
		pages.ServeHTTP(w, r)
	})
}
