package yandex

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type Client struct {
	ClientID     string
	ClientSecret string
	HTTP         *http.Client
	TokenURL     string
	InfoURL      string
}

func NewClient(clientID, clientSecret string) *Client {
	return &Client{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		HTTP:         &http.Client{Timeout: RequestTimeout},
		TokenURL:     TokenURL,
		InfoURL:      InfoURL,
	}
}

func (c *Client) Exchange(ctx context.Context, code, redirectURI string) (Profile, error) {
	token, err := c.token(ctx, code, redirectURI)
	if err != nil {
		return Profile{}, err
	}
	return c.profile(ctx, token)
}

func (c *Client) token(ctx context.Context, code, redirectURI string) (string, error) {
	form := url.Values{
		"grant_type":    {GrantAuthCode},
		"code":          {code},
		"client_id":     {c.ClientID},
		"client_secret": {c.ClientSecret},
	}
	if redirectURI != "" {
		form.Set("redirect_uri", redirectURI)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	var parsed tokenResponse
	if err := c.do(request, &parsed); err != nil {
		return "", err
	}
	if parsed.AccessToken == "" {
		return "", ErrRejected
	}
	return parsed.AccessToken, nil
}

func (c *Client) profile(ctx context.Context, token string) (Profile, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.InfoURL, nil)
	if err != nil {
		return Profile{}, fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	request.Header.Set("Authorization", InfoAuthScheme+token)

	var parsed infoResponse
	if err := c.do(request, &parsed); err != nil {
		return Profile{}, err
	}
	if parsed.ID == "" || parsed.ClientID != c.ClientID {
		return Profile{}, ErrRejected
	}
	return Profile{
		ID:          parsed.ID,
		Login:       parsed.Login,
		DisplayName: parsed.DisplayName,
		RealName:    parsed.RealName,
		Email:       parsed.DefaultEmail,
	}, nil
}

func (c *Client) do(request *http.Request, into any) error {
	response, err := c.HTTP.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	switch {
	case response.StatusCode == StatusBadRequest || response.StatusCode == StatusUnauthorized:
		return ErrRejected
	case response.StatusCode != http.StatusOK:
		return fmt.Errorf("%w: status %d", ErrUpstream, response.StatusCode)
	}
	if err := json.Unmarshal(body, into); err != nil {
		return fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	return nil
}
