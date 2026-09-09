package service_test

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"io"
	"log/slog"
	"net/smtp"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/yurifa/trata/backend/internal/service"
)

// fakeSMTPConn records the SMTP conversation and returns canned errors per
// step. It stands in for [smtp.Client] at the mailer's dial seams.
type fakeSMTPConn struct {
	helloName string
	tlsConfig *tls.Config
	auth      smtp.Auth
	from      string
	rcpt      []string
	message   bytes.Buffer
	quit      bool
	closed    bool

	// errs maps conversation steps ("hello", "starttls", "auth", "mail",
	// "rcpt", "data") to errors they should return.
	errs map[string]error
}

type nopWriteCloser struct{ buf *bytes.Buffer }

func (w nopWriteCloser) Write(p []byte) (int, error) { return w.buf.Write(p) }
func (nopWriteCloser) Close() error                  { return nil }

func (c *fakeSMTPConn) Hello(name string) error {
	if err := c.errs["hello"]; err != nil {
		return err
	}
	c.helloName = name
	return nil
}

func (c *fakeSMTPConn) StartTLS(cfg *tls.Config) error {
	if err := c.errs["starttls"]; err != nil {
		return err
	}
	c.tlsConfig = cfg
	return nil
}

func (c *fakeSMTPConn) Auth(a smtp.Auth) error {
	if err := c.errs["auth"]; err != nil {
		return err
	}
	c.auth = a
	return nil
}

func (c *fakeSMTPConn) Mail(from string) error {
	if err := c.errs["mail"]; err != nil {
		return err
	}
	c.from = from
	return nil
}

func (c *fakeSMTPConn) Rcpt(to string) error {
	if err := c.errs["rcpt"]; err != nil {
		return err
	}
	c.rcpt = append(c.rcpt, to)
	return nil
}

func (c *fakeSMTPConn) Data() (io.WriteCloser, error) {
	if err := c.errs["data"]; err != nil {
		return nil, err
	}
	return nopWriteCloser{buf: &c.message}, nil
}

func (c *fakeSMTPConn) Quit() error {
	if err := c.errs["quit"]; err != nil {
		return err
	}
	c.quit = true
	return nil
}

func (c *fakeSMTPConn) Close() error { c.closed = true; return nil }

// dialRecorder counts plain vs implicit-TLS dials; both dialers hand out
// the same fake conn so the conversation can be inspected.
type dialRecorder struct {
	plain, tls int
	conn       *fakeSMTPConn
}

func (r *dialRecorder) dialers() (service.SMTPDialFunc, service.SMTPDialFunc) {
	plain := func(context.Context) (service.SMTPConn, error) { r.plain++; return r.conn, nil }
	implicit := func(context.Context) (service.SMTPConn, error) { r.tls++; return r.conn, nil }
	return plain, implicit
}

// newTestSMTPMailer builds a real smtpMailer through the public
// constructors with recording dial seams installed.
func newTestSMTPMailer(t *testing.T, cfg service.SMTPMailerConfig) (service.Mailer, *fakeSMTPConn, *dialRecorder) {
	t.Helper()

	rec := &dialRecorder{conn: &fakeSMTPConn{}}
	plain, implicit := rec.dialers()
	mailer, err := service.NewSMTPMailerWithDial(slog.New(slog.DiscardHandler), cfg, plain, implicit)
	require.NoError(t, err)
	return mailer, rec.conn, rec
}

func TestNewSMTPMailerValidation(t *testing.T) {
	t.Parallel()

	base := service.SMTPMailerConfig{Host: "smtp.example.com", From: "noreply@example.com", Port: 587}

	tests := []struct {
		name    string
		mutate  func(*service.SMTPMailerConfig)
		wantErr string
	}{
		{"empty host", func(c *service.SMTPMailerConfig) { c.Host = "" }, "SMTP host is required"},
		{"empty from", func(c *service.SMTPMailerConfig) { c.From = "" }, "SMTP_FROM is required"},
		{"bad tls mode", func(c *service.SMTPMailerConfig) { c.TLSMode = "ssl" }, `invalid SMTP_TLS mode "ssl"`},
		{"valid", func(*service.SMTPMailerConfig) {}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			cfg := base
			tt.mutate(&cfg)
			_, err := service.NewSMTPMailer(testLogger(), cfg)
			if tt.wantErr == "" {
				assert.NoError(t, err)
			} else {
				assert.ErrorContains(t, err, tt.wantErr)
			}
		})
	}
}

