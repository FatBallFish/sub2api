package handler

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRegisterRequestAffiliateCodeFallsBackToRef(t *testing.T) {
	require.Equal(t, "AFF123", RegisterRequest{Ref: " AFF123 "}.affiliateCode())
	require.Equal(t, "AFF456", RegisterRequest{AffCode: " AFF456 ", Ref: "AFF123"}.affiliateCode())
}
