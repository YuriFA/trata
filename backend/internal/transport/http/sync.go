package http

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/transport/http/httpctx"
)

// SyncPush applies a batch of client operations; the endpoint always answers
// 200 with per-item results (applied / conflict / error). Only infrastructure
// failures surface as endpoint-level errors.
func (s *Server) SyncPush(
	ctx context.Context,
	req api.SyncPushRequestObject,
) (api.SyncPushResponseObject, error) {
	user := s.currentUser(ctx)

	ops := make([]domain.SyncOperation, 0, len(req.Body.Operations))
	for _, o := range req.Body.Operations {
		var data json.RawMessage
		if o.Data != nil {
			raw, err := json.Marshal(o.Data)
			if err != nil {
				return nil, err
			}
			data = raw
		}
		ops = append(ops, domain.SyncOperation{
			OpID:        o.OpId,
			Entity:      string(o.Entity),
			Action:      string(o.Action),
			ID:          o.Id,
			BaseVersion: o.BaseVersion,
			Data:        data,
		})
	}

	results, err := s.sync.Push(ctx, s.currentScope(ctx), ops)
	if err != nil {
		return nil, err
	}

	m := summarizePushResults(results)
	s.log.InfoContext(ctx, "sync push metrics",
		slog.String("user_id", user.ID.String()),
		slog.String("request_id", httpctx.RequestID(ginCtx(ctx))),
		slog.Int("operations", m.operations),
		slog.Int("applied", m.applied),
		slog.Int("conflicts", m.conflicts),
		slog.Int("errors", m.errors),
		slog.Float64("conflict_rate", m.conflictRate()),
		slog.Any("conflict_codes", m.conflictCodes),
	)

	out := make([]api.SyncPushResult, 0, len(results))
	for _, r := range results {
		out = append(out, toAPISyncPushResult(r))
	}
	return api.SyncPush200JSONResponse{Results: out}, nil
}

// SyncPull returns the change-log page after the client's cursor.
func (s *Server) SyncPull(
	ctx context.Context,
	req api.SyncPullRequestObject,
) (api.SyncPullResponseObject, error) {
	scope := s.currentScope(ctx)

	var afterSeq int64
	if req.Params.Cursor != nil {
		afterSeq = *req.Params.Cursor
	}

	page, err := s.sync.Pull(ctx, scope, afterSeq, req.Params.Limit)
	if err != nil {
		return nil, err
	}

	changes := make([]api.SyncChange, 0, len(page.Changes))
	tombstones := 0
	for _, c := range page.Changes {
		if c.Action == domain.SyncChangeTombstone {
			tombstones++
		}
		change := api.SyncChange{
			Seq:     c.Seq,
			UserId:  toUUIDPtr(&c.UserID),
			Entity:  api.SyncEntity(c.Entity),
			Id:      toUUID(c.ID),
			Action:  api.SyncChangeAction(c.Action),
			Version: c.Version,
		}
		if c.Data != nil {
			raw, err := json.Marshal(c.Data)
			if err != nil {
				return nil, err
			}
			var data api.SyncChange_Data
			if err := json.Unmarshal(raw, &data); err != nil {
				return nil, err
			}
			change.Data = &data
		}
		changes = append(changes, change)
	}
	s.log.InfoContext(ctx, "sync pull metrics",
		slog.String("household_id", scope.HouseholdID.String()),
		slog.String("request_id", httpctx.RequestID(ginCtx(ctx))),
		slog.Int64("cursor", afterSeq),
		slog.Int("changes", len(page.Changes)),
		slog.Int("tombstones", tombstones),
		slog.Bool("caught_up", page.NextCursor == nil),
	)
	return api.SyncPull200JSONResponse{Changes: changes, NextCursor: page.NextCursor}, nil
}

// pushMetrics summarizes one push batch for the sync metrics feed: per-status
// counts, the share of operations that conflicted, and the conflict-code
// breakdown (conflict-rate monitoring keys off these events).
type pushMetrics struct {
	operations    int
	applied       int
	conflicts     int
	errors        int
	conflictCodes map[string]int
}

func summarizePushResults(results []domain.SyncPushResult) pushMetrics {
	m := pushMetrics{operations: len(results), conflictCodes: make(map[string]int)}
	for _, r := range results {
		switch r.Status {
		case domain.SyncStatusApplied:
			m.applied++
		case domain.SyncStatusConflict:
			m.conflicts++
			if r.Code != "" {
				m.conflictCodes[r.Code]++
			}
		case domain.SyncStatusError:
			m.errors++
		}
	}
	return m
}

// conflictRate is the share of pushed operations that came back as conflicts.
func (m pushMetrics) conflictRate() float64 {
	if m.operations == 0 {
		return 0
	}
	return float64(m.conflicts) / float64(m.operations)
}

func toAPISyncPushResult(r domain.SyncPushResult) api.SyncPushResult {
	out := api.SyncPushResult{
		OpId:   toUUID(r.OpID),
		Status: api.SyncPushResultStatus(r.Status),
	}
	if r.Version != 0 {
		v := r.Version
		out.Version = &v
	}
	if r.Code != "" {
		code := r.Code
		out.Code = &code
	}
	if r.Message != "" {
		message := r.Message
		out.Message = &message
	}
	if r.ServerState != nil {
		state := &api.SyncServerState{
			Version: r.ServerState.Version,
			Deleted: r.ServerState.Deleted,
		}
		if len(r.ServerState.Data) > 0 {
			var data api.SyncServerState_Data
			if err := json.Unmarshal(r.ServerState.Data, &data); err == nil {
				state.Data = &data
			}
		}
		out.ServerState = state
	}
	return out
}
