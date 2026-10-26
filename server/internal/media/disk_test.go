package media

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiskFilesStoreReadAndDelete(t *testing.T) {
	root := filepath.Join(t.TempDir(), "media")
	disk, err := NewDiskFiles(root)
	if err != nil {
		t.Fatalf("NewDiskFiles: %v", err)
	}
	ctx := context.Background()

	size, err := disk.Put(ctx, "m1/a-result.mp4", strings.NewReader("0123456789"), 100)
	if err != nil || size != 10 {
		t.Fatalf("put = %d, %v", size, err)
	}
	file, opened, err := disk.Open(ctx, "m1/a-result.mp4")
	if err != nil || opened != 10 {
		t.Fatalf("open = %d, %v", opened, err)
	}
	if _, err := file.Seek(4, io.SeekStart); err != nil {
		t.Fatalf("seek: %v", err)
	}
	rest, _ := io.ReadAll(file)
	_ = file.Close()
	if string(rest) != "456789" {
		t.Errorf("rest = %q", rest)
	}
	if err := disk.Delete(ctx, "m1/a-result.mp4", "m1/missing.jpg", ""); err != nil {
		t.Errorf("delete: %v", err)
	}
	if _, _, err := disk.Open(ctx, "m1/a-result.mp4"); !errors.Is(err, ErrNoFile) {
		t.Errorf("open after delete: %v", err)
	}
}

func TestDiskFilesCutTheOversizedUploadAndLeaveNothing(t *testing.T) {
	root := t.TempDir()
	disk, _ := NewDiskFiles(root)

	_, err := disk.Put(context.Background(), "m1/big.mp4", strings.NewReader("0123456789"), 5)

	if !errors.Is(err, ErrFileTooLarge) {
		t.Fatalf("put: %v", err)
	}
	entries, _ := os.ReadDir(filepath.Join(root, "m1"))
	if len(entries) != 0 {
		t.Errorf("left on disk: %v", entries)
	}
}

func TestDiskFilesRefuseReferencesOutsideTheRoot(t *testing.T) {
	root := t.TempDir()
	disk, _ := NewDiskFiles(filepath.Join(root, "media"))
	ctx := context.Background()

	for _, ref := range []string{"", "../escape.txt", "m1/../../escape.txt", "/etc/passwd", `m1\..\x`, "C:/x", "m1//a", "./a", "m1/./a"} {
		if _, err := disk.Put(ctx, ref, strings.NewReader("x"), 10); !errors.Is(err, ErrBadRef) {
			t.Errorf("put %q: %v", ref, err)
		}
		if _, _, err := disk.Open(ctx, ref); !errors.Is(err, ErrBadRef) && ref != "" {
			t.Errorf("open %q: %v", ref, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "escape.txt")); err == nil {
		t.Error("a file escaped the media directory")
	}
}
