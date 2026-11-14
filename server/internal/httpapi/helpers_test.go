package httpapi_test

import (
	"context"
	"math"
	"net/url"
	"strconv"
	"testing"
)

type urlT = url.URL

func urlParse(s string) (*urlT, error) { return url.Parse(s) }
func itoa(i int) string                { return strconv.Itoa(i) }
func mathBits(f float32) uint32        { return math.Float32bits(f) }
func mathFromBits(b uint32) float32    { return math.Float32frombits(b) }

func userIDOf(t *testing.T, e *env, username string) string {
	t.Helper()
	u, err := e.db.UserByUsername(context.Background(), username)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID
}
