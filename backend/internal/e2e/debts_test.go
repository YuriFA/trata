package e2e_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Debts e2e: REST CRUD semantics (ownership, uniqueness, version CAS, note
// PATCH rules, live-only in-use guard) and the sync edge cases recorded in
// the add-debts design D8: opId replay vs entity-id claims, delete idempotency
// and delete-wins, deleted-conflict on tombstones, name-taken per-item errors,
// and an operation pushed for a server-deleted debtor.

func TestE2E_DebtorsRestFlows(t *testing.T) {
	if testing.Short() {
		t.Skip("e2e requires Postgres")
	}

	c := &client{t: t, jar: map[string]string{}}
	resp := c.do(
		"POST",
		"/api/auth/register",
		map[string]any{"email": uniqueEmail(), "password": "supersecret1"},
	)
	require.Equal(t, 201, resp["__status"], resp["__body"])

	debtorID := "88888888-8888-4888-8888-888888888888"

	// --- Create with a client id ---
	created := c.do(
		"POST",
		"/api/debtors",
		map[string]any{"id": debtorID, "name": "Анна", "note": "colleague"},
	)
	require.Equal(t, 201, created["__status"], created["__body"])
	assert.Equal(t, "Анна", created["name"])
	assert.Equal(t, "colleague", created["note"])
	assert.InDelta(t, float64(1), created["version"], 0)

	// --- Duplicate name -> 409 DEBTOR_ALREADY_EXISTS ---
	dup := c.do("POST", "/api/debtors", map[string]any{"name": "Анна"})
	require.Equal(t, 409, dup["__status"], dup["__body"])
	assert.Equal(t, "DEBTOR_ALREADY_EXISTS", dup["code"])

	// --- Empty name -> 400 (validator minLength) ---
	bad := c.do("POST", "/api/debtors", map[string]any{"name": ""})
	require.Equal(t, 400, bad["__status"])

	// --- PATCH: absent note keeps, empty string clears, null rejected ---
	updated := c.do(
		"PATCH",
		"/api/debtors/"+debtorID,
		map[string]any{"version": 1, "name": "Анна П."},
	)
	require.Equal(t, 200, updated["__status"], updated["__body"])
	assert.Equal(t, "colleague", updated["note"], "absent note keeps the value")
	assert.InDelta(t, float64(2), updated["version"], 0)

	updated = c.do("PATCH", "/api/debtors/"+debtorID, map[string]any{"version": 2, "note": ""})
	require.Equal(t, 200, updated["__status"], updated["__body"])
	assert.Empty(t, updated["note"], "empty string clears the note")

	nullNote := c.do("PATCH", "/api/debtors/"+debtorID, map[string]any{"version": 3, "note": nil})
	require.Equal(t, 400, nullNote["__status"], nullNote["__body"])

	stale := c.do("PATCH", "/api/debtors/"+debtorID, map[string]any{"version": 1, "note": "stale"})
	require.Equal(t, 409, stale["__status"])
	assert.Equal(t, "DEBTOR_VERSION_CONFLICT", stale["code"])

	empty := c.do("PATCH", "/api/debtors/"+debtorID, map[string]any{"version": 3})
	require.Equal(t, 400, empty["__status"], empty["__body"])

	// --- Operations: create, unknown debtor 422, amount validation ---
	op := c.do("POST", "/api/debt-operations", map[string]any{
		"debtorId": debtorID, "direction": "receivable", "kind": "debt",
		"amount": 500000, "occurredAt": "2026-08-20T10:00:00Z", "note": "дал в долг",
	})
	require.Equal(t, 201, op["__status"], op["__body"])
	opID, _ := op["id"].(string)
	assert.InDelta(t, float64(500000), op["amount"], 0)

	unknown := c.do("POST", "/api/debt-operations", map[string]any{
		"debtorId": "99999999-9999-4999-8999-999999999999", "direction": "payable", "kind": "debt",
		"amount": 100, "occurredAt": "2026-08-20T10:00:00Z",
	})
	require.Equal(t, 422, unknown["__status"], unknown["__body"])
	assert.Equal(t, "DEBT_OPERATION_DEBTOR_NOT_FOUND", unknown["code"])

	zero := c.do("POST", "/api/debt-operations", map[string]any{
		"debtorId": debtorID, "direction": "receivable", "kind": "repayment",
		"amount": 0, "occurredAt": "2026-08-20T10:00:00Z",
	})
	require.Equal(t, 400, zero["__status"])

	// Over-repayment is data, not an error: a repayment larger than the debt
	// is accepted; balances are derived client-side.
	over := c.do("POST", "/api/debt-operations", map[string]any{
		"debtorId": debtorID, "direction": "receivable", "kind": "repayment",
		"amount": 600000, "occurredAt": "2026-08-21T10:00:00Z",
	})
	require.Equal(t, 201, over["__status"], over["__body"])
	overID, _ := over["id"].(string)

	// --- Update with CAS ---
	edited := c.do(
		"PATCH",
		"/api/debt-operations/"+opID,
		map[string]any{"version": 1, "amount": 450000},
	)
	require.Equal(t, 200, edited["__status"], edited["__body"])
	assert.InDelta(t, float64(450000), edited["amount"], 0)

	conflict := c.do(
		"PATCH",
		"/api/debt-operations/"+opID,
		map[string]any{"version": 1, "amount": 1},
	)
	require.Equal(t, 409, conflict["__status"])
	assert.Equal(t, "DEBT_OPERATION_VERSION_CONFLICT", conflict["code"])

	// --- In-use guard counts LIVE operations only ---
	inUse := c.do("DELETE", "/api/debtors/"+debtorID, nil)
	require.Equal(t, 409, inUse["__status"], inUse["__body"])
	assert.Equal(t, "DEBTOR_IN_USE", inUse["code"])

	del := c.do("DELETE", "/api/debt-operations/"+opID, nil)
	require.Equal(t, 204, del["__status"])
	del = c.do("DELETE", "/api/debt-operations/"+overID, nil)
	require.Equal(t, 204, del["__status"])

	// REST delete of an already-deleted record reads as not-found.
	del = c.do("DELETE", "/api/debt-operations/"+opID, nil)
	require.Equal(t, 404, del["__status"])

	// All operations tombstoned -> the debtor is deletable; the name frees up.
	ok := c.do("DELETE", "/api/debtors/"+debtorID, nil)
	require.Equal(t, 204, ok["__status"])
	gone := c.do("GET", "/api/debtors/"+debtorID, nil)
	require.Equal(t, 404, gone["__status"])
	gone = c.do("DELETE", "/api/debtors/"+debtorID, nil)
	require.Equal(t, 404, gone["__status"])

	recreated := c.do("POST", "/api/debtors", map[string]any{"name": "Анна"})
	require.Equal(t, 201, recreated["__status"], recreated["__body"])

	// Listings exclude tombstones; filter by debtor works.
	list := c.do("GET", "/api/debt-operations", nil)
	body, _ := list["__body"].(string)
	assert.NotContains(t, body, opID)
	assert.NotContains(t, body, overID)

	list = c.do("GET", "/api/debt-operations?debtorId="+recreated["id"].(string), nil)
	require.Equal(t, 200, list["__status"])
}

func TestE2E_DebtsSyncFlows(t *testing.T) {
	if testing.Short() {
		t.Skip("e2e requires Postgres")
	}

	c := &client{t: t, jar: map[string]string{}}
	resp := c.do(
		"POST",
		"/api/auth/register",
		map[string]any{"email": uniqueEmail(), "password": "supersecret1"},
	)
	require.Equal(t, 201, resp["__status"], resp["__body"])
	_, cursor := pullAll(t, c, 0)

	debtorID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	opID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	debtorCreateOp := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	opCreateOp := "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

	// --- Push debtor + operation (client ids, baseVersion 0) ---
	results := push(t, c, []map[string]any{
		{
			"opId": debtorCreateOp, "entity": "debtor", "action": "upsert", "id": debtorID, "baseVersion": 0,
			"data": map[string]any{"name": "Михаил", "note": "", "currency": "RUB"},
		},
		{
			"opId": opCreateOp, "entity": "debt_operation", "action": "upsert", "id": opID, "baseVersion": 0,
			"data": map[string]any{
				"debtorId": debtorID, "direction": "receivable", "kind": "debt",
				"amount": 200000, "note": "", "occurredAt": "2026-08-20T10:00:00Z",
			},
		},
	})
	require.Len(t, results, 2)
	for _, r := range results {
		assert.Equal(t, "applied", r["status"], "%v", r)
		assert.InDelta(t, float64(1), r["version"], 0)
	}

	// --- Replay of the same opId returns the stored applied result ---
	results = push(t, c, []map[string]any{
		{
			"opId": debtorCreateOp, "entity": "debtor", "action": "upsert", "id": debtorID, "baseVersion": 0,
			"data": map[string]any{"name": "Михаил", "note": "", "currency": "RUB"},
		},
	})
	require.Len(t, results, 1)
	assert.Equal(t, "applied", results[0]["status"])
	assert.InDelta(
		t,
		float64(1),
		results[0]["version"],
		0,
		"replay reports the original result, not already-exists",
	)

	// --- Different opId claiming the same entity id -> SYNC_ALREADY_EXISTS ---
	results = push(t, c, []map[string]any{
		{
			"opId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "entity": "debtor", "action": "upsert",
			"id": debtorID, "baseVersion": 0,
			"data": map[string]any{"name": "Другой", "note": "", "currency": "RUB"},
		},
	})
	require.Len(t, results, 1)
	assert.Equal(t, "conflict", results[0]["status"])
	assert.Equal(t, "SYNC_ALREADY_EXISTS", results[0]["code"])
	serverState, ok := results[0]["serverState"].(map[string]any)
	require.True(t, ok, "conflict carries serverState")
	assert.InDelta(t, float64(1), serverState["version"], 0)

	// --- Concurrent delete/update: update first, then delete-wins ---
	updateOp := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	results = push(t, c, []map[string]any{
		{
			"opId": updateOp, "entity": "debt_operation", "action": "upsert", "id": opID, "baseVersion": 1,
			"data": map[string]any{
				"debtorId": debtorID, "direction": "receivable", "kind": "debt",
				"amount": 300000, "note": "", "occurredAt": "2026-08-20T10:00:00Z",
			},
		},
	})
	require.Len(t, results, 1)
	assert.Equal(t, "applied", results[0]["status"])
	assert.InDelta(t, float64(2), results[0]["version"], 0)

	// The delete carries the STALE baseVersion 1 (the editing device never saw
	// the update) - a sync delete is delete-wins, never a version conflict.
	deleteOp := "11111111-2222-4222-8222-222222222222"
	results = push(t, c, []map[string]any{
		{
			"opId":        deleteOp,
			"entity":      "debt_operation",
			"action":      "delete",
			"id":          opID,
			"baseVersion": 1,
		},
	})
	require.Len(t, results, 1)
	assert.Equal(t, "applied", results[0]["status"], "delete-wins over a concurrent edit")
	assert.InDelta(t, float64(3), results[0]["version"], 0, "tombstone bumps the version once")

	// Delete of an already-deleted record is idempotent with the current version.
	idemDelete := "11111111-3333-4333-8333-333333333333"
	results = push(t, c, []map[string]any{
		{
			"opId":        idemDelete,
			"entity":      "debt_operation",
			"action":      "delete",
			"id":          opID,
			"baseVersion": 3,
		},
	})
	require.Len(t, results, 1)
	assert.Equal(t, "applied", results[0]["status"])
	assert.InDelta(t, float64(3), results[0]["version"], 0)

	// Upsert onto the tombstoned record -> deleted conflict.
	results = push(t, c, []map[string]any{
		{
			"opId": "11111111-4444-4444-8444-444444444444", "entity": "debt_operation", "action": "upsert",
			"id": opID, "baseVersion": 3,
			"data": map[string]any{
				"debtorId": debtorID, "direction": "receivable", "kind": "debt",
				"amount": 1, "note": "", "occurredAt": "2026-08-20T10:00:00Z",
			},
		},
	})
	require.Len(t, results, 1)
	assert.Equal(t, "conflict", results[0]["status"])
	assert.Equal(t, "SYNC_DELETED_CONFLICT", results[0]["code"])
	serverState, ok = results[0]["serverState"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, true, serverState["deleted"])

	// --- Operation for a server-deleted debtor: per-item error, batch intact ---
	// Delete the debtor via sync (its only operation is tombstoned, so the
	// guard passes), then push a new operation referencing it.
	debtorDeleteOp := "11111111-5555-4555-8555-555555555555"
	results = push(t, c, []map[string]any{
		{
			"opId":        debtorDeleteOp,
			"entity":      "debtor",
			"action":      "delete",
			"id":          debtorID,
			"baseVersion": 1,
		},
	})
	require.Len(t, results, 1)
	assert.Equal(t, "applied", results[0]["status"])

	orphanOp := "11111111-6666-4666-8666-666666666666"
	healthyDebtor := "aaaaaaaa-bbbb-4bbb-8bbb-cccccccccccc"
	results = push(t, c, []map[string]any{
		{
			"opId": "11111111-7777-4777-8777-777777777777", "entity": "debtor", "action": "upsert",
			"id": healthyDebtor, "baseVersion": 0,
			"data": map[string]any{"name": "Ольга", "note": "", "currency": "RUB"},
		},
		{
			"opId": orphanOp, "entity": "debt_operation", "action": "upsert",
			"id": "aaaaaaaa-cccc-4ccc-8ccc-dddddddddddd", "baseVersion": 0,
			"data": map[string]any{
				"debtorId": debtorID, "direction": "receivable", "kind": "debt",
				"amount": 50000, "note": "", "occurredAt": "2026-08-20T10:00:00Z",
			},
		},
	})
	require.Len(t, results, 2)
	assert.Equal(t, "applied", results[0]["status"], "the batch is not aborted")
	assert.Equal(t, "error", results[1]["status"], "%v", results[1])
	assert.Equal(t, "DEBT_OPERATION_DEBTOR_NOT_FOUND", results[1]["code"])

	// --- Debtor-name collision on sync push: per-item error, not an abort ---
	results = push(t, c, []map[string]any{
		{
			"opId": "11111111-8888-4888-8888-888888888888", "entity": "debtor", "action": "upsert",
			"id": "aaaaaaaa-dddd-4ddd-8ddd-eeeeeeeeeeee", "baseVersion": 0,
			"data": map[string]any{"name": "Ольга", "note": "", "currency": "RUB"},
		},
	})
	require.Len(t, results, 1)
	assert.Equal(t, "error", results[0]["status"])
	assert.Equal(t, "DEBTOR_ALREADY_EXISTS", results[0]["code"])

	// --- REST against the sync-tombstoned debtor reads as not-found ---
	gone := c.do("GET", "/api/debtors/"+debtorID, nil)
	require.Equal(t, 404, gone["__status"])
	gone = c.do("PATCH", "/api/debtors/"+debtorID, map[string]any{"version": 1, "note": "x"})
	require.Equal(t, 404, gone["__status"])

	// --- Pull: debt entities ride the change feed with their tombstones ---
	changes, _ := pullAll(t, c, cursor)
	entities := map[string][]string{}
	for _, change := range changes {
		entity, _ := change["entity"].(string)
		action, _ := change["action"].(string)
		entities[entity] = append(entities[entity], action)
	}
	assert.Equal(t, []string{"upsert", "tombstone", "upsert"}, entities["debtor"])
	assert.Equal(t, []string{"upsert", "upsert", "tombstone"}, entities["debt_operation"])

	// The errored/conflicted items never touched the change log.
	for _, id := range []string{"aaaaaaaa-cccc-4ccc-8ccc-dddddddddddd", "aaaaaaaa-dddd-4ddd-8ddd-eeeeeeeeeeee"} {
		for _, change := range changes {
			assert.NotEqual(t, id, change["id"], "unapplied pushes stay out of the change log")
		}
	}
}

// A16 regression: listings are scoped by the caller's household, not by user
// id. Since the household change user and household ids are distinct UUIDs,
// so a user-scoped listing hides every record the user creates.
func TestE2E_DebtsListingsHouseholdScoped(t *testing.T) {
	if testing.Short() {
		t.Skip("e2e requires Postgres")
	}

	c := &client{t: t, jar: map[string]string{}}
	resp := c.do(
		"POST",
		"/api/auth/register",
		map[string]any{"email": uniqueEmail(), "password": "supersecret1"},
	)
	require.Equal(t, 201, resp["__status"], resp["__body"])

	created := c.do("POST", "/api/debtors", map[string]any{"name": "Мария"})
	require.Equal(t, 201, created["__status"], created["__body"])
	debtorID, _ := created["id"].(string)

	op := c.do("POST", "/api/debt-operations", map[string]any{
		"debtorId": debtorID, "direction": "receivable", "kind": "debt",
		"amount": 100000, "occurredAt": "2026-08-20T10:00:00Z",
	})
	require.Equal(t, 201, op["__status"], op["__body"])
	opID, _ := op["id"].(string)

	list := c.do("GET", "/api/debtors", nil)
	require.Equal(t, 200, list["__status"])
	body, _ := list["__body"].(string)
	assert.Contains(t, body, debtorID, "the caller's own debtor must be listed")

	opsList := c.do("GET", "/api/debt-operations", nil)
	require.Equal(t, 200, opsList["__status"])
	opsBody, _ := opsList["__body"].(string)
	assert.Contains(t, opsBody, opID, "the caller's own debt operation must be listed")
}
