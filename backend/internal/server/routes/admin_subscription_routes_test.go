//go:build unit

package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/handler"
	adminhandler "github.com/Wei-Shaw/sub2api/internal/handler/admin"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestAdminSubscriptionGlobalPlansRouteDoesNotMatchSubscriptionID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	adminGroup := router.Group("/api/v1/admin")
	registerSubscriptionRoutes(adminGroup, &handler.Handlers{
		Admin: &handler.AdminHandlers{
			Subscription: adminhandler.NewSubscriptionHandler(service.NewSubscriptionService(nil, nil, nil, nil, nil)),
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/subscriptions/global-plans", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), "Global plan service is not available")
	require.NotContains(t, rec.Body.String(), "Invalid subscription ID")
}
