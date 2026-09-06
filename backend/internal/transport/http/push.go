package http

import (
	"context"

	"github.com/yurifa/expense-tracker-api/internal/api"
)

// Web Push subscription endpoints (web-push change, ADR-0004). Upsert is
// idempotent per endpoint (a device re-registering refreshes its keys and
// timezone), delete is scoped to the caller's own subscriptions. The
// endpoint URL is treated as an opaque bearer secret end to end.

func (s *Server) UpsertPushSubscription(
	ctx context.Context,
	req api.UpsertPushSubscriptionRequestObject,
) (api.UpsertPushSubscriptionResponseObject, error) {
	user := s.currentUser(ctx)
	sub, err := s.push.UpsertSubscription(
		ctx, user.ID,
		req.Body.Endpoint, req.Body.Keys.P256dh, req.Body.Keys.Auth, req.Body.TimeZone,
	)
	if err != nil {
		return nil, err
	}
	return api.UpsertPushSubscription200JSONResponse(api.PushSubscription{
		Id:        sub.ID,
		Endpoint:  sub.Endpoint,
		Keys:      api.PushSubscriptionKeys{P256dh: sub.P256dh, Auth: sub.Auth},
		TimeZone:  sub.TimeZone,
		CreatedAt: sub.CreatedAt,
	}), nil
}

func (s *Server) DeletePushSubscription(
	ctx context.Context,
	req api.DeletePushSubscriptionRequestObject,
) (api.DeletePushSubscriptionResponseObject, error) {
	user := s.currentUser(ctx)
	if err := s.push.DeleteSubscription(ctx, user.ID, req.Id); err != nil {
		return nil, err
	}
	return api.DeletePushSubscription204Response{}, nil
}

// GetPushConfig tells the client whether the server can send pushes at all
// (VAPID keys configured) and hands over the public key for subscribe().
func (s *Server) GetPushConfig(
	_ context.Context,
	_ api.GetPushConfigRequestObject,
) (api.GetPushConfigResponseObject, error) {
	return api.GetPushConfig200JSONResponse(api.PushConfig{
		Enabled:        s.pushCfg.Enabled(),
		VapidPublicKey: s.pushCfg.VapidPublicKey,
	}), nil
}
