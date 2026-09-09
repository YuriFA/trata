package pushremind

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/yurifa/trata/backend/internal/domain"
)

// ErrGone marks a subscription the push service reported as permanently
// dead (410/404): the caller prunes it, delivery to other subscriptions
// continues unaffected.
var ErrGone = errors.New("push subscription is gone")

// IsGone reports whether err (or anything it wraps) means the subscription
// no longer exists at the push service.
func IsGone(err error) bool { return errors.Is(err, ErrGone) }

// WebPushSender is the production Sender: VAPID-signed RFC 8291 message
// encryption via webpush-go. The private key lives only here, server-side;
// clients receive just the public key through GET /api/config/push.
type WebPushSender struct {
	privateKey string
	publicKey  string
	subscriber string
}

func NewWebPushSender(privateKey, publicKey, subscriber string) *WebPushSender {
	return &WebPushSender{privateKey: privateKey, publicKey: publicKey, subscriber: subscriber}
}

func (s *WebPushSender) Send(
	ctx context.Context,
	sub domain.PushSubscription,
	payload []byte,
) error {
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		VAPIDPrivateKey: s.privateKey,
		VAPIDPublicKey:  s.publicKey,
		Subscriber:      s.subscriber,
		Urgency:         webpush.UrgencyNormal,
		TTL:             int(reminderTTL.Seconds()),
	})
	if err != nil {
		// webpush-go surfaces transport errors and key-decode failures here;
		// neither is a verdict on the subscription itself, so they retry.
		return fmt.Errorf("webpush send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated:
		return nil
	case http.StatusGone, http.StatusNotFound:
		return fmt.Errorf("%w: endpoint returned %s", ErrGone, resp.Status)
	default:
		return fmt.Errorf("webpush endpoint returned %s", resp.Status)
	}
}