func TestSMTPMailerTLSModeSelection(t *testing.T) {
	t.Parallel()

	tests := []struct {
		mode      string
		wantPlain int
		wantTLS   int
	}{
		{"starttls", 1, 0},
		{"implicit", 0, 1},
		{"none", 1, 0},
		{"", 1, 0}, // empty defaults to starttls
	}
	for _, tt := range tests {
		t.Run("mode="+tt.mode, func(t *testing.T) {
			t.Parallel()

			mailer, conn, rec := newTestSMTPMailer(t, service.SMTPMailerConfig{
				Host: "smtp.example.com", Port: 465, From: "noreply@example.com",
				TLSMode: tt.mode,
			})
			require.NoError(t, mailer.SendVerificationCode(t.Context(), "user@example.com", "123456"))

			assert.Equal(t, tt.wantPlain, rec.plain, "plain dials")
			assert.Equal(t, tt.wantTLS, rec.tls, "implicit-TLS dials")
			if tt.mode == "starttls" || tt.mode == "" {
				require.NotNil(t, conn.tlsConfig, "STARTTLS must be negotiated")
				assert.Equal(t, "smtp.example.com", conn.tlsConfig.ServerName)
			} else {
				assert.Nil(t, conn.tlsConfig, "no STARTTLS upgrade expected")
			}
			assert.True(t, conn.quit, "session must be closed with QUIT")
		})
	}
}

func TestSMTPMailerConversation(t *testing.T) {
	t.Parallel()

	const inviteLink = "https://app.example.com/invite/abc"

	mailer, conn, _ := newTestSMTPMailer(t, service.SMTPMailerConfig{
		Host: "smtp.example.com", Port: 587, From: "noreply@example.com",
		User: "apikey", Password: "secret", TLSMode: "starttls",
	})

	require.NoError(t, mailer.SendHouseholdInvitation(t.Context(), "friend@example.com", inviteLink))

	assert.Equal(t, "localhost", conn.helloName)
	// Credentials use PLAIN auth against the relay host (the STARTTLS
	// upgrade happens before auth; smtp.PlainAuth itself also refuses to
	// send over plaintext).
	require.NotNil(t, conn.auth)
	assert.Equal(t, "*smtp.plainAuth", reflect.TypeOf(conn.auth).String())
	assert.Equal(t, "noreply@example.com", conn.from)
	assert.Equal(t, []string{"friend@example.com"}, conn.rcpt)
	assert.Contains(t, conn.message.String(), "https://app.example.com/invite/abc")
}

func TestSMTPMailerNoAuthWithoutCredentials(t *testing.T) {
	t.Parallel()

	mailer, conn, _ := newTestSMTPMailer(t, service.SMTPMailerConfig{
		Host: "smtp.example.com", Port: 587, From: "noreply@example.com", TLSMode: "none",
	})

	require.NoError(t, mailer.SendVerificationCode(t.Context(), "user@example.com", "123456"))
	assert.Nil(t, conn.auth, "no AUTH step without SMTP_USER")
}

func TestSMTPMailerMessagePerKind(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		send    func(m service.Mailer) error
		subject string
		body    []string
	}{
		{
			name:    "verification code",
			send:    func(m service.Mailer) error { return m.SendVerificationCode(t.Context(), "u@example.com", "654321") },
			subject: "Expense tracker verification code",
			body:    []string{"654321", "10 minutes"},
		},
		{
			name:    "password reset token",
			send:    func(m service.Mailer) error { return m.SendPasswordResetToken(t.Context(), "u@example.com", "tok123") },
			subject: "Reset your Trata password",
			body:    []string{"tok123", "15 minutes", "https://app.example.com/reset-password?token=tok123"},
		},
		{
			name: "household invitation",
			send: func(m service.Mailer) error {
				return m.SendHouseholdInvitation(t.Context(), "u@example.com", "https://app.example.com/invite/tok")
			},
			subject: "You are invited to share a budget on Trata",
			body:    []string{"https://app.example.com/invite/tok"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			mailer, conn, _ := newTestSMTPMailer(t, service.SMTPMailerConfig{
				Host: "smtp.example.com", Port: 587, From: "noreply@example.com",
				TLSMode: "starttls", WebAppBaseURL: "https://app.example.com/",
			})
			require.NoError(t, tt.send(mailer))

			msg := conn.message.String()
			assert.Contains(t, msg, "From: noreply@example.com\r\n")
			assert.Contains(t, msg, "To: u@example.com\r\n")
			assert.Contains(t, msg, "Subject: "+tt.subject+"\r\n")
			assert.Regexp(t, `Date: .+, \d+ .+ \d{4} .+ \+0000\r\n`, msg)
			assert.Contains(t, msg, "MIME-Version: 1.0\r\n")
			assert.Contains(t, msg, "Content-Type: text/plain; charset=utf-8\r\n")
			for _, want := range tt.body {
				assert.Contains(t, msg, want)
			}
			assertMessageCRLFOnly(t, msg)
		})
	}
}

func TestSMTPMailerResetWithoutBaseURL(t *testing.T) {
	t.Parallel()

	mailer, conn, _ := newTestSMTPMailer(t, service.SMTPMailerConfig{
		Host: "smtp.example.com", Port: 587, From: "noreply@example.com",
	})

	require.NoError(t, mailer.SendPasswordResetToken(t.Context(), "u@example.com", "tok123"))

	msg := conn.message.String()
	assert.Contains(t, msg, "tok123")
	assert.NotContains(t, msg, "reset-password?token=", "no link without a configured web origin")
}

