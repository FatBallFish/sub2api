package response

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/validator/v10"
)

// init 让 gin 绑定校验器的字段名直接采用请求体的 json tag（如 Email -> email）。
// 注册跟随本包（BindError 的实现方）加载，保证任何使用方（含测试）口径一致。
func init() {
	if engine, ok := binding.Validator.Engine().(*validator.Validate); ok {
		engine.RegisterTagNameFunc(func(f reflect.StructField) string {
			name := f.Tag.Get("json")
			if idx := strings.Index(name, ","); idx >= 0 {
				name = name[:idx]
			}
			if name = strings.TrimSpace(name); name != "" && name != "-" {
				return name
			}
			return f.Name
		})
	}
}

// ReasonValidationFailed 请求体绑定/校验失败的统一 reason；
// metadata 携带 field（出错字段的 JSON 名）与 tag（校验规则名），前端据此渲染本地化提示。
const ReasonValidationFailed = "VALIDATION_FAILED"

// BindError 把 ShouldBind* 返回的绑定/校验错误转成结构化 400 响应。
//
// message 保留原始错误串供日志与 API 调用方排查；前端优先按
// reason=VALIDATION_FAILED + metadata(field, tag) 渲染本地化文案，
// 不再直接展示英文原文。
func BindError(c *gin.Context, err error) {
	field, tag := parseBindingError(err)
	ErrorWithDetails(c, http.StatusBadRequest, "Invalid request: "+err.Error(),
		ReasonValidationFailed, map[string]string{"field": field, "tag": tag})
}

// parseBindingError 提取首个校验错误的字段名（尽量映射为 JSON 名）与规则 tag；
// 非 validator 错误（JSON 语法/类型错误、空 body）归为 tag=json 或 invalid。
func parseBindingError(err error) (field, tag string) {
	var validationErrors validator.ValidationErrors
	if errors.As(err, &validationErrors) {
		for _, fe := range validationErrors {
			return jsonFieldName(fe), fe.Tag()
		}
	}
	var syntaxError *json.SyntaxError
	var typeError *json.UnmarshalTypeError
	switch {
	case errors.Is(err, io.EOF) || errors.As(err, &syntaxError):
		return "", "json"
	case errors.As(err, &typeError):
		return typeError.Field, "json_type"
	default:
		return "", "invalid"
	}
}

// jsonFieldName 取校验错误的字段名。启动时已为 validator 注册
// RegisterTagNameFunc（json tag 优先），Field() 即请求体的 JSON 字段名；
// 兜底退化为去命名空间的 StructField，避免把 Go 名直接漏给前端。
func jsonFieldName(fe validator.FieldError) string {
	if name := strings.TrimSpace(fe.Field()); name != "" {
		return name
	}
	structField := strings.TrimSpace(fe.StructField())
	if idx := strings.LastIndex(structField, "."); idx >= 0 {
		structField = structField[idx+1:]
	}
	return structField
}
