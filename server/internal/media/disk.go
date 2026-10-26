package media

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type DiskFiles struct {
	root string
}

func NewDiskFiles(root string) (*DiskFiles, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("media dir: %w", err)
	}
	if err := os.MkdirAll(absolute, 0o755); err != nil {
		return nil, fmt.Errorf("media dir: %w", err)
	}
	return &DiskFiles{root: absolute}, nil
}

func (d *DiskFiles) resolve(ref string) (string, error) {
	if ref == "" || strings.ContainsAny(ref, "\\:\x00") || strings.HasPrefix(ref, "/") {
		return "", ErrBadRef
	}
	for part := range strings.SplitSeq(ref, "/") {
		if part == "" || part == "." || part == ".." {
			return "", ErrBadRef
		}
	}
	full := filepath.Join(d.root, filepath.FromSlash(ref))
	relative, err := filepath.Rel(d.root, full)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", ErrBadRef
	}
	return full, nil
}

func (d *DiskFiles) Put(_ context.Context, ref string, reader io.Reader, limit int64) (int64, error) {
	full, err := d.resolve(ref)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return 0, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(full), ".upload-*")
	if err != nil {
		return 0, err
	}
	name := temporary.Name()
	size, copyErr := io.Copy(temporary, io.LimitReader(reader, limit+1))
	closeErr := temporary.Close()
	if err := errors.Join(copyErr, closeErr); err != nil {
		_ = os.Remove(name)
		return 0, err
	}
	if size > limit {
		_ = os.Remove(name)
		return 0, ErrFileTooLarge
	}
	if err := os.Rename(name, full); err != nil {
		_ = os.Remove(name)
		return 0, err
	}
	return size, nil
}

func (d *DiskFiles) Open(_ context.Context, ref string) (io.ReadSeekCloser, int64, error) {
	full, err := d.resolve(ref)
	if err != nil {
		return nil, 0, err
	}
	file, err := os.Open(full)
	if errors.Is(err, os.ErrNotExist) {
		return nil, 0, ErrNoFile
	}
	if err != nil {
		return nil, 0, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, 0, err
	}
	return file, info.Size(), nil
}

func (d *DiskFiles) Delete(_ context.Context, refs ...string) error {
	var failures []error
	for _, ref := range refs {
		if ref == "" {
			continue
		}
		full, err := d.resolve(ref)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
