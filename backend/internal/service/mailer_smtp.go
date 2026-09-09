package service

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/yurifa/trata/backend/internal/domain"
)

// TLS modes for the SMTP relay connection (SMTP_TLS config).
const (
	smtpTLSStartTLS = "starttls" // plain dial, then STARTTLS upgrade (587)
	smtpTLSImplicit = "implicit" // TLS from the first byte via tls.Dial (465)
	smtpTLSNone     = "none"     // plaintext, local test sinks only
)

// minutesPerHour converts a [time.Duration] TTL into whole-hour email copy.
const minutesPerHour = 60

// SMTPMailerConfig parameterizes the relay-backed Mailer. Host and From are
// required; User/Password enable PLAIN auth; WebAppBaseURL builds the
// emailed reset link (the invitation link is passed in by the household
// service already).
type SMTPMailerConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	From     string
	// TLSMode is one of starttls (default when empty), implicit, none.
	TLSMode string
	// WebAppBaseURL is the public web origin (no trailing slash); the reset
	// email links to "<WebAppBaseURL>/reset-password?token=...". Empty keeps
	// the token-only body.
	WebAppBaseURL string
}

// SMTPConn is the wire-facing subset of [smtp.Client] a delivery needs.
// Exported so the external test package can substitute a recording fake.
type SMTPConn interface {
	Hello(localName string) error
	StartTLS(*tls.Config) error
	Auth(smtp.Auth) error
	Mail(from string) error
	Rcpt(to string) error
	Data() (io.WriteCloser, error)
	Quit() error
	Close() error
}

// SMTPDialFunc opens one connection for a delivery. Production dialers
// (plain TCP for starttls/none, implicit TLS otherwise) are installed by
// NewSMTPMailer; tests substitute fakes via NewSMTPMailerWithDial.
type SMTPDialFunc func(ctx context.Context) (SMTPConn, error)

// smtpMailer sends transactional email through an SMTP relay (stdlib
// net/smtp; no mail library - three plain-text emails don't justify one).
// It implements the best-effort Mailer contract: delivery failures are
// logged here and NEVER returned to the caller, so auth and invitation
// flows cannot break on a mailer outage.
type smtpMailer struct {
	log  *slog.Logger
	from string
	addr string
	host string
	mode string
	auth smtp.Auth
	url  string // web app base URL for emailed links

	dialPlain SMTPDialFunc
	dialTLS   SMTPDialFunc
	now       func() time.Time
}

// NewSMTPMailer validates cfg and returns a relay-backed Mailer using the
// production dialers. Wiring selects it when SMTP_HOST is set; anything
// else uses NewLogMailer.
func NewSMTPMailer(log *slog.Logger, cfg SMTPMailerConfig) (Mailer, error) {
	m, err := newSMTPMailer(log, cfg)
	if err != nil {
		return nil, err
	}
	return m, nil
}

// NewSMTPMailerWithDial builds the mailer with injected dial funcs (nil
// keeps the production dialer for that path); tests use it to observe the
// SMTP conversation without a relay.
func NewSMTPMailerWithDial(
	log *slog.Logger, cfg SMTPMailerConfig, plain, implicitTLS SMTPDialFunc,
) (Mailer, error) {
	m, err := newSMTPMailer(log, cfg)
	if err != nil {
		return nil, err
	}
	if plain != nil {
		m.dialPlain = plain
	}
	if implicitTLS != nil {
		m.dialTLS = implicitTLS
	}
	return m, nil
}

