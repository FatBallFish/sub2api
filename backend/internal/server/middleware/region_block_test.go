package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type regionBlockSettingRepoStub struct {
	values map[string]string
}

func (r *regionBlockSettingRepoStub) Get(ctx context.Context, key string) (*service.Setting, error) {
	if value, ok := r.values[key]; ok {
		return &service.Setting{Key: key, Value: value}, nil
	}
	return nil, service.ErrSettingNotFound
}

func (r *regionBlockSettingRepoStub) GetValue(ctx context.Context, key string) (string, error) {
	setting, err := r.Get(ctx, key)
	if err != nil {
		return "", err
	}
	return setting.Value, nil
}

func (r *regionBlockSettingRepoStub) Set(context.Context, string, string) error { return nil }
func (r *regionBlockSettingRepoStub) GetMultiple(context.Context, []string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (r *regionBlockSettingRepoStub) SetMultiple(context.Context, map[string]string) error {
	return nil
}
func (r *regionBlockSettingRepoStub) GetAll(context.Context) (map[string]string, error) {
	return map[string]string{}, nil
}
func (r *regionBlockSettingRepoStub) Delete(context.Context, string) error { return nil }

func TestRegionBlockGuard(t *testing.T) {
	tests := []struct {
		name       string
		values     map[string]string
		headerName string
		headerVal  string
		wantStatus int
	}{
		{
			name: "disabled allows blocked code",
			values: map[string]string{
				service.SettingKeyRegionBlockEnabled: "false",
				service.SettingKeyRegionBlockCodes:   "CN",
			},
			headerName: "CF-IPCountry",
			headerVal:  "CN",
			wantStatus: http.StatusOK,
		},
		{
			name: "enabled blocks matching proxy country header",
			values: map[string]string{
				service.SettingKeyRegionBlockEnabled:    "true",
				service.SettingKeyRegionBlockAPIEnabled: "true",
				service.SettingKeyRegionBlockCodes:      "CN,IR",
				service.SettingKeyRegionBlockHeaders:    "CF-IPCountry,X-Country-Code",
			},
			headerName: "CF-IPCountry",
			headerVal:  "cn",
			wantStatus: http.StatusForbidden,
		},
		{
			name: "enabled allows unknown region header",
			values: map[string]string{
				service.SettingKeyRegionBlockEnabled:    "true",
				service.SettingKeyRegionBlockAPIEnabled: "true",
				service.SettingKeyRegionBlockCodes:      "CN",
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "enabled allows non matching region",
			values: map[string]string{
				service.SettingKeyRegionBlockEnabled:    "true",
				service.SettingKeyRegionBlockAPIEnabled: "true",
				service.SettingKeyRegionBlockCodes:      "CN",
			},
			headerName: "CF-IPCountry",
			headerVal:  "US",
			wantStatus: http.StatusOK,
		},
		{
			name: "enabled allows matching region when api blocking disabled",
			values: map[string]string{
				service.SettingKeyRegionBlockEnabled:    "true",
				service.SettingKeyRegionBlockAPIEnabled: "false",
				service.SettingKeyRegionBlockCodes:      "CN",
			},
			headerName: "CF-IPCountry",
			headerVal:  "CN",
			wantStatus: http.StatusOK,
		},
	}

	gin.SetMode(gin.TestMode)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := service.NewSettingService(&regionBlockSettingRepoStub{values: tt.values}, &config.Config{})
			router := gin.New()
			router.Use(RegionBlockGuard(svc))
			router.GET("/ping", func(c *gin.Context) {
				c.String(http.StatusOK, "ok")
			})

			req := httptest.NewRequest(http.MethodGet, "/ping", nil)
			if tt.headerName != "" {
				req.Header.Set(tt.headerName, tt.headerVal)
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			require.Equal(t, tt.wantStatus, w.Code)
			if tt.wantStatus == http.StatusForbidden {
				require.Contains(t, w.Body.String(), "REGION_BLOCKED")
			}
		})
	}
}
