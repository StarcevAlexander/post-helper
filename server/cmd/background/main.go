//go:build windows

package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

const (
	pidSuffix          = ".pid"
	createNoWindow     = 0x08000000
	queryLimitedAccess = 0x1000
	waitTimeout        = 0x00000102
	sameStartTolerance = time.Second
	exitBadUsage       = 2
	exitStartFailed    = 3
)

func main() {
	node := flag.String("node", "node", "node executable")
	script := flag.String("script", "", "script to keep running")
	logPath := flag.String("log", "", "log file for the script output")
	dir := flag.String("dir", "", "working directory")
	args := flag.String("args", "", "arguments for the script, space separated")
	flag.Parse()
	if *script == "" || *logPath == "" {
		os.Exit(exitBadUsage)
	}
	pidPath := *logPath + pidSuffix
	waitRecorded(pidPath)
	os.Exit(run(*node, *script, *logPath, *dir, strings.Fields(*args), pidPath))
}

func run(node, script, logPath, dir string, args []string, pidPath string) int {
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return exitStartFailed
	}
	defer logFile.Close()
	command := exec.Command(node, append([]string{script}, args...)...)
	command.Dir = dir
	command.Stdout, command.Stderr = logFile, logFile
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err := command.Start(); err != nil {
		fmt.Fprintf(logFile, "[background] %s: could not start %s: %v\n", time.Now().Format(time.DateTime), script, err)
		return exitStartFailed
	}
	pid := uint32(command.Process.Pid)
	if started, ok := startedAt(pid); ok {
		_ = os.WriteFile(pidPath, fmt.Appendf(nil, "%d %d", pid, started.UnixNano()), 0o644)
	}
	err = command.Wait()
	_ = os.Remove(pidPath)
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}
	if err != nil {
		return exitStartFailed
	}
	return 0
}

func waitRecorded(pidPath string) {
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return
	}
	var pid uint32
	var started int64
	if _, err := fmt.Sscan(string(data), &pid, &started); err != nil {
		return
	}
	handle, err := syscall.OpenProcess(syscall.SYNCHRONIZE|queryLimitedAccess, false, pid)
	if err != nil {
		return
	}
	defer syscall.CloseHandle(handle)
	actual, ok := createdAt(handle)
	if !ok || actual.Sub(time.Unix(0, started)).Abs() > sameStartTolerance {
		return
	}
	if event, _ := syscall.WaitForSingleObject(handle, 0); event != waitTimeout {
		return
	}
	_, _ = syscall.WaitForSingleObject(handle, syscall.INFINITE)
}

func startedAt(pid uint32) (time.Time, bool) {
	handle, err := syscall.OpenProcess(queryLimitedAccess, false, pid)
	if err != nil {
		return time.Time{}, false
	}
	defer syscall.CloseHandle(handle)
	return createdAt(handle)
}

func createdAt(handle syscall.Handle) (time.Time, bool) {
	var creation, exit, kernel, user syscall.Filetime
	if err := syscall.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return time.Time{}, false
	}
	return time.Unix(0, creation.Nanoseconds()), true
}
