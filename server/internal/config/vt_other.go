//go:build !windows

package config

func enableVT() bool { return true }
