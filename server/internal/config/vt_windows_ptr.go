//go:build windows

package config

import "unsafe"

func unsafePtr(p *uint32) unsafe.Pointer { return unsafe.Pointer(p) }
