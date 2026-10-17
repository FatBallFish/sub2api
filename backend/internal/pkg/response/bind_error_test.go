package response

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type bindErrorProbeRequest struct {
	Email    string  `json:"email" binding:"required,email"`
	UserIDs  []int64 `json:"user_ids" binding:"omitempty,min=1"`
	Password string  `json:"password" binding:"required,min=6"`
	Role     string  `json:"role" binding:"omitempty,oneof=admin user"`
}

func bindProbe(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/probe", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	var req bindErrorProbeRequest
	err := c.ShouldBindJSON(&req)
	require.Error(t, err)
	BindError(c, err)
	return rec
}

func TestBindErrorFieldAndTag(t *testing.T) {
	rec := bindProbe(t, `{"email":"not-an-email","password":"longenough"}`)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	body := rec.Body.String()
	require.Contains(t, body, `"reason":"VALIDATION_FAILED"`)
	require.Contains(t, body, `"field":"email"`)
	require.Contains(t, body, `"tag":"email"`)
}

func TestBindErrorMapsGoFieldNameToJSONTag(t *testing.T) {
	// user_ids 违反 min=1：Go 字段名 UserIDs 应映射为 json 名 user_ids。
	rec := bindProbe(t, `{"email":"a@b.com","password":"longenough","user_ids":[]}`)
	require.Contains(t, rec.Body.String(), `"field":"user_ids"`)
	require.Contains(t, rec.Body.String(), `"tag":"min"`)
}

func TestBindErrorRequiredAndOneof(t *testing.T) {
	rec := bindProbe(t, `{"email":"a@b.com","role":"superuser"}`)
	require.Contains(t, rec.Body.String(), `"tag":"required"`) // password 缺失

	rec = bindProbe(t, `{"email":"a@b.com","password":"longenough","role":"superuser"}`)
	require.Contains(t, rec.Body.String(), `"tag":"oneof"`)
}

func TestBindErrorMalformedJSON(t *testing.T) {
	rec := bindProbe(t, `{"email": not-json`)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Contains(t, rec.Body.String(), `"reason":"VALIDATION_FAILED"`)
	require.Contains(t, rec.Body.String(), `"tag":"json"`)
}

func TestBindErrorEmptyBody(t *testing.T) {
	rec := bindProbe(t, ``)
	require.Contains(t, rec.Body.String(), `"tag":"json"`)
}
