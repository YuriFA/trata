-- households + membership. The household is the scoping unit of all shared
-- records; membership is the access right. v1 guarantees at most one
-- membership per user (unique index idx_household_members_user), so the
-- by-user lookup below is the middleware's single-hop household resolution.

-- name: GetMembershipByUser :one
SELECT household_id, user_id, role, joined_at
FROM household_members
WHERE user_id = $1;

-- name: GetHouseholdByID :one
SELECT id, name, currency, created_at
FROM households
WHERE id = $1;

-- name: GetHouseholdMembers :many
-- Member listing for GET /api/household: joined with the user's email and
-- display name (null = never set).
SELECT m.household_id, m.user_id, u.email, u.display_name, m.role, m.joined_at
FROM household_members m
JOIN users u ON u.id = m.user_id
WHERE m.household_id = $1
ORDER BY m.joined_at, m.user_id;