// newSMTPMailer validates cfg and assembles the mailer with production
// dialers installed.
func newSMTPMailer(log *slog.Logger, cfg SMTPMailerConfig) (*smtpMailer, error) {
	const op = "service.NewSMTPMailer"

	mode := strings.ToLower(strings.TrimSpace(cfg.TLSMode))
	if mode == "" {
		mode = smtpTLSStartTLS
	}
	switch mode {
	case smtpTLSStartTLS, smtpTLSImplicit, smtpTLSNone:
	default:
		return nil, fmt.Errorf("%s: invalid SMTP_TLS mode %q (want starttls, implicit, or none)", op, cfg.TLSMode)
	}
	if strings.TrimSpace(cfg.Host) == "" {
		return nil, fmt.Errorf("%s: SMTP host is required", op)
	}
	if strings.TrimSpace(cfg.From) == "" {
		return nil, fmt.Errorf("%s: SMTP_FROM is required when SMTP is configured", op)
	}
	if cfg.Port == 0 {
		cfg.Port = 587
	}

	host := cfg.Host
	addr := net.JoinHostPort(host, strconv.Itoa(cfg.Port))

	var auth smtp.Auth
	if cfg.User != "" {
		auth = smtp.PlainAuth("", cfg.User, cfg.Password, host)
	}

	m := &smtpMailer{
		log:       log,
		from:      cfg.From,
		addr:      addr,
		host:      host,
		mode:      mode,
		auth:      auth,
		url:       strings.TrimRight(cfg.WebAppBaseURL, "/"),
		now:       time.Now,
		dialPlain: dialSMTPPlain(addr, host),
		dialTLS:   dialSMTPTLS(addr, host),
	}
	return m, nil
}

// dialSMTPPlain dials TCP and wraps the connection in an [smtp.Client]
// (STARTTLS upgrade happens after EHLO, see deliver).
func dialSMTPPlain(addr, host string) SMTPDialFunc {
	return func(ctx context.Context) (SMTPConn, error) {
		return dialSMTPClient(ctx, "tcp", addr, host, nil)
	}
}

// dialSMTPTLS dials with TLS from the first byte (implicit TLS, 465-style).
func dialSMTPTLS(addr, host string) SMTPDialFunc {
	return func(ctx context.Context) (SMTPConn, error) {
		return dialSMTPClient(ctx, "tls", addr, host, &tls.Config{ServerName: host})
	}
}

