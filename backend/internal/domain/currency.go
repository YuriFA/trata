package domain

import "fmt"

// ValidateCurrency reports whether code belongs to the supported currency
// catalog: 19 ISO codes, all two-decimal, so the single minor-unit divisor
// (100) holds at every storage/transport/sync boundary. Fixed list -
// expanding it is a coordinated change across this catalog, the DB check
// constraints, the OpenAPI Currency schema and @trata/money.
func ValidateCurrency(code string) error {
	switch code {
	case "USD", "EUR", "RUB", "GBP", "CNY", "TRY", "PLN", "GEL", "KZT",
		"UAH", "AMD", "AZN", "BYN", "UZS", "KGS", "RSD", "ILS", "AED", "THB":
		return nil
	default:
		return fmt.Errorf("unsupported currency %q", code)
	}
}
