package e2e_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Push subscription e2e (web-push change, ADR-0004): upsert-by-endpoint
// semantics (fresh create + refresh of keys/timezone), owner-scoped
// delete, auth rejection, timezone validation, the config endpoint, and -
// the architectural point - NO sync participation (no change_log entries
// ever appear in pull).

func pushSubBody(endpoint string) map[string]any {
	return map[string]any{
		"endpoint": endpoint,
		"keys":     map[string]any{"p256dh": "BPublicKeyMaterial", "auth": "AuthSecretMaterial"},
		"timeZone": "Europe/Moscow",
	}
}

func TestE2E_PushSubscriptions(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}

	c := &client{t: t, jar: map[string]string{}}
	resp := c.do(
		"POST",
		"/api/auth/register",
		map[string]any{"email": uniqueEmail(), "password": "supersecret1"},
	)
	require.Equal(t, 201, resp["__status"], resp["__body"])

	t.Run("create", func(t *testing.T) {
		resp := c.do(
			"POST",
			"/api/push/subscriptions",
			pushSubBody("https://fcm.googleapis.com/fcm/send/device-1"),
		)
		require.Equal(t, 200, resp["__status"], resp["__body"])
		assert.NotEmpty(t, resp["id"])
		assert.Equal(t, "Europe/Moscow", resp["timeZone"])
	})

	t.Run("upsert refreshes the same endpoint without duplicating", func(t *testing.T) {
		first := c.do(
			"POST",
			"/api/push/subscriptions",
			pushSubBody("https://fcm.googleapis.com/fcm/send/device-2"),
		)
		require.Equal(t, 200, first["__status"], first["__body"])

		body := pushSubBody("https://fcm.googleapis.com/fcm/send/device-2")
		body["keys"] = map[string]any{"p256dh": "BRotatedKey", "auth": "RotatedAuth"}
		body["timeZone"] = "Asia/Almaty"
		second := c.do("POST", "/api/push/subscriptions", body)
		require.Equal(t, 200, second["__status"], second["__body"])
		assert.Equal(t, first["id"], second["id"], "same endpoint must upsert, not duplicate")
		assert.Equal(t, "Asia/Almaty", second["timeZone"])
		assert.Equal(t, "BRotatedKey", second["keys"].(map[string]any)["p256dh"])
	})

	t.Run("delete own subscription", func(t *testing.T) {
		created := c.do(
			"POST",
			"/api/push/subscriptions",
			pushSubBody("https://fcm.googleapis.com/fcm/send/device-3"),
		)
		require.Equal(t, 200, created["__status"], created["__body"])

		deleted := c.do("DELETE", "/api/push/subscriptions/"+created["id"].(string), nil)
		require.Equal(t, 204, deleted["__status"], deleted["__body"])

		again := c.do("DELETE", "/api/push/subscriptions/"+created["id"].(string), nil)
		require.Equal(t, 404, again["__status"], again["__body"])
		assert.Equal(t, "PUSH_SUBSCRIPTION_NOT_FOUND", again["code"])
	})

	t.Run("another users subscription behaves as not-found", func(t *testing.T) {
		mine := c.do(
			"POST",
			"/api/push/subscriptions",
			pushSubBody("https://fcm.googleapis.com/fcm/send/device-4"),
		)
		require.Equal(t, 200, mine["__status"], mine["__body"])

		other := &client{t: t, jar: map[string]string{}}
		reg := other.do(
			"POST",
			"/api/auth/register",
			map[string]any{"email": uniqueEmail(), "password": "supersecret1"},
		)
		require.Equal(t, 201, reg["__status"], reg["__body"])

		resp := other.do("DELETE", "/api/push/subscriptions/"+mine["id"].(string), nil)
		require.Equal(t, 404, resp["__status"], resp["__body"])
		assert.Equal(t, "PUSH_SUBSCRIPTION_NOT_FOUND", resp["code"])
	})

	t.Run("unknown timezone rejected", func(t *testing.T) {
		body := pushSubBody("https://fcm.googleapis.com/fcm/send/device-5")
		body["timeZone"] = "Mars/Olympus"
		resp := c.do("POST", "/api/push/subscriptions", body)
		require.Equal(t, 422, resp["__status"], resp["__body"])
		assert.Equal(t, "PUSH_SUBSCRIPTION_TIMEZONE_INVALID", resp["code"])
	})

	t.Run("config reports disabled without VAPID keys", func(t *testing.T) {
		resp := c.do("GET", "/api/config/push", nil)
		require.Equal(t, 200, resp["__status"], resp["__body"])
		assert.Equal(t, false, resp["enabled"])
		assert.Empty(t, resp["vapidPublicKey"])
	})

	t.Run("subscriptions never appear in sync pull", func(t *testing.T) {
		// The architectural invariant (ADR-0004): subscriptions are NOT a
		// synced entity. Register one, then pull the full history.
		_ = c.do(
			"POST",
			"/api/push/subscriptions",
			pushSubBody("https://fcm.googleapis.com/fcm/send/device-6"),
		)
		resp := c.do("GET", "/api/sync/pull?limit=500", nil)
		require.Equal(t, 200, resp["__status"], resp["__body"])
		for _, raw := range resp["changes"].([]any) {
			change := raw.(map[string]any)
			assert.NotEqual(t, "push_subscription", change["entity"],
				"push subscriptions must not enter the change log")
		}
	})
}

func TestE2E_PushSubscriptionsRequireAuth(t *testing.T) {
	if testing.Short() {
		t.Skip("requires Docker for testcontainers")
	}

	anon := &client{t: t, jar: map[string]string{}}

	resp := anon.do(
		"POST",
		"/api/push/subscriptions",
		pushSubBody("https://fcm.googleapis.com/fcm/send/anon"),
	)
	require.Equal(t, 401, resp["__status"], resp["__body"])

	resp = anon.do("DELETE", "/api/push/subscriptions/00000000-0000-4000-8000-000000000000", nil)
	require.Equal(t, 401, resp["__status"], resp["__body"])

	resp = anon.do("GET", "/api/config/push", nil)
	require.Equal(t, 401, resp["__status"], resp["__body"])
}