// assertMessageCRLFOnly fails on any bare LF: every line of a rendered
// message must end with CRLF.
func assertMessageCRLFOnly(t *testing.T, msg string) {
	t.Helper()
	for line := range strings.SplitSeq(msg, "\n") {
		if len(line) == 0 {
			continue
		}
		assert.Equal(t, "\r", line[len(line)-1:], "bare LF in message: %q", msg)
	}
}

func TestSMTPMailerNormalizesBodyLineEndings(t *testing.T) {
	t.Parallel()

	mailer, conn, _ := newTestSMTPMailer(t, service.SMTPMailerConfig{
		Host: "smtp.example.com", Port: 587, From: "noreply@example.com",
	})

	// A code argument with embedded line endings only ever lands in the
	// body, where it is normalized to CRLF (headers are static).
	require.NoError(t, mailer.SendVerificationCode(t.Context(), "u@example.com", "123\r\n456"))

	assert.Contains(t, conn.message.String(), "123\r\n456")
	assertMessageCRLFOnly(t, conn.message.String())
}

func TestSMTPMailerSwallowsFailures(t *testing.T) {
	t.Parallel()

	// The stub contract: any delivery error is logged (see the dial test
	// below), and nil is returned so auth/invitation flows never break
	// (spec: a mailer outage must not fail the triggering operation).
	for _, step := range []string{"starttls", "auth", "rcpt", "data"} {
		t.Run("fail at "+step, func(t *testing.T) {
			t.Parallel()

			mailer, conn, _ := newTestSMTPMailer(t, service.SMTPMailerConfig{
				Host: "smtp.example.com", Port: 587, From: "noreply@example.com",
				User: "u", Password: "p", TLSMode: "starttls",
			})
			conn.errs = map[string]error{step: errors.New("boom")}

			assert.NoError(t, mailer.SendVerificationCode(t.Context(), "user@example.com", "123456"))
		})
	}

	t.Run("dial failure", func(t *testing.T) {
		t.Parallel()

		mailer, err := service.NewSMTPMailerWithDial(testLogger(),
			service.SMTPMailerConfig{
				Host: "smtp.example.com", Port: 587, From: "noreply@example.com", TLSMode: "starttls",
			},
			func(context.Context) (service.SMTPConn, error) { return nil, errors.New("connection refused") },
			func(context.Context) (service.SMTPConn, error) { return nil, errors.New("connection refused") },
		)
		require.NoError(t, err)

		assert.NoError(t, mailer.SendVerificationCode(t.Context(), "user@example.com", "123456"))
	})
}

func TestSMTPMailerRejectsHeaderInjection(t *testing.T) {
	t.Parallel()

	mailer, _, rec := newTestSMTPMailer(t, service.SMTPMailerConfig{
		Host: "smtp.example.com", Port: 587, From: "noreply@example.com",
	})

	// An address carrying CR/LF must never reach a wire header.
	require.NoError(t, mailer.SendVerificationCode(t.Context(), "a@example.com\r\nBcc: victim@example.com", "123456"))

	assert.Equal(t, 0, rec.plain+rec.tls, "no connection should be made for an injected address")
}

func TestSMTPMailerLogsFailureOutput(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	mailer, err := service.NewSMTPMailerWithDial(log,
		service.SMTPMailerConfig{Host: "smtp.example.com", Port: 587, From: "noreply@example.com"},
		func(context.Context) (service.SMTPConn, error) { return nil, errors.New("relay unreachable") },
		func(context.Context) (service.SMTPConn, error) { return nil, errors.New("relay unreachable") },
	)
	require.NoError(t, err)

	require.NoError(t, mailer.SendPasswordResetToken(t.Context(), "u@example.com", "tok"))

	assert.Contains(t, buf.String(), "smtp delivery failed")
	assert.Contains(t, buf.String(), "relay unreachable")
}

func TestSMTPMailerDateHeader(t *testing.T) {
	t.Parallel()

	// The Date header is RFC 5322 (RFC1123Z) in UTC - spot-check the shape
	// through a real send instead of the internal builder.
	mailer, conn, _ := newTestSMTPMailer(t, service.SMTPMailerConfig{
		Host: "smtp.example.com", Port: 587, From: "noreply@example.com",
	})

	require.NoError(t, mailer.SendVerificationCode(t.Context(), "u@example.com", "123456"))

	// e.g. "Date: Mon, 02 Jan 2006 15:04:05 -0700"; we always emit +0000.
	msg := conn.message.String()
	rest := msg[strings.Index(msg, "Date: ")+len("Date: "):]
	dated, _, _ := strings.Cut(rest, "\r\n")
	assert.Regexp(t, `^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$`, dated)
	assert.WithinDuration(t, time.Now().UTC(), parseRFC1123Z(t, dated), time.Minute)
}

func parseRFC1123Z(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC1123Z, s)
	require.NoError(t, err)
	return ts
}
