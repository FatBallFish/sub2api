package middleware

import (
	"net/http"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

func RegionBlockGuard(settingService *service.SettingService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if settingService == nil ||
			!settingService.IsRegionBlockEnabled(c.Request.Context()) ||
			!settingService.IsRegionBlockAPIEnabled(c.Request.Context()) ||
			isRegionBlockBypassPath(c.Request.URL.Path) {
			c.Next()
			return
		}

		evaluation := settingService.EvaluateRegionBlock(c.Request.Context(), regionBlockHeadersFromGin(c))
		if evaluation.Blocked {
			response.ErrorWithDetails(c, http.StatusForbidden, "region blocked", "REGION_BLOCKED", map[string]string{
				"region": evaluation.Region,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func isRegionBlockBypassPath(path string) bool {
	path = strings.TrimSpace(path)
	return path == "/api/v1/settings/public"
}

func regionBlockHeadersFromGin(c *gin.Context) map[string]string {
	headers := make(map[string]string, len(c.Request.Header))
	for key, values := range c.Request.Header {
		if len(values) > 0 {
			headers[strings.ToLower(strings.TrimSpace(key))] = values[0]
		}
	}
	return headers
}
