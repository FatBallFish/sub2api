//go:build unit

package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/handler"
	adminhandler "github.com/Wei-Shaw/sub2api/internal/handler/admin"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestAdminChannelModelPricingDisplayRouteDoesNotMatchChannelID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	adminGroup := router.Group("/api/v1/admin")
	registerChannelRoutes(adminGroup, &handler.Handlers{
		Admin: &handler.AdminHandlers{
			Channel: adminhandler.NewChannelHandler(nil, nil, nil),
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/channels/model-pricing-display", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"code":0`)
	require.NotContains(t, rec.Body.String(), "Invalid channel ID")
}
