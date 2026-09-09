package http

import (
	"context"

	"github.com/yurifa/trata/backend/internal/api"
	"github.com/yurifa/trata/backend/internal/transport/http/cookie"
)

func (s *Server) RegisterUser(
	ctx context.Context,
	req api.RegisterUserRequestObject,
) (api.RegisterUserResponseObject, error) {
	res, err := s.auth.Register(ctx, string(req.Body.Email), req.Body.Password)
	if err != nil {
		return nil, err
	}
	cookieStr := cookie.BuildSession(s.cfg.SessionConfig, res.SessionID, int(s.cfg.SessionConfig.TTL.Seconds())).
		String()
	return api.RegisterUser201JSONResponse{
		Body:    toAPIUser(*res.User),
		Headers: api.RegisterUser201ResponseHeaders{SetCookie: &cookieStr},
	}, nil
}

func (s *Server) LoginUser(ctx context.Context, req api.LoginUserRequestObject) (api.LoginUserResponseObject, error) {
	res, err := s.auth.Login(ctx, string(req.Body.Email), req.Body.Password)
	if err != nil {
		return nil, err
	}
	cookieStr := cookie.BuildSession(s.cfg.SessionConfig, res.SessionID, int(s.cfg.SessionConfig.TTL.Seconds())).
		String()
	return api.LoginUser200JSONResponse{
		Body:    toAPIUser(*res.User),
		Headers: api.LoginUser200ResponseHeaders{SetCookie: &cookieStr},
	}, nil
}

func (s *Server) LogoutUser(ctx context.Context, _ api.LogoutUserRequestObject) (api.LogoutUserResponseObject, error) {
	c := ginCtx(ctx)
	if cookieVal, err := c.Request.Cookie(s.cfg.SessionConfig.CookieName); err == nil {
		_ = s.auth.Logout(ctx, cookieVal.Value)
	}
	cookieStr := cookie.BuildSession(s.cfg.SessionConfig, "", -1).String()
	return api.LogoutUser204Response{
		Headers: api.LogoutUser204ResponseHeaders{SetCookie: &cookieStr},
	}, nil
}

func (s *Server) GetCurrentUser(
	ctx context.Context,
	_ api.GetCurrentUserRequestObject,
) (api.GetCurrentUserResponseObject, error) {
	user := s.currentUser(ctx)
	return api.GetCurrentUser200JSONResponse(toAPIUser(*user)), nil
}

func (s *Server) VerifyEmail(
	ctx context.Context,
	req api.VerifyEmailRequestObject,
) (api.VerifyEmailResponseObject, error) {
	user := s.currentUser(ctx)
	if err := s.auth.VerifyEmail(ctx, user.ID, req.Body.Code); err != nil {
		return nil, err
	}
	return api.VerifyEmail204Response{}, nil
}

func (s *Server) ResendVerification(
	ctx context.Context,
	_ api.ResendVerificationRequestObject,
) (api.ResendVerificationResponseObject, error) {
	user := s.currentUser(ctx)
	if err := s.auth.ResendVerification(ctx, user.ID); err != nil {
		return nil, err
	}
	return api.ResendVerification204Response{}, nil
}

func (s *Server) RequestPasswordReset(
	ctx context.Context,
	req api.RequestPasswordResetRequestObject,
) (api.RequestPasswordResetResponseObject, error) {
	if err := s.auth.RequestPasswordReset(ctx, string(req.Body.Email)); err != nil {
		return nil, err
	}
	return api.RequestPasswordReset204Response{}, nil
}

func (s *Server) ConfirmPasswordReset(
	ctx context.Context,
	req api.ConfirmPasswordResetRequestObject,
) (api.ConfirmPasswordResetResponseObject, error) {
	if err := s.auth.ConfirmPasswordReset(ctx, req.Body.Token, req.Body.NewPassword); err != nil {
		return nil, err
	}
	return api.ConfirmPasswordReset204Response{}, nil
}
