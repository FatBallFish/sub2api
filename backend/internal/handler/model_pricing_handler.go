package handler

import (
	"strconv"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"

	"github.com/gin-gonic/gin"
)

type ModelPricingHandler struct {
	apiKeyService       *service.APIKeyService
	modelPricingDisplay *service.ModelPricingDisplayService
}

func NewModelPricingHandler(apiKeyService *service.APIKeyService, modelPricingDisplay *service.ModelPricingDisplayService) *ModelPricingHandler {
	return &ModelPricingHandler{
		apiKeyService:       apiKeyService,
		modelPricingDisplay: modelPricingDisplay,
	}
}

// GetConsoleModelPricing returns model pricing for the current user's selected group.
// GET /api/v1/model-pricing?group_id=1
func (h *ModelPricingHandler) GetConsoleModelPricing(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	var selectedGroupID int64
	if raw := strings.TrimSpace(c.Query("group_id")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			response.BadRequest(c, "Invalid group_id")
			return
		}
		selectedGroupID = parsed
	}
	groups, err := h.apiKeyService.GetAvailableGroups(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	out, err := h.modelPricingDisplay.BuildConsolePricing(c.Request.Context(), groups, selectedGroupID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, out)
}