func dialSMTPClient(
	ctx context.Context, network, addr, host string, tlsCfg *tls.Config,
) (*smtp.Client, error) {
	var conn net.Conn
	var err error
	if network == "tls" {
		conn, err = (&tls.Dialer{Config: tlsCfg}).DialContext(ctx, network, addr)
	} else {
		conn, err = (&net.Dialer{}).DialContext(ctx, network, addr)
	}
	if err != nil {
		return nil, err
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return client, nil
}

func (m *smtpMailer) SendVerificationCode(ctx context.Context, to, code string) error {
	subject := "Expense tracker verification code"
	body := fmt.Sprintf(
		"Your verification code is: %s\n\nIt expires in %s.",
		code, ttlWords(domain.VerificationCodeTTL),
	)
	return m.send(ctx, to, subject, body)
}

func (m *smtpMailer) SendPasswordResetToken(ctx context.Context, to, token string) error {
	subject := "Reset your Trata password"
	body := fmt.Sprintf(
		"Use this one-time token to set a new password (expires in %s):\n\n%s",
		ttlWords(domain.PasswordResetTokenTTL), token,
	)
	if m.url != "" {
		body += fmt.Sprintf("\n\nOr open the reset page directly:\n\n%s/reset-password?token=%s", m.url, token)
	}
	body += "\n\nIf you did not request a password reset, ignore this email."
	return m.send(ctx, to, subject, body)
}

func (m *smtpMailer) SendHouseholdInvitation(ctx context.Context, to, link string) error {
	subject := "You are invited to share a budget on Trata"
	body := fmt.Sprintf(
		"Someone invited you to join their household on Trata.\n\nAccept the invitation:\n\n%s\n\nIf you were not expecting this, ignore this email.",
		link,
	)
	return m.send(ctx, to, subject, body)
}

// send delivers one message and implements the stub contract: errors are
// logged and swallowed (nil is always returned to the flow).
func (m *smtpMailer) send(ctx context.Context, to, subject, body string) error {
	if err := m.deliver(ctx, to, subject, body); err != nil {
		m.log.WarnContext(ctx, "smtp delivery failed",
			slog.String("to", to),
			slog.String("subject", subject),
			slog.String("error", err.Error()),
		)
	}
	return nil
}

func (m *smtpMailer) deliver(ctx context.Context, to, subject, body string) error {
	const op = "service.smtpMailer.deliver"

	if err := checkAddress(to); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}

	conn, err := m.open(ctx)
	if err != nil {
		return fmt.Errorf("%s: dial %s: %w", op, m.addr, err)
	}
	defer func() { _ = conn.Close() }()

	if err := conn.Hello("localhost"); err != nil {
		return fmt.Errorf("%s: ehlo: %w", op, err)
	}
	if m.mode == smtpTLSStartTLS {
		if err := conn.StartTLS(&tls.Config{ServerName: m.host}); err != nil {
			return fmt.Errorf("%s: starttls: %w", op, err)
		}
	}
	if m.auth != nil {
		if err := conn.Auth(m.auth); err != nil {
			return fmt.Errorf("%s: auth: %w", op, err)
		}
	}
	if err := conn.Mail(m.from); err != nil {
		return fmt.Errorf("%s: mail from: %w", op, err)
	}
	if err := conn.Rcpt(to); err != nil {
		return fmt.Errorf("%s: rcpt to: %w", op, err)
	}

	msg := buildSMTPMessage(m.from, to, subject, body, m.now())
	w, err := conn.Data()
	if err != nil {
		return fmt.Errorf("%s: data: %w", op, err)
	}
	if _, err := w.Write(msg); err != nil {
		_ = w.Close()
		return fmt.Errorf("%s: write body: %w", op, err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("%s: close body: %w", op, err)
	}
	if err := conn.Quit(); err != nil {
		return fmt.Errorf("%s: quit: %w", op, err)
	}
	return nil
}

// open selects the dial path from the configured TLS mode.
func (m *smtpMailer) open(ctx context.Context) (SMTPConn, error) {
	if m.mode == smtpTLSImplicit {
		return m.dialTLS(ctx)
	}
	return m.dialPlain(ctx)
}

// buildSMTPMessage renders one RFC 5322 message. Headers and addresses are
// ASCII-only in this mailer (subjects are static, bodies carry codes,
// tokens, and links); CR/LF in From/To/Subject would be header injection.
func buildSMTPMessage(from, to, subject, body string, now time.Time) []byte {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	b.WriteString("Date: " + now.UTC().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("\r\n")
	// Normalize body line endings to CRLF; a lone CR never survives.
	norm := strings.ReplaceAll(body, "\r\n", "\n")
	norm = strings.ReplaceAll(norm, "\r", "")
	norm = strings.ReplaceAll(norm, "\n", "\r\n")
	b.WriteString(norm)
	b.WriteString("\r\n")
	return []byte(b.String())
}

// checkAddress rejects header-injection payloads and obvious garbage before
// the address reaches a wire header.
func checkAddress(addr string) error {
	if strings.ContainsAny(addr, "\r\n") {
		return fmt.Errorf("address %q contains CR/LF", addr)
	}
	if !strings.Contains(addr, "@") || strings.ContainsAny(addr, " \t") {
		return fmt.Errorf("invalid email address %q", addr)
	}
	return nil
}

// ttlWords renders a TTL as "10 minutes" / "15 minutes" style text for
// the email bodies (all current TTLs are whole minutes; whole hours render
// as "N hours").
func ttlWords(d time.Duration) string {
	mins := int(d.Minutes())
	if mins%minutesPerHour == 0 {
		return strconv.Itoa(mins/minutesPerHour) + " hours"
	}
	return strconv.Itoa(mins) + " minutes"
}
